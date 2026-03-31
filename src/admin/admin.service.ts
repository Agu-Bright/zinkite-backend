/**
 * Admin Service
 * Handles admin-specific business logic
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Connection, Types } from "mongoose";
import { User, UserDocument, UserStatus } from "../users/schemas/user.schema";
import { Wallet, WalletDocument } from "../wallet/schemas/wallet.schema";
import {
  WalletTransaction,
  WalletTransactionDocument,
  TransactionCategory,
  TransactionSource,
} from "../wallet/schemas/wallet-transaction.schema";
import {
  GiftCardTrade,
  GiftCardTradeDocument,
  TradeStatus,
} from "../giftcards/schemas/gift-card-trade.schema";
import {
  PaystackTransaction,
  PaystackTransactionDocument,
} from "../paystack/schemas/paystack-transaction.schema";
import { Withdrawal, WithdrawalDocument } from "../wallet/schemas/withdrawal.schema";
import {
  WalletCreditRequest,
  WalletCreditRequestDocument,
  CreditRequestStatus,
} from "./schemas/wallet-credit-request.schema";
import { WalletService } from "../wallet/wallet.service";
import { GiftCardsService } from "../giftcards/giftcards.service";
import {
  ManualWalletAdjustmentDto,
  AdjustmentType,
  UsersQueryDto,
  UpdateUserStatusDto,
  PaystackQueryDto,
  WithdrawalsQueryDto,
  CreditRequestsQueryDto,
  CreateCreditRequestDto,
  DenyCreditRequestDto,
  SendNotificationDto,
  NotificationRecipients,
  NotificationsQueryDto,
} from "./dto";
import { NotificationLog, NotificationLogDocument } from "./schemas/notification-log.schema";
import { EmailService } from "../email/email.service";
import { TransactionsQueryDto } from "../wallet/dto";
import {
  generateReference,
  paginate,
  calculateSkip,
  toKobo,
  toNaira,
} from "../common/utils/helpers";
import { PaginatedResult } from "../common/dto/pagination.dto";
import { ReviewTradeDto, TradeQueryDto } from "../giftcards/dto";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(WalletTransaction.name)
    private readonly walletTransactionModel: Model<WalletTransactionDocument>,
    @InjectModel(GiftCardTrade.name)
    private readonly tradeModel: Model<GiftCardTradeDocument>,
    @InjectModel(PaystackTransaction.name)
    private readonly paystackModel: Model<PaystackTransactionDocument>,
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<WithdrawalDocument>,
    @InjectModel(WalletCreditRequest.name)
    private readonly creditRequestModel: Model<WalletCreditRequestDocument>,
    @InjectModel(NotificationLog.name)
    private readonly notificationLogModel: Model<NotificationLogDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly walletService: WalletService,
    private readonly giftCardsService: GiftCardsService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ============================================
  // DASHBOARD & STATS
  // ============================================

  /**
   * Get admin dashboard statistics
   */
  async getDashboardStats(): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // User stats
    const totalUsers = await this.userModel.countDocuments({
      isDeleted: false,
    });
    const activeUsers = await this.userModel.countDocuments({
      isDeleted: false,
      status: UserStatus.ACTIVE,
    });
    const newUsersToday = await this.userModel.countDocuments({
      createdAt: { $gte: today },
    });

    // Wallet stats
    const walletAgg = await this.walletModel.aggregate([
      { $group: { _id: null, totalBalance: { $sum: "$balance" } } },
    ]);
    const totalWalletBalance = walletAgg[0]?.totalBalance || 0;

    // Trade stats
    const totalTrades = await this.tradeModel.countDocuments();
    const pendingTrades = await this.tradeModel.countDocuments({
      status: TradeStatus.PENDING,
    });
    const tradesToday = await this.tradeModel.countDocuments({
      createdAt: { $gte: today },
    });

    // Paystack topups
    const totalTopups = await this.paystackModel.countDocuments({
      status: "SUCCESS",
    });

    // Revenue (approved trades)
    const tradeRevenueAgg = await this.tradeModel.aggregate([
      {
        $match: {
          status: TradeStatus.APPROVED,
          reviewedAt: { $gte: today },
        },
      },
      { $group: { _id: null, total: { $sum: "$amountNgn" } } },
    ]);

    return {
      totalUsers,
      activeUsers,
      newUsersToday,
      totalWalletBalance: toNaira(totalWalletBalance),
      totalTrades,
      pendingTrades,
      tradesToday,
      totalTopups,
      revenueToday: toNaira(tradeRevenueAgg[0]?.total || 0),
    };
  }

  /**
   * Get recent activity for dashboard
   */
  async getDashboardRecent(): Promise<any> {
    const [recentTrades, recentTransactions] = await Promise.all([
      this.tradeModel
        .find()
        .populate("userId", "email phone fullName")
        .populate("brandId", "name logo")
        .populate("categoryId", "name currency")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      this.walletTransactionModel
        .find()
        .populate("userId", "email phone fullName")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    return {
      recentTrades: recentTrades.map((trade) => ({
        ...trade,
        amountNaira: toNaira(trade.amountNgn || 0),
      })),
      recentTransactions: recentTransactions.map((txn) => ({
        ...txn,
        amountNaira: toNaira(txn.amount || 0),
      })),
    };
  }

  // ============================================
  // USER MANAGEMENT
  // ============================================

  /**
   * Get all users with filters
   */
  async getUsers(query: UsersQueryDto): Promise<PaginatedResult<User>> {
    const filter: any = { isDeleted: false };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.isEmailVerified !== undefined) {
      filter.isEmailVerified = query.isEmailVerified;
    }

    if (query.hasPinSet !== undefined) {
      if (query.hasPinSet) {
        filter.transactionPinHash = { $ne: null };
      } else {
        filter.transactionPinHash = null;
      }
    }

    if (query.search) {
      filter.$or = [
        { email: { $regex: query.search, $options: "i" } },
        { phone: { $regex: query.search, $options: "i" } },
        { fullName: { $regex: query.search, $options: "i" } },
      ];
    }

    const total = await this.userModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const users = await this.userModel
      .find(filter)
      .select("-passwordHash -transactionPinHash")
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(users, total, page, limit);
  }

  /**
   * Get user details by ID
   */
  async getUserById(userId: string): Promise<any> {
    const user = await this.userModel
      .findById(userId)
      .select("-passwordHash -transactionPinHash");

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Get wallet info
    const wallet = await this.walletModel.findOne({
      userId: new Types.ObjectId(userId),
    });

    // Get recent transactions
    const recentTransactions = await this.walletTransactionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(10);

    // Get trade count
    const tradeCount = await this.tradeModel.countDocuments({
      userId: new Types.ObjectId(userId),
    });

    return {
      user,
      wallet: wallet
        ? {
            balance: toNaira(wallet.balance),
            status: wallet.status,
            lastTransactionAt: wallet.lastTransactionAt,
          }
        : null,
      recentTransactions: recentTransactions.map((t) => ({
        ...t.toObject(),
        amountNaira: toNaira(t.amount),
      })),
      stats: {
        tradeCount,
      },
    };
  }

  /**
   * Update user status (suspend/reactivate)
   */
  async updateUserStatus(
    userId: string,
    adminId: string,
    dto: UpdateUserStatusDto,
  ): Promise<User> {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const previousStatus = user.status;
    user.status = dto.status as UserStatus;
    await user.save();

    this.logger.log(
      `User ${userId} status changed to ${dto.status} by admin ${adminId}. Reason: ${dto.reason}`,
    );

    // Notify the user about status change
    const statusLabel = dto.status.toLowerCase();
    this.notificationsService.sendToUser(
      userId,
      'Account Status Updated',
      `Your account has been ${statusLabel}. ${dto.reason ? `Reason: ${dto.reason}` : ''}`.trim(),
      { type: 'account_status', status: dto.status, previousStatus },
      'SECURITY' as any,
      'account_status',
    ).catch((err) => this.logger.error(`Failed to notify user status change: ${err.message}`));

    return user;
  }

  // ============================================
  // WALLET MANAGEMENT
  // ============================================

  /**
   * Get all wallet transactions with filters (admin view - no userId required)
   */
  async getAllWalletTransactions(
    query: TransactionsQueryDto,
  ): Promise<PaginatedResult<WalletTransaction>> {
    const filter: any = {};

    if (query.type) {
      filter.type = query.type;
    }

    if (query.category) {
      filter.category = query.category;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    if (query.search) {
      filter.$or = [
        { reference: { $regex: query.search, $options: "i" } },
        { narration: { $regex: query.search, $options: "i" } },
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.walletTransactionModel.countDocuments(filter);
    const transactions = await this.walletTransactionModel
      .find(filter)
      .populate("userId", "email phone fullName")
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    // Map transactions with Naira conversions
    const mappedTransactions = transactions.map((t) => ({
      ...t.toObject(),
      amountNaira: toNaira(t.amount),
      balanceBeforeNaira: toNaira(t.balanceBefore ?? 0),
      balanceAfterNaira: toNaira(t.balanceAfter ?? 0),
    }));

    return paginate(mappedTransactions, total, page, limit);
  }
  /**
   * Get wallet transactions for a specific user (admin view)
   */
  async getUserWalletTransactions(
    userId: string,
    query: TransactionsQueryDto,
  ): Promise<PaginatedResult<WalletTransaction>> {
    const filter: any = { userId: new Types.ObjectId(userId) };

    if (query.type) {
      filter.type = query.type;
    }

    if (query.category) {
      filter.category = query.category;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.walletTransactionModel.countDocuments(filter);
    const transactions = await this.walletTransactionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    const mappedTransactions = transactions.map((t) => ({
      ...t.toObject(),
      amountNaira: toNaira(t.amount),
    }));

    return paginate(mappedTransactions, total, page, limit);
  }

  /**
   * Get single wallet transaction by ID
   */
  async getWalletTransactionById(id: string): Promise<any> {
    const transaction = await this.walletTransactionModel
      .findById(id)
      .populate("userId", "email phone fullName");

    if (!transaction) {
      throw new NotFoundException("Wallet transaction not found");
    }

    return {
      ...transaction.toObject(),
      amountNaira: toNaira(transaction.amount),
      balanceBeforeNaira: toNaira(transaction.balanceBefore ?? 0),
      balanceAfterNaira: toNaira(transaction.balanceAfter ?? 0),
    };
  }

  /**
   * Manual wallet adjustment (credit/debit)
   */
  async manualWalletAdjustment(
    adminId: string,
    dto: ManualWalletAdjustmentDto,
  ): Promise<WalletTransaction> {
    const user = await this.userModel.findById(dto.userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const reference = dto.internalReference || generateReference("ADJ");
    const amountKobo = toKobo(dto.amount);

    let transaction: WalletTransaction;

    if (dto.type === AdjustmentType.CREDIT) {
      transaction = await this.walletService.creditWallet({
        userId: dto.userId,
        amount: amountKobo,
        category: TransactionCategory.MANUAL,
        source: TransactionSource.MANUAL_ADJUSTMENT,
        reference,
        narration: `Admin adjustment: ${dto.reason}`,
        meta: {
          adminId,
          adjustmentType: "CREDIT",
          reason: dto.reason,
        },
      });
    } else {
      transaction = await this.walletService.debitWallet({
        userId: dto.userId,
        amount: amountKobo,
        category: TransactionCategory.MANUAL,
        source: TransactionSource.MANUAL_ADJUSTMENT,
        reference,
        narration: `Admin adjustment: ${dto.reason}`,
        meta: {
          adminId,
          adjustmentType: "DEBIT",
          reason: dto.reason,
        },
      });
    }

    this.logger.log(
      `Admin ${adminId} made ${dto.type} adjustment of NGN ${dto.amount} for user ${dto.userId}. Reason: ${dto.reason}`,
    );

    return transaction;
  }

  // ============================================
  // GIFT CARD TRADE MANAGEMENT
  // ============================================

  /**
   * Get all trades (admin view)
   */
  async getTrades(
    query: TradeQueryDto,
  ): Promise<PaginatedResult<GiftCardTrade>> {
    return this.giftCardsService.getAllTrades(query);
  }

  /**
   * Get a single trade by ID
   */
  async getTradeById(tradeId: string): Promise<GiftCardTrade> {
    return this.giftCardsService.getTradeById(tradeId);
  }

  /**
   * Review/approve/reject a trade
   */
  async reviewTrade(
    tradeId: string,
    adminId: string,
    dto: ReviewTradeDto,
  ): Promise<GiftCardTrade> {
    const result = await this.giftCardsService.reviewTrade(tradeId, adminId, dto);

    // Send push notification to user
    const userId = result.userId?.toString();
    if (userId && dto.status !== TradeStatus.PROCESSING) {
      const isApproved = dto.status === TradeStatus.APPROVED;
      this.notificationsService.sendToUser(
        userId,
        isApproved ? 'Trade Approved' : 'Trade Rejected',
        isApproved
          ? `Your gift card trade has been approved. Wallet credited.`
          : `Your gift card trade was rejected.${dto.rejectionReason ? ' Reason: ' + dto.rejectionReason : ''}`,
        { type: 'trade_review', tradeId },
        'TRADE' as any,
        isApproved ? 'trade_approved' : 'trade_rejected',
      ).catch((err) => this.logger.error('Failed to send trade notification:', err.message));
    }

    return result;
  }

  /**
   * Get trade statistics
   */
  async getTradeStats(): Promise<any> {
    return this.giftCardsService.getTradeStats();
  }

  // ============================================
  // PAYSTACK MANAGEMENT
  // ============================================

  /**
   * Get Paystack transactions
   */
  async getPaystackTransactions(
    query: PaystackQueryDto,
  ): Promise<PaginatedResult<PaystackTransaction>> {
    const filter: any = {};

    if (query.userId) {
      filter.userId = new Types.ObjectId(query.userId);
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.search) {
      filter.reference = { $regex: query.search, $options: "i" };
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    const total = await this.paystackModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const transactions = await this.paystackModel
      .find(filter)
      .populate("userId", "email phone fullName")
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    const mappedTransactions = transactions.map((t) => ({
      ...t.toObject(),
      amountNaira: toNaira(t.amount),
    }));

    return paginate(mappedTransactions, total, page, limit);
  }

  /**
   * Get single Paystack transaction
   */
  async getPaystackTransaction(id: string): Promise<any> {
    const transaction = await this.paystackModel
      .findById(id)
      .populate("userId", "email phone fullName");

    if (!transaction) {
      throw new NotFoundException("Paystack transaction not found");
    }

    return {
      ...transaction.toObject(),
      amountNaira: toNaira(transaction.amount),
    };
  }

  // ============================================
  // WITHDRAWALS (ADMIN VIEW)
  // ============================================

  /**
   * List withdrawals with optional status and search filters
   */
  async getWithdrawals(query: WithdrawalsQueryDto): Promise<PaginatedResult<any>> {
    const filter: any = {};

    if (query.status) filter.status = query.status;

    if (query.search) {
      filter.$or = [
        { reference: { $regex: query.search, $options: 'i' } },
        { accountName: { $regex: query.search, $options: 'i' } },
        { accountNumber: { $regex: query.search, $options: 'i' } },
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.withdrawalModel.countDocuments(filter);
    const data = await this.withdrawalModel
      .find(filter)
      .populate('userId', 'email fullName phone')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit)
      .lean();

    return paginate(data, total, page, limit);
  }

  // ============================================
  // WALLET CREDIT REQUESTS
  // ============================================

  /**
   * List credit requests with optional status filter
   */
  async getCreditRequests(query: CreditRequestsQueryDto): Promise<PaginatedResult<any>> {
    const filter: any = {};
    if (query.status) filter.status = query.status;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.creditRequestModel.countDocuments(filter);
    const data = await this.creditRequestModel
      .find(filter)
      .populate('requestedBy', 'fullName email')
      .populate('userId', 'fullName email')
      .populate('approvedBy', 'fullName email')
      .populate('deniedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit)
      .lean();

    return paginate(data, total, page, limit);
  }

  /**
   * Create a new credit request (amount in NGN — converted to kobo)
   */
  async createCreditRequest(dto: CreateCreditRequestDto, adminId: string): Promise<any> {
    if (!Types.ObjectId.isValid(dto.userId)) throw new BadRequestException('Invalid user ID');
    const user = await this.userModel.findById(dto.userId);
    if (!user) throw new NotFoundException('User not found');

    const amountKobo = toKobo(dto.amount);

    const req = await this.creditRequestModel.create({
      requestedBy: new Types.ObjectId(adminId),
      userId: new Types.ObjectId(dto.userId),
      amount: amountKobo,
      reason: dto.reason,
    });

    this.logger.log(`Credit request created by ${adminId} for user ${dto.userId} — amount: ${amountKobo} kobo`);

    return this.creditRequestModel
      .findById(req._id)
      .populate('requestedBy', 'fullName email')
      .populate('userId', 'fullName email')
      .lean();
  }

  /**
   * Approve a credit request — credits the user's wallet.
   * Enforces dual-approval: the requesting admin cannot approve their own request.
   */
  async approveCreditRequest(id: string, adminId: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid request ID');

    const req = await this.creditRequestModel.findById(id);
    if (!req) throw new NotFoundException('Credit request not found');
    if (req.status !== CreditRequestStatus.PENDING)
      throw new BadRequestException('Only PENDING requests can be approved');
    if (req.requestedBy.toString() === adminId)
      throw new BadRequestException('You cannot approve your own credit request');

    const txn = await this.walletService.creditWallet({
      userId: req.userId.toString(),
      amount: req.amount,
      category: TransactionCategory.MANUAL,
      source: TransactionSource.MANUAL_ADJUSTMENT,
      reference: generateReference('CREDIT_REQ'),
      narration: `Admin credit request approved: ${req.reason}`,
      meta: { adminId, creditRequestId: id },
    });

    req.status = CreditRequestStatus.APPROVED;
    req.approvedBy = new Types.ObjectId(adminId);
    req.walletTransactionId = (txn as any)._id;
    await req.save();

    this.logger.log(`Credit request ${id} approved by ${adminId}`);

    // Notify user about wallet credit
    this.notificationsService.sendToUser(
      req.userId.toString(),
      'Wallet Credited',
      `Your wallet has been credited with ₦${toNaira(req.amount).toLocaleString('en-NG')}.`,
      { type: 'wallet_credit', creditRequestId: id },
      'TRANSACTION' as any,
      'wallet_credit',
    ).catch((err) => this.logger.error('Failed to send credit notification:', err.message));

    return this.creditRequestModel
      .findById(id)
      .populate('requestedBy', 'fullName email')
      .populate('userId', 'fullName email')
      .populate('approvedBy', 'fullName email')
      .lean();
  }

  /**
   * Deny a credit request
   */
  async denyCreditRequest(id: string, adminId: string, dto: DenyCreditRequestDto): Promise<any> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid request ID');

    const req = await this.creditRequestModel.findById(id);
    if (!req) throw new NotFoundException('Credit request not found');
    if (req.status !== CreditRequestStatus.PENDING)
      throw new BadRequestException('Only PENDING requests can be denied');

    req.status = CreditRequestStatus.DENIED;
    req.deniedBy = new Types.ObjectId(adminId);
    req.deniedReason = dto.deniedReason;
    await req.save();

    this.logger.log(`Credit request ${id} denied by ${adminId}`);

    return this.creditRequestModel
      .findById(id)
      .populate('requestedBy', 'fullName email')
      .populate('userId', 'fullName email')
      .populate('deniedBy', 'fullName email')
      .lean();
  }

  // ============================================
  // NOTIFICATIONS
  // ============================================

  async sendNotification(dto: SendNotificationDto, adminId: string): Promise<{ sentCount: number }> {
    let users: { _id: string; email: string; fullName?: string }[] = [];

    if (dto.recipients === NotificationRecipients.INDIVIDUAL) {
      if (!dto.targetUserId) {
        throw new BadRequestException('targetUserId is required when recipients is individual');
      }
      const user = await this.userModel.findById(dto.targetUserId).select('_id email fullName status').lean();
      if (!user) throw new NotFoundException('User not found');
      users = [{ _id: (user as any)._id.toString(), email: user.email as string, fullName: (user as any).fullName }];
    } else {
      const filter: any = { isDeleted: false };
      if (dto.recipients === NotificationRecipients.ACTIVE) {
        filter.status = 'ACTIVE';
        filter.isEmailVerified = true;
      }
      const allUsers = await this.userModel.find(filter).select('_id email fullName').lean();
      users = allUsers.map((u: any) => ({ _id: u._id.toString(), email: u.email, fullName: u.fullName }));
    }

    let sentCount = 0;

    if (dto.type === 'email') {
      // Send emails in batches of 50 to avoid overwhelming SMTP
      const batchSize = 50;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map((u) =>
            this.emailService.send({
              to: u.email,
              subject: dto.subject,
              html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
                <h2 style="color:#003CED">${dto.subject}</h2>
                <p>${dto.body.replace(/\n/g, '<br>')}</p>
                <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
                <p style="color:#999;font-size:12px">Zinkite — Nigeria's trusted fintech platform</p>
              </div>`,
              text: dto.body,
            }).then(() => sentCount++)
              .catch(() => {/* skip failed individual sends */}),
          ),
        );
      }
    } else {
      // Push notification via Expo Push API + in-app persistence
      const userIds = users.map((u) => u._id);
      await this.notificationsService.sendToMultiple(
        userIds,
        dto.subject,
        dto.body,
        {},
        'PROMOTION' as any,
        'admin_broadcast',
      );
      sentCount = users.length;
    }

    // Log the notification
    await this.notificationLogModel.create({
      subject: dto.subject,
      body: dto.body,
      type: dto.type,
      recipients: dto.recipients,
      targetUserId: dto.targetUserId || null,
      sentCount,
      status: 'sent',
      sentBy: adminId,
    });

    return { sentCount };
  }

  async getNotificationHistory(query: NotificationsQueryDto): Promise<any> {
    const { page = 1, limit = 20 } = query;
    const skip = calculateSkip(page, limit);

    const [data, total] = await Promise.all([
      this.notificationLogModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('sentBy', 'fullName email')
        .lean(),
      this.notificationLogModel.countDocuments(),
    ]);

    return paginate(data, total, page, limit);
  }
}
