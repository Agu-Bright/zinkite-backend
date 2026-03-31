/**
 * Gift Card Buy Order Schema
 *
 * Tracks gift card purchase orders placed via Reloadly.
 * All monetary amounts are stored in kobo (1 NGN = 100 kobo).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GiftCardBuyOrderDocument = GiftCardBuyOrder & Document;

export enum BuyOrderStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

@Schema({ timestamps: true, collection: 'giftcard_buy_orders' })
export class GiftCardBuyOrder {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  reference: string;

  @Prop({ required: true })
  reloadlyProductId: number;

  @Prop({ required: true })
  productName: string;

  @Prop({ required: true })
  brandName: string;

  @Prop({ required: true })
  countryCode: string;

  @Prop({ required: true })
  denominationType: string;

  @Prop({ required: true })
  unitPrice: number; // Face value in recipient currency (e.g. 5 USD)

  @Prop({ required: true })
  recipientCurrencyCode: string;

  @Prop({ default: 1 })
  quantity: number;

  // ─── Pricing (all in kobo) ──────────────────────────────────
  @Prop({ required: true })
  reloadlyCostNgn: number; // What Reloadly charges us

  @Prop({ default: 0 })
  reloadlyDiscount: number; // Reloadly discount amount

  @Prop({ required: true })
  markupPercentage: number; // Applied markup %

  @Prop({ required: true })
  markupAmountNgn: number; // Markup amount

  @Prop({ required: true })
  totalChargedNgn: number; // User pays this

  @Prop({ default: 0 })
  profitNgn: number; // reloadlyDiscount + markupAmount

  // ─── Reloadly Response ──────────────────────────────────────
  @Prop({ type: Number, default: null })
  reloadlyTransactionId: number | null;

  @Prop({ type: String, default: null })
  reloadlyStatus: string | null;

  // ─── Redeem Codes ──────────────────────────────────────────
  @Prop({ type: String, default: null })
  cardNumber: string | null; // First code (backward compat)

  @Prop({ type: String, default: null })
  pinCode: string | null; // First PIN (backward compat)

  @Prop({ type: [{ cardNumber: String, pinCode: String }], default: [] })
  redeemCodes: { cardNumber: string | null; pinCode: string | null }[];

  // ─── Redeem Instructions (copied from product at purchase) ─
  @Prop({ type: String, default: null })
  redeemInstructionConcise: string | null;

  @Prop({ type: String, default: null })
  redeemInstructionVerbose: string | null;

  // ─── Status ─────────────────────────────────────────────────
  @Prop({
    required: true,
    enum: BuyOrderStatus,
    default: BuyOrderStatus.PENDING,
    index: true,
  })
  status: BuyOrderStatus;

  @Prop({ type: String, default: null })
  failureReason: string | null;

  // ─── Wallet Linkage ─────────────────────────────────────────
  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction', default: null })
  walletTransactionId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction', default: null })
  refundTransactionId: Types.ObjectId | null;

  // ─── Extra ──────────────────────────────────────────────────
  @Prop({ type: Object, default: {} })
  meta: Record<string, any>;

  createdAt: Date;
  updatedAt: Date;
}

export const GiftCardBuyOrderSchema =
  SchemaFactory.createForClass(GiftCardBuyOrder);

// Indexes
GiftCardBuyOrderSchema.index({ userId: 1, createdAt: -1 });
GiftCardBuyOrderSchema.index({ status: 1, createdAt: -1 });
GiftCardBuyOrderSchema.index({ reloadlyTransactionId: 1 });
