/**
 * Gift Card Trade Schema
 * Represents a user's gift card trade submission
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type GiftCardTradeDocument = GiftCardTrade & Document;

export enum TradeStatus {
  PENDING = 'PENDING',      // Awaiting admin review
  PROCESSING = 'PROCESSING', // Being reviewed by admin
  APPROVED = 'APPROVED',    // Approved and wallet credited
  REJECTED = 'REJECTED',    // Rejected by admin
  CANCELLED = 'CANCELLED',  // Cancelled by user
}

@Schema({
  timestamps: true,
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
export class GiftCardTrade {
  @ApiProperty({ description: 'Reference to user' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @ApiProperty({ description: 'Reference to brand' })
  @Prop({ type: Types.ObjectId, ref: 'GiftCardBrand', required: true })
  brandId: Types.ObjectId;

  @ApiProperty({ description: 'Reference to category' })
  @Prop({ type: Types.ObjectId, ref: 'GiftCardCategory', required: true })
  categoryId: Types.ObjectId;

  @ApiProperty({ description: 'Reference to rate applied' })
  @Prop({ type: Types.ObjectId, ref: 'GiftCardRate', required: true })
  rateId: Types.ObjectId;

  @ApiProperty({ description: 'Unique trade reference', example: 'GC-ABC12345' })
  @Prop({ type: String, required: true, unique: true })
  reference: string;

  @ApiProperty({ description: 'Card value in USD', example: 50 })
  @Prop({ type: Number, required: true, min: 0 })
  cardValueUsd: number;

  @ApiProperty({ description: 'Exchange rate applied (NGN per USD)', example: 450 })
  @Prop({ type: Number, required: true, min: 0 })
  rateApplied: number;

  @ApiProperty({ description: 'Amount to credit in NGN (kobo)', example: 2250000 })
  @Prop({ type: Number, required: true, min: 0 })
  amountNgn: number;

  @ApiProperty({ description: 'Card code/serial (encrypted)', required: false })
  @Prop({ type: String, default: null })
  cardCode: string | null;

  @ApiProperty({ description: 'Card PIN (encrypted)', required: false })
  @Prop({ type: String, default: null })
  cardPin: string | null;

  @ApiProperty({ description: 'Proof image URLs', type: [String] })
  @Prop({ type: [String], default: [] })
  proofImages: string[];

  @ApiProperty({ description: 'Trade status', enum: TradeStatus })
  @Prop({ type: String, enum: TradeStatus, default: TradeStatus.PENDING })
  status: TradeStatus;

  @ApiProperty({ description: 'User notes/comments', required: false })
  @Prop({ type: String, default: null })
  userNotes: string | null;

  @ApiProperty({ description: 'Admin notes', required: false })
  @Prop({ type: String, default: null })
  adminNotes: string | null;

  @ApiProperty({ description: 'Rejection reason (if rejected)', required: false })
  @Prop({ type: String, default: null })
  rejectionReason: string | null;

  @ApiProperty({ description: 'Admin who reviewed the trade', required: false })
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy: Types.ObjectId | null;

  @ApiProperty({ description: 'Review timestamp', required: false })
  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  @ApiProperty({ description: 'Wallet transaction ID after approval', required: false })
  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction', default: null })
  walletTransactionId: Types.ObjectId | null;

  @ApiProperty({ description: 'Additional metadata' })
  @Prop({ type: Object, default: {} })
  meta: Record<string, any>;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

export const GiftCardTradeSchema = SchemaFactory.createForClass(GiftCardTrade);

// Indexes for efficient queries
GiftCardTradeSchema.index({ userId: 1, createdAt: -1 });
GiftCardTradeSchema.index({ status: 1, createdAt: -1 });
GiftCardTradeSchema.index({ reference: 1 }, { unique: true });
GiftCardTradeSchema.index({ brandId: 1 });
GiftCardTradeSchema.index({ categoryId: 1 });
GiftCardTradeSchema.index({ reviewedBy: 1 });
GiftCardTradeSchema.index({ createdAt: -1 });

// Text index for searching
GiftCardTradeSchema.index({ reference: 'text', adminNotes: 'text', userNotes: 'text' });