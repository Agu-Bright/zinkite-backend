/**
 * Support Service
 * Business logic for the smart ticketing system
 */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SupportTicket,
  SupportTicketDocument,
  TicketCategory,
  TicketStatus,
  TicketSenderType,
  CATEGORY_ROLE_MAP,
  GLOBAL_TICKET_ROLES,
} from './schemas/support-ticket.schema';
import {
  CreateTicketDto,
  TicketReplyDto,
  AdminTicketReplyDto,
  UpdateTicketStatusDto,
  ReassignTicketDto,
  MyTicketsQueryDto,
  TicketsQueryDto,
} from './dto';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectModel(SupportTicket.name)
    private readonly ticketModel: Model<SupportTicketDocument>,
  ) {}

  // ── Helpers ────────────────────────────────────────────

  private generateTicketNumber(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `TKT-${code}`;
  }

  private async uniqueTicketNumber(): Promise<string> {
    let ticketNumber: string;
    let exists = true;
    while (exists) {
      ticketNumber = this.generateTicketNumber();
      exists = !!(await this.ticketModel.findOne({ ticketNumber }).lean());
    }
    return ticketNumber!;
  }

  /**
   * Strip internal admin notes from messages when returning to a user
   */
  private stripInternalMessages(ticket: any): any {
    if (!ticket) return ticket;
    const obj = ticket.toObject ? ticket.toObject() : { ...ticket };
    obj.messages = (obj.messages || []).filter((m: any) => !m.isInternal);
    return obj;
  }

  // ── User Methods ───────────────────────────────────────

  async createTicket(userId: string, userName: string, dto: CreateTicketDto) {
    const ticketNumber = await this.uniqueTicketNumber();
    const assignedRole = CATEGORY_ROLE_MAP[dto.category];

    const ticket = await this.ticketModel.create({
      ticketNumber,
      userId: new Types.ObjectId(userId),
      category: dto.category,
      subject: dto.subject,
      description: dto.description,
      priority: dto.priority || 'MEDIUM',
      status: TicketStatus.OPEN,
      assignedRole,
      relatedTransactionId: dto.relatedTransactionId || null,
      attachments: dto.attachments || [],
      messages: [
        {
          senderId: new Types.ObjectId(userId),
          senderType: TicketSenderType.USER,
          senderName: userName,
          content: dto.description,
          attachments: dto.attachments || [],
          isInternal: false,
        },
      ],
    });

    this.logger.log(
      `Ticket ${ticketNumber} created by user ${userId} [${dto.category}] → routed to ${assignedRole}`,
    );

    return ticket;
  }

  async getMyTickets(userId: string, query: MyTicketsQueryDto) {
    const { page = 1, limit = 20, status } = query;
    const filter: any = { userId: new Types.ObjectId(userId) };
    if (status) filter.status = status;

    const [data, total] = await Promise.all([
      this.ticketModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('-messages')
        .lean(),
      this.ticketModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTicketById(ticketId: string, userId?: string) {
    if (!Types.ObjectId.isValid(ticketId)) {
      throw new BadRequestException('Invalid ticket ID');
    }

    const ticket = await this.ticketModel
      .findById(ticketId)
      .populate('userId', 'fullName email phone')
      .populate('assignedTo', 'fullName email');

    if (!ticket) throw new NotFoundException('Ticket not found');

    // Ownership check for user requests
    if (userId && ticket.userId._id.toString() !== userId) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    // Strip internal messages for user requests
    if (userId) {
      return this.stripInternalMessages(ticket);
    }

    return ticket;
  }

  async addUserReply(ticketId: string, userId: string, userName: string, dto: TicketReplyDto) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId.toString() !== userId) {
      throw new ForbiddenException('You do not have access to this ticket');
    }
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Cannot reply to a closed ticket');
    }

    ticket.messages.push({
      senderId: new Types.ObjectId(userId),
      senderType: TicketSenderType.USER,
      senderName: userName,
      content: dto.content,
      attachments: dto.attachments || [],
      isInternal: false,
      createdAt: new Date(),
    } as any);

    // Re-open if was resolved
    if (ticket.status === TicketStatus.RESOLVED) {
      ticket.status = TicketStatus.OPEN;
      ticket.resolvedAt = null;
    }

    await ticket.save();
    return this.stripInternalMessages(ticket);
  }

  async closeTicket(ticketId: string, userId: string) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.userId.toString() !== userId) {
      throw new ForbiddenException('You do not have access to this ticket');
    }
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Ticket is already closed');
    }

    ticket.status = TicketStatus.CLOSED;
    ticket.closedAt = new Date();
    await ticket.save();

    return this.stripInternalMessages(ticket);
  }

  // ── Admin Methods ──────────────────────────────────────

  async getAdminTickets(adminRoleSlug: string, permissions: string[], query: TicketsQueryDto) {
    const { page = 1, limit = 20, category, status, priority, assignedRole, search, startDate, endDate } = query;

    const filter: any = {};

    // Role-based filtering: global roles see all, domain roles see only their tickets
    if (!GLOBAL_TICKET_ROLES.includes(adminRoleSlug)) {
      filter.assignedRole = adminRoleSlug;
    }

    // Apply query filters (override role filter if admin has specific role filter)
    if (category) filter.category = category;
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedRole) filter.assignedRole = assignedRole;

    if (search) {
      filter.$or = [
        { subject: { $regex: search, $options: 'i' } },
        { ticketNumber: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const [data, total] = await Promise.all([
      this.ticketModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'fullName email phone')
        .populate('assignedTo', 'fullName email')
        .select('-messages')
        .lean(),
      this.ticketModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAdminTicketById(ticketId: string) {
    return this.getTicketById(ticketId); // No userId = no stripping, no ownership check
  }

  async addAdminReply(
    ticketId: string,
    adminId: string,
    adminName: string,
    dto: AdminTicketReplyDto,
  ) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');

    ticket.messages.push({
      senderId: new Types.ObjectId(adminId),
      senderType: TicketSenderType.ADMIN,
      senderName: adminName,
      content: dto.content,
      attachments: dto.attachments || [],
      isInternal: dto.isInternal || false,
      createdAt: new Date(),
    } as any);

    // Auto-move to IN_PROGRESS if still OPEN (and not an internal note)
    if (ticket.status === TicketStatus.OPEN && !dto.isInternal) {
      ticket.status = TicketStatus.IN_PROGRESS;
    }

    await ticket.save();
    return ticket;
  }

  async updateTicketStatus(ticketId: string, dto: UpdateTicketStatusDto) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');

    ticket.status = dto.status;

    if (dto.status === TicketStatus.RESOLVED) {
      ticket.resolvedAt = new Date();
    } else if (dto.status === TicketStatus.CLOSED) {
      ticket.closedAt = new Date();
      if (!ticket.resolvedAt) ticket.resolvedAt = new Date();
    }

    await ticket.save();
    return ticket;
  }

  async reassignTicket(ticketId: string, dto: ReassignTicketDto) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (dto.assignedRole) {
      ticket.assignedRole = dto.assignedRole;
    }
    if (dto.assignedTo !== undefined) {
      ticket.assignedTo = dto.assignedTo ? new Types.ObjectId(dto.assignedTo) : null;
    }

    await ticket.save();
    this.logger.log(
      `Ticket ${ticket.ticketNumber} reassigned → role: ${ticket.assignedRole}, admin: ${ticket.assignedTo}`,
    );
    return ticket;
  }

  async getTicketStats(adminRoleSlug: string, permissions: string[]) {
    const matchStage: any = {};

    if (!GLOBAL_TICKET_ROLES.includes(adminRoleSlug)) {
      matchStage.assignedRole = adminRoleSlug;
    }

    const [statusCounts, priorityCounts, totalToday] = await Promise.all([
      this.ticketModel.aggregate([
        { $match: matchStage },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.ticketModel.aggregate([
        { $match: { ...matchStage, status: { $nin: [TicketStatus.CLOSED, TicketStatus.RESOLVED] } } },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
      ]),
      this.ticketModel.countDocuments({
        ...matchStage,
        createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const s of statusCounts) byStatus[s._id] = s.count;

    const byPriority: Record<string, number> = {};
    for (const p of priorityCounts) byPriority[p._id] = p.count;

    return {
      byStatus,
      byPriority,
      totalToday,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    };
  }
}
