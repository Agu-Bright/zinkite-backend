/**
 * User Task Schema
 *
 * Defines tasks that users can complete for rewards.
 * System tasks are seeded on startup; custom tasks are admin-created.
 * All monetary amounts stored in kobo (1 NGN = 100 kobo).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserTaskDocument = UserTask & Document;

export enum UserTaskStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ENDED = 'ENDED',
}

@Schema({ timestamps: true, collection: 'user_tasks' })
export class UserTask {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ required: true, unique: true, index: true })
  taskKey: string;

  @Prop({ type: Boolean, default: false })
  isSystem: boolean;

  @Prop({ type: Number, default: 0 })
  rewardAmountKobo: number;

  @Prop({
    type: String,
    enum: Object.values(UserTaskStatus),
    default: UserTaskStatus.ACTIVE,
  })
  status: UserTaskStatus;

  @Prop({ type: Number, default: 0 })
  displayOrder: number;

  @Prop({ type: String, default: 'checkmark-circle' })
  iconName: string;

  @Prop({ type: String, default: '' })
  actionRoute: string;

  @Prop({ type: Date })
  startsAt?: Date;

  @Prop({ type: Date })
  endsAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser' })
  createdBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const UserTaskSchema = SchemaFactory.createForClass(UserTask);

UserTaskSchema.index({ taskKey: 1 });
UserTaskSchema.index({ status: 1, displayOrder: 1 });
