/**
 * User Schema
 * 
 * Core user model with authentication fields.
 * Supports both email/password and social auth (Google/Apple).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

@Schema({
  timestamps: true,
  collection: 'users',
})
export class User {
  /**
   * User's email address (unique, optional for Apple edge case)
   */
  @Prop({
    type: String,
    unique: true,
    sparse: true, // Allows multiple null values
    lowercase: true,
    trim: true,
    index: true,
  })
  email?: string;

  /**
   * User's phone number (unique, optional)
   */
  @Prop({
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    index: true,
  })
  phone?: string;

  /**
   * Hashed password (nullable for social auth users)
   */
  @Prop({ type: String })
  passwordHash?: string;

  /**
   * Email verification status
   */
  @Prop({ type: Boolean, default: false, index: true })
  isEmailVerified: boolean;

  /**
   * User roles for authorization
   */
  @Prop({
    type: [String],
    enum: Object.values(UserRole),
    default: [UserRole.USER],
  })
  roles: UserRole[];

  /**
   * Hashed 4-digit transaction PIN
   */
  @Prop({ type: String })
  transactionPinHash?: string;

  /**
   * User's full name (from social auth or profile)
   */
  @Prop({ type: String, trim: true })
  fullName?: string;

  /**
   * User's avatar URL (from social auth)
   */
  @Prop({ type: String })
  avatarUrl?: string;

  /**
   * User's unique referral code (auto-generated on registration)
   */
  @Prop({ type: String, unique: true, sparse: true })
  referralCode?: string;

  /**
   * User who referred this user
   */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  referredBy: Types.ObjectId | null;

  /**
   * Soft delete flag
   */
  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;

  /**
   * Login attempt tracking for account lockout
   */
  @Prop({ type: Number, default: 0 })
  failedLoginAttempts: number;

  @Prop({ type: Date, default: null })
  lockedUntil: Date | null;

  /**
   * Account status
   */
  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
    index: true,
  })
  status: UserStatus;

  /**
   * Timestamps (auto-managed)
   */
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ status: 1, isDeleted: 1 });
UserSchema.index({ referralCode: 1 }, { unique: true, sparse: true });

// Virtual for wallet (populated separately)
UserSchema.virtual('wallet', {
  ref: 'Wallet',
  localField: '_id',
  foreignField: 'userId',
  justOne: true,
});

// Auto-filter soft-deleted users on queries
// Admin queries that need deleted users should use { isDeleted: true } explicitly
UserSchema.pre('find', function () {
  if (this.getFilter().isDeleted === undefined) {
    this.where({ isDeleted: { $ne: true } });
  }
});
UserSchema.pre('findOne', function () {
  if (this.getFilter().isDeleted === undefined) {
    this.where({ isDeleted: { $ne: true } });
  }
});
UserSchema.pre('countDocuments', function () {
  if (this.getFilter().isDeleted === undefined) {
    this.where({ isDeleted: { $ne: true } });
  }
});

// Exclude sensitive fields from JSON
UserSchema.set('toJSON', {
  transform: (doc, ret: Record<string, any>) => {
    delete ret.passwordHash;
    delete ret.transactionPinHash;
    delete ret.__v;
    return ret;
  },
});
