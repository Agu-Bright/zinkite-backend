/**
 * PaystackTransaction Schema
 * 
 * Stores Paystack payment transaction records.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export type PaystackTransactionDocument = PaystackTransaction & Document;

export enum PaystackTransactionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  ABANDONED = 'ABANDONED',
}

@Schema({
  timestamps: true,
  collection: 'paystack_transactions',
})
export class PaystackTransaction {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  reference: string;

  @Prop({ type: Number, required: true })
  amount: number; // In kobo

  @Prop({
    type: String,
    required: true,
    enum: Object.values(PaystackTransactionStatus),
    default: PaystackTransactionStatus.PENDING,
  })
  status: PaystackTransactionStatus;

  @Prop({ type: String })
  authorizationUrl?: string;

  @Prop({ type: String })
  accessCode?: string;

  @Prop({ type: String })
  channel?: string;

  @Prop({ type: String })
  gatewayResponse?: string;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ type: MongooseSchema.Types.Mixed })
  rawWebhookEvent?: Record<string, any>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, any>;

  createdAt: Date;
  updatedAt: Date;
}

export const PaystackTransactionSchema =
  SchemaFactory.createForClass(PaystackTransaction);

// Indexes
PaystackTransactionSchema.index({ createdAt: -1 });
PaystackTransactionSchema.index({ status: 1 });
PaystackTransactionSchema.index({ userId: 1, createdAt: -1 });