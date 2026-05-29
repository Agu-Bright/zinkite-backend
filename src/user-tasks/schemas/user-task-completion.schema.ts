/**
 * User Task Completion Schema
 *
 * Tracks which users have completed which tasks.
 * Unique compound index on (userId, taskKey) prevents double completion.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserTaskCompletionDocument = UserTaskCompletion & Document;

@Schema({ timestamps: true, collection: 'user_task_completions' })
export class UserTaskCompletion {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'UserTask', required: true })
  taskId: Types.ObjectId;

  @Prop({ required: true })
  taskKey: string;

  @Prop({ type: Number, default: 0 })
  rewardAmountKobo: number;

  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction' })
  walletTransactionId?: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date() })
  completedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const UserTaskCompletionSchema =
  SchemaFactory.createForClass(UserTaskCompletion);

UserTaskCompletionSchema.index({ userId: 1, taskKey: 1 }, { unique: true });
UserTaskCompletionSchema.index({ taskId: 1 });
