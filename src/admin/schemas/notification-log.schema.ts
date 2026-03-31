import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationLogDocument = NotificationLog & Document;

@Schema({ timestamps: true, collection: 'notification_logs' })
export class NotificationLog {
  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  body: string;

  @Prop({ required: true, enum: ['email', 'push'], default: 'email' })
  type: string;

  @Prop({ required: true, enum: ['all', 'active', 'individual'], default: 'all' })
  recipients: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  targetUserId: Types.ObjectId | null;

  @Prop({ default: 0 })
  sentCount: number;

  @Prop({ default: 'sent' })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  sentBy: Types.ObjectId | null;
}

export const NotificationLogSchema = SchemaFactory.createForClass(NotificationLog);
