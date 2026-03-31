/**
 * Admin Role Schema
 * Defines permission-based roles for admin users
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AdminRoleDocument = AdminRole & Document;

@Schema({ timestamps: true })
export class AdminRole {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: [String], default: [] })
  permissions: string[];

  @Prop({ default: false })
  isSystem: boolean;

  @Prop({ default: true })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const AdminRoleSchema = SchemaFactory.createForClass(AdminRole);

AdminRoleSchema.index({ slug: 1 });
AdminRoleSchema.index({ isActive: 1 });
