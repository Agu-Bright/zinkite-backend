/**
 * User Notification Schema
 * Stores in-app notifications for the user's notification inbox.
 * Every push notification is also persisted here.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserNotificationDocument = UserNotification & Document;

export enum NotificationType {
  TRANSACTION = 'TRANSACTION',
  TRADE = 'TRADE',
  SECURITY = 'SECURITY',
  PROMOTION = 'PROMOTION',
  SYSTEM = 'SYSTEM',
}

@Schema({
  timestamps: true,
  collection: 'user_notifications',
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
export class UserNotification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  body: string;

  @Prop({
    type: String,
    enum: NotificationType,
    default: NotificationType.SYSTEM,
  })
  type: NotificationType;

  @Prop({ type: String, default: null })
  category: string | null;

  @Prop({ type: Boolean, default: false, index: true })
  isRead: boolean;

  @Prop({ type: Object, default: {} })
  data: Record<string, any>;

  @Prop({ type: Object, default: {} })
  meta: Record<string, any>;

  createdAt: Date;
  updatedAt: Date;
}

export const UserNotificationSchema =
  SchemaFactory.createForClass(UserNotification);

UserNotificationSchema.index({ userId: 1, createdAt: -1 });
UserNotificationSchema.index({ userId: 1, isRead: 1 });
// Auto-delete after 90 days
UserNotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
