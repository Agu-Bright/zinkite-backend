import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationTokenDocument = NotificationToken & Document;

@Schema({ timestamps: true, collection: 'notification_tokens' })
export class NotificationToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  token: string;

  @Prop({ enum: ['ios', 'android'], required: true })
  platform: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const NotificationTokenSchema =
  SchemaFactory.createForClass(NotificationToken);

// Compound unique index: one token per user
NotificationTokenSchema.index({ userId: 1, token: 1 }, { unique: true });
