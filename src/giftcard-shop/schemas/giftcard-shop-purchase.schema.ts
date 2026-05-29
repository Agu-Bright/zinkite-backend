/**
 * Gift Card Shop Purchase Schema
 *
 * Tracks gift card purchases from the admin-stocked shop.
 * All monetary amounts are stored in kobo (1 NGN = 100 kobo).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GiftCardShopPurchaseDocument = GiftCardShopPurchase & Document;

export enum ShopPurchaseStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

@Schema({
  timestamps: true,
  collection: 'giftcard_shop_purchases',
})
export class GiftCardShopPurchase {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GiftCardShopProduct', required: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'GiftCardShopCode', default: null })
  codeId: Types.ObjectId | null;

  @Prop({ required: true, unique: true, index: true })
  reference: string;

  // ─── Snapshot at purchase time ──────────────────────────────
  @Prop({ required: true })
  brandName: string;

  @Prop({ required: true })
  denominationValue: number;

  @Prop({ required: true })
  denominationCurrency: string;

  // ─── Pricing ────────────────────────────────────────────────
  @Prop({ required: true, min: 0 })
  amountChargedNgn: number; // In kobo

  // ─── Status ─────────────────────────────────────────────────
  @Prop({
    required: true,
    enum: ShopPurchaseStatus,
    default: ShopPurchaseStatus.PENDING,
    index: true,
  })
  status: ShopPurchaseStatus;

  // ─── Card Details (delivered to user) ───────────────────────
  @Prop({ type: String, default: null })
  cardCode: string | null;

  @Prop({ type: String, default: null })
  cardPin: string | null;

  // ─── Wallet Linkage ─────────────────────────────────────────
  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction', default: null })
  walletTransactionId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction', default: null })
  refundTransactionId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  failureReason: string | null;

  @Prop({ type: Object, default: {} })
  meta: Record<string, any>;

  createdAt: Date;
  updatedAt: Date;
}

export const GiftCardShopPurchaseSchema =
  SchemaFactory.createForClass(GiftCardShopPurchase);

// Indexes
GiftCardShopPurchaseSchema.index({ userId: 1, createdAt: -1 });
GiftCardShopPurchaseSchema.index({ status: 1, createdAt: -1 });
GiftCardShopPurchaseSchema.index({ productId: 1 });
