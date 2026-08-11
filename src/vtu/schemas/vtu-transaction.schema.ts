import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type VtuTransactionDocument = HydratedDocument<VtuTransaction>;

export enum VtuProductType {
  AIRTIME = 'AIRTIME',
  DATA = 'DATA',
  ELECTRICITY = 'ELECTRICITY',
  TV = 'TV',
}

export enum VtuTransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

@Schema({ timestamps: true, collection: 'vtu_transactions' })
export class VtuTransaction {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: VtuProductType, index: true })
  type: VtuProductType;

  @Prop({ required: true }) serviceId: string;
  @Prop() providerName?: string;
  @Prop({ required: true }) recipient: string;
  @Prop() phone?: string;
  @Prop() variationCode?: string;
  @Prop() variationName?: string;
  @Prop({ required: true }) amount: number; // kobo
  @Prop({ default: 'NGN' }) currency: string;

  @Prop({ required: true, unique: true, index: true }) reference: string;
  @Prop({ required: true, unique: true, index: true }) requestId: string;
  @Prop({ unique: true, sparse: true, index: true }) idempotencyKey?: string;
  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction' }) walletTransactionId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction' }) refundTransactionId?: Types.ObjectId;

  @Prop({ enum: VtuTransactionStatus, default: VtuTransactionStatus.PENDING, index: true })
  status: VtuTransactionStatus;
  @Prop() providerReference?: string;
  @Prop({ default: 0 }) providerCommission?: number; // kobo
  @Prop() failureReason?: string;
  @Prop() purchasedCode?: string;
  @Prop() units?: string;
  @Prop({ type: Object }) customer?: Record<string, any>;
  @Prop({ type: Object }) providerResponse?: Record<string, any>;
  @Prop({ type: Object }) meta?: Record<string, any>;
  @Prop({ default: 0 }) requeryCount: number;
  @Prop() lastRequeryAt?: Date;
  @Prop() completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const VtuTransactionSchema = SchemaFactory.createForClass(VtuTransaction);
VtuTransactionSchema.index({ userId: 1, createdAt: -1 });
VtuTransactionSchema.index({ status: 1, updatedAt: 1 });
VtuTransactionSchema.index({ type: 1, createdAt: -1 });
VtuTransactionSchema.index({ serviceId: 1, createdAt: -1 });
