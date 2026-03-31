/**
 * Wallet Credit Request Schema
 * Dual-approval workflow for wallet credits
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WalletCreditRequestDocument = WalletCreditRequest & Document;

export enum CreditRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DENIED = 'DENIED',
}

@Schema({ timestamps: true, collection: 'wallet_credit_requests' })
export class WalletCreditRequest {
  @Prop({ type: Types.ObjectId, ref: 'AdminUser', required: true })
  requestedBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  amount: number; // in kobo

  @Prop({ required: true })
  reason: string;

  @Prop({ type: String, enum: CreditRequestStatus, default: CreditRequestStatus.PENDING })
  status: CreditRequestStatus;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  approvedBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  deniedBy: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  deniedReason: string | null;

  @Prop({ type: Types.ObjectId, default: null })
  walletTransactionId: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export const WalletCreditRequestSchema = SchemaFactory.createForClass(WalletCreditRequest);

WalletCreditRequestSchema.index({ requestedBy: 1, status: 1 });
WalletCreditRequestSchema.index({ userId: 1 });
WalletCreditRequestSchema.index({ status: 1, createdAt: -1 });
