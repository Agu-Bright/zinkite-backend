/**
 * KorapayTransaction Schema
 *
 * Stores Kora Pay payment transaction records (collections + payouts).
 * Mirrors PaystackTransaction so admin tooling can treat both uniformly.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export type KorapayTransactionDocument = KorapayTransaction & Document;

export enum KorapayTransactionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  ABANDONED = 'ABANDONED',
}

export enum KorapayTransactionType {
  CHARGE = 'CHARGE', // collection / topup
  TRANSFER = 'TRANSFER', // payout / withdrawal
}

@Schema({
  timestamps: true,
  collection: 'korapay_transactions',
})
export class KorapayTransaction {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  reference: string;

  @Prop({ type: Number, required: true })
  amount: number; // In kobo

  @Prop({
    type: String,
    required: true,
    enum: Object.values(KorapayTransactionType),
    default: KorapayTransactionType.CHARGE,
  })
  type: KorapayTransactionType;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(KorapayTransactionStatus),
    default: KorapayTransactionStatus.PENDING,
  })
  status: KorapayTransactionStatus;

  @Prop({ type: String })
  checkoutUrl?: string;

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

export const KorapayTransactionSchema =
  SchemaFactory.createForClass(KorapayTransaction);

KorapayTransactionSchema.index({ createdAt: -1 });
KorapayTransactionSchema.index({ status: 1 });
KorapayTransactionSchema.index({ userId: 1, createdAt: -1 });
