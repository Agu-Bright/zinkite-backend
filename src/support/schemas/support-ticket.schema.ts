/**
 * Support Ticket Schema
 * Smart ticketing system with category-based admin role routing
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SupportTicketDocument = SupportTicket & Document;
export type TicketMessageDocument = TicketMessage & Document;

// ── Enums ──────────────────────────────────────────────

export enum TicketCategory {
  GIFT_CARD = 'GIFT_CARD',
  VTU = 'VTU',
  ELECTRICITY = 'ELECTRICITY',
  CRYPTO = 'CRYPTO',
  WALLET = 'WALLET',
  WITHDRAWAL = 'WITHDRAWAL',
  ACCOUNT = 'ACCOUNT',
  GENERAL = 'GENERAL',
}

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum TicketSenderType {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

// ── Category → Admin Role Mapping ──────────────────────

export const CATEGORY_ROLE_MAP: Record<TicketCategory, string> = {
  [TicketCategory.GIFT_CARD]: 'gift-card-admin',
  [TicketCategory.VTU]: 'vtu-operations-admin',
  [TicketCategory.ELECTRICITY]: 'vtu-operations-admin',
  [TicketCategory.CRYPTO]: 'crypto-admin',
  [TicketCategory.WALLET]: 'finance-admin',
  [TicketCategory.WITHDRAWAL]: 'finance-admin',
  [TicketCategory.ACCOUNT]: 'support-agent',
  [TicketCategory.GENERAL]: 'support-agent',
};

// Roles that can see ALL tickets regardless of assignedRole
export const GLOBAL_TICKET_ROLES = ['super-admin', 'support-agent'];

// ── Embedded Message Schema ────────────────────────────

@Schema({ _id: true, timestamps: false })
export class TicketMessage {
  @Prop({ type: Types.ObjectId, required: true })
  senderId: Types.ObjectId;

  @Prop({ type: String, enum: TicketSenderType, required: true })
  senderType: TicketSenderType;

  @Prop({ required: true })
  senderName: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [String], default: [] })
  attachments: string[];

  @Prop({ default: false })
  isInternal: boolean;

  @Prop({ type: Date, default: () => new Date() })
  createdAt: Date;
}

export const TicketMessageSchema = SchemaFactory.createForClass(TicketMessage);

// ── Main Ticket Schema ─────────────────────────────────

@Schema({ timestamps: true, collection: 'support_tickets' })
export class SupportTicket {
  @Prop({ required: true, unique: true })
  ticketNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: TicketCategory, required: true })
  category: TicketCategory;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: String, enum: TicketPriority, default: TicketPriority.MEDIUM })
  priority: TicketPriority;

  @Prop({ type: String, enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  /** Role slug that should handle this ticket (auto-set from category) */
  @Prop({ required: true })
  assignedRole: string;

  /** Specific admin user assigned (null = pool assignment by role) */
  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  assignedTo: Types.ObjectId | null;

  /** Optional link to a related transaction */
  @Prop({ type: String, default: null })
  relatedTransactionId: string | null;

  @Prop({ type: [String], default: [] })
  attachments: string[];

  /** Threaded conversation */
  @Prop({ type: [TicketMessageSchema], default: [] })
  messages: TicketMessage[];

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  @Prop({ type: Date, default: null })
  closedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);

// ── Indexes ────────────────────────────────────────────

SupportTicketSchema.index({ ticketNumber: 1 }, { unique: true });
SupportTicketSchema.index({ userId: 1, status: 1, createdAt: -1 });
SupportTicketSchema.index({ assignedRole: 1, status: 1, createdAt: -1 });
SupportTicketSchema.index({ assignedTo: 1, status: 1 });
SupportTicketSchema.index({ status: 1, priority: 1, createdAt: -1 });
SupportTicketSchema.index({ category: 1 });
