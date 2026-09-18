import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BlockedIpDocument = BlockedIp & Document;

@Schema({ timestamps: true, collection: 'blocked_ips' })
export class BlockedIp {
  @Prop({ required: true, unique: true, trim: true })
  ipAddress: string;

  @Prop({ required: true, trim: true })
  reason: string;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', required: true })
  blockedBy: Types.ObjectId;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ type: Date, default: null })
  unblockedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  unblockedBy: Types.ObjectId | null;
}

export const BlockedIpSchema = SchemaFactory.createForClass(BlockedIp);
BlockedIpSchema.index({ ipAddress: 1, isActive: 1 });
