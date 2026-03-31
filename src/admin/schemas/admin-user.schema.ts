/**
 * Admin User Schema
 * Separate collection for admin authentication (distinct from regular users)
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AdminUserDocument = AdminUser & Document;

export enum AdminUserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

@Schema({ timestamps: true, collection: 'admin_users' })
export class AdminUser {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: Types.ObjectId, ref: 'AdminRole', required: true })
  roleId: Types.ObjectId;

  @Prop({ type: String, enum: AdminUserStatus, default: AdminUserStatus.ACTIVE })
  status: AdminUserStatus;

  @Prop({ type: String, default: null })
  twoFactorSecret: string | null;

  @Prop({ default: false })
  twoFactorEnabled: boolean;

  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null;

  @Prop({ type: String, default: null })
  lastLoginIp: string | null;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export const AdminUserSchema = SchemaFactory.createForClass(AdminUser);

AdminUserSchema.index({ email: 1 });
AdminUserSchema.index({ roleId: 1 });
AdminUserSchema.index({ status: 1 });
