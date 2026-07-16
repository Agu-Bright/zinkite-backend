/**
 * Gift Card Trade Schema
 * Represents a user's gift card trade submission
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { CategoryCurrency } from './gift-card-category.schema';

export type GiftCardTradeDocument = GiftCardTrade & Document;

export enum TradeStatus {
  PENDING = 'PENDING',      // Awaiting admin review
  PROCESSING = 'PROCESSING', // Being reviewed by admin (or, for LOST_DIGITS, awaiting user response to offer)
  APPROVED = 'APPROVED',    // Approved and wallet credited
  REJECTED = 'REJECTED',    // Rejected by admin
  CANCELLED = 'CANCELLED',  // Cancelled by user (or user rejected admin offer for LOST_DIGITS)
}

export enum TradeType {
  STANDARD = 'STANDARD',       // Regular trade: user knows card value, backend applies rate
  LOST_DIGITS = 'LOST_DIGITS', // Card has missing/hidden digits: admin proposes an offer, user accepts/rejects
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

  @ApiProperty({ description: 'Reference to rate applied (nullable for LOST_DIGITS trades — no rate at submit time)' })
  @Prop({ type: Types.ObjectId, ref: 'GiftCardRate', default: null })
  rateId: Types.ObjectId | null;

  @ApiProperty({ description: 'Unique trade reference', example: 'GC-ABC12345' })
  @Prop({ type: String, required: true, unique: true })
  reference: string;

  @ApiProperty({ description: 'Trade type — STANDARD or LOST_DIGITS', enum: TradeType })
  @Prop({ type: String, enum: TradeType, default: TradeType.STANDARD })
  tradeType: TradeType;

  @ApiProperty({ description: 'Card value in the category currency (0 for LOST_DIGITS until offer is made)', example: 50 })
  @Prop({ type: Number, default: 0, min: 0 })
  cardValueUsd: number;

  @ApiProperty({ description: 'Snapshotted currency at trade time', enum: CategoryCurrency })
  @Prop({ type: String, enum: CategoryCurrency, default: CategoryCurrency.USD })
  currency: CategoryCurrency;

  @ApiProperty({ description: 'Exchange rate applied (NGN per 1 unit of currency; 0 for LOST_DIGITS)', example: 450 })
  @Prop({ type: Number, default: 0, min: 0 })
  rateApplied: number;

  @ApiProperty({ description: 'Amount to credit in NGN (kobo). 0 until admin offer is accepted for LOST_DIGITS.', example: 2250000 })
  @Prop({ type: Number, default: 0, min: 0 })
  amountNgn: number;

  // ============================================
  // LOST_DIGITS offer negotiation fields
  // ============================================

  @ApiProperty({ description: 'Admin-proposed payout in kobo (LOST_DIGITS only)', required: false })
  @Prop({ type: Number, default: null, min: 0 })
  offerAmount: number | null;

  @ApiProperty({ description: 'Admin note attached to the offer', required: false })
  @Prop({ type: String, default: null })
  offerNote: string | null;

  @ApiProperty({ description: 'When the admin made the offer', required: false })
  @Prop({ type: Date, default: null })
  offerMadeAt: Date | null;

  @ApiProperty({ description: 'When the user accepted or rejected the offer', required: false })
  @Prop({ type: Date, default: null })
  offerRespondedAt: Date | null;

  @ApiProperty({ description: 'Card code/serial (encrypted)', required: false })
  @Prop({ type: String, default: null })
  cardCode: string | null;

  @ApiProperty({ description: 'Card PIN (encrypted)', required: false })
  @Prop({ type: String, default: null })
  cardPin: string | null;

  @ApiProperty({ description: 'Proof image URLs', type: [String] })
  @Prop({ type: [String], default: [] })
  proofImages: string[];

  @ApiProperty({
    description:
      'URL of the purchase receipt image (required for LOST_DIGITS trades). Helps verify card origin when the code is unreadable.',
    required: false,
  })
  @Prop({ type: String, default: null })
  receiptImageUrl: string | null;

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
GiftCardTradeSchema.index({ tradeType: 1, status: 1, createdAt: -1 });
GiftCardTradeSchema.index({ reference: 1 }, { unique: true });
GiftCardTradeSchema.index({ brandId: 1 });
GiftCardTradeSchema.index({ categoryId: 1 });
GiftCardTradeSchema.index({ reviewedBy: 1 });
GiftCardTradeSchema.index({ createdAt: -1 });

// Text index for searching
GiftCardTradeSchema.index({ reference: 'text', adminNotes: 'text', userNotes: 'text' });