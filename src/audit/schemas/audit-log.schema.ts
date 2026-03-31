/**
 * Audit Log Schema
 * Records all significant actions for security and compliance
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type AuditLogDocument = AuditLog & Document;

export enum AuditAction {
  // User actions
  USER_REGISTERED = 'USER_REGISTERED',
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  USER_EMAIL_VERIFIED = 'USER_EMAIL_VERIFIED',
  USER_PIN_SET = 'USER_PIN_SET',
  USER_PIN_RESET = 'USER_PIN_RESET',
  USER_PASSWORD_CHANGED = 'USER_PASSWORD_CHANGED',
  USER_PROFILE_UPDATED = 'USER_PROFILE_UPDATED',
  USER_SOCIAL_AUTH = 'USER_SOCIAL_AUTH',

  // Wallet actions
  WALLET_CREATED = 'WALLET_CREATED',
  WALLET_CREDITED = 'WALLET_CREDITED',
  WALLET_DEBITED = 'WALLET_DEBITED',
  WALLET_TOPUP_INITIATED = 'WALLET_TOPUP_INITIATED',
  WALLET_TOPUP_COMPLETED = 'WALLET_TOPUP_COMPLETED',

  // Gift card actions
  GIFTCARD_TRADE_SUBMITTED = 'GIFTCARD_TRADE_SUBMITTED',
  GIFTCARD_TRADE_APPROVED = 'GIFTCARD_TRADE_APPROVED',
  GIFTCARD_TRADE_REJECTED = 'GIFTCARD_TRADE_REJECTED',
  GIFTCARD_TRADE_CANCELLED = 'GIFTCARD_TRADE_CANCELLED',

  // VTU actions
  VTU_AIRTIME_PURCHASED = 'VTU_AIRTIME_PURCHASED',
  VTU_DATA_PURCHASED = 'VTU_DATA_PURCHASED',
  VTU_REFUNDED = 'VTU_REFUNDED',

  // Admin actions
  ADMIN_USER_STATUS_CHANGED = 'ADMIN_USER_STATUS_CHANGED',
  ADMIN_WALLET_ADJUSTMENT = 'ADMIN_WALLET_ADJUSTMENT',
  ADMIN_BRAND_CREATED = 'ADMIN_BRAND_CREATED',
  ADMIN_BRAND_UPDATED = 'ADMIN_BRAND_UPDATED',
  ADMIN_CATEGORY_CREATED = 'ADMIN_CATEGORY_CREATED',
  ADMIN_CATEGORY_UPDATED = 'ADMIN_CATEGORY_UPDATED',
  ADMIN_RATE_CREATED = 'ADMIN_RATE_CREATED',
  ADMIN_RATE_UPDATED = 'ADMIN_RATE_UPDATED',
  ADMIN_VTU_REFUND = 'ADMIN_VTU_REFUND',

  // Admin RBAC actions
  ADMIN_LOGIN = 'ADMIN_LOGIN',
  ADMIN_LOGIN_FAILED = 'ADMIN_LOGIN_FAILED',
  ADMIN_2FA_ENABLED = 'ADMIN_2FA_ENABLED',
  ADMIN_2FA_DISABLED = 'ADMIN_2FA_DISABLED',
  ADMIN_USER_CREATED = 'ADMIN_USER_CREATED',
  ADMIN_USER_UPDATED = 'ADMIN_USER_UPDATED',
  ADMIN_USER_DEACTIVATED = 'ADMIN_USER_DEACTIVATED',
  ADMIN_ROLE_CREATED = 'ADMIN_ROLE_CREATED',
  ADMIN_ROLE_UPDATED = 'ADMIN_ROLE_UPDATED',
  ADMIN_ROLE_DELETED = 'ADMIN_ROLE_DELETED',
  ADMIN_SETTINGS_UPDATED = 'ADMIN_SETTINGS_UPDATED',

  // System actions
  WEBHOOK_RECEIVED = 'WEBHOOK_RECEIVED',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
}

export enum AuditResource {
  USER = 'USER',
  WALLET = 'WALLET',
  TRANSACTION = 'TRANSACTION',
  GIFTCARD_TRADE = 'GIFTCARD_TRADE',
  GIFTCARD_BRAND = 'GIFTCARD_BRAND',
  GIFTCARD_CATEGORY = 'GIFTCARD_CATEGORY',
  GIFTCARD_RATE = 'GIFTCARD_RATE',
  VTU_AIRTIME = 'VTU_AIRTIME',
  VTU_DATA = 'VTU_DATA',
  PAYSTACK = 'PAYSTACK',
  SYSTEM = 'SYSTEM',
  ADMIN_USER = 'ADMIN_USER',
  ADMIN_ROLE = 'ADMIN_ROLE',
  SETTINGS = 'SETTINGS',
}

export enum AuditStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
}

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, ret: Record<string, any>) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class AuditLog {
  @ApiProperty({ description: 'User who performed the action (null for system actions)' })
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  userId: Types.ObjectId | null;

  @ApiProperty({ description: 'Admin who performed the action (for admin actions)' })
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  adminId: Types.ObjectId | null;

  @ApiProperty({ description: 'Action performed', enum: AuditAction })
  @Prop({ type: String, enum: AuditAction, required: true })
  action: AuditAction;

  @ApiProperty({ description: 'Resource type affected', enum: AuditResource })
  @Prop({ type: String, enum: AuditResource, required: true })
  resource: AuditResource;

  @ApiProperty({ description: 'Resource ID (if applicable)', required: false })
  @Prop({ type: String, default: null })
  resourceId: string | null;

  @ApiProperty({ description: 'Action status', enum: AuditStatus })
  @Prop({ type: String, enum: AuditStatus, default: AuditStatus.SUCCESS })
  status: AuditStatus;

  @ApiProperty({ description: 'Description of the action' })
  @Prop({ type: String, required: true })
  description: string;

  @ApiProperty({ description: 'Previous values (for updates)', required: false })
  @Prop({ type: Object, default: null })
  previousValues: Record<string, any> | null;

  @ApiProperty({ description: 'New values (for updates)', required: false })
  @Prop({ type: Object, default: null })
  newValues: Record<string, any> | null;

  @ApiProperty({ description: 'Additional metadata' })
  @Prop({ type: Object, default: {} })
  meta: Record<string, any>;

  @ApiProperty({ description: 'IP address of the requester', required: false })
  @Prop({ type: String, default: null })
  ipAddress: string | null;

  @ApiProperty({ description: 'User agent string', required: false })
  @Prop({ type: String, default: null })
  userAgent: string | null;

  @ApiProperty({ description: 'Request ID for correlation', required: false })
  @Prop({ type: String, default: null })
  requestId: string | null;

  @ApiProperty({ description: 'Error message (if failed)', required: false })
  @Prop({ type: String, default: null })
  errorMessage: string | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Update timestamp' })
  updatedAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Indexes for efficient queries
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ adminId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ resource: 1, resourceId: 1 }); 
AuditLogSchema.index({ status: 1 });
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ requestId: 1 });

// TTL index - keep audit logs for 2 years (730 days)
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 730 * 24 * 60 * 60 });

// Text index for searching
AuditLogSchema.index({ description: 'text', errorMessage: 'text' });