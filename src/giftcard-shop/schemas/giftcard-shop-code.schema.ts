/**
 * Gift Card Shop Code Schema
 *
 * Individual gift card codes linked to a product.
 * Each code is a separate document for atomic purchase operations.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GiftCardShopCodeDocument = GiftCardShopCode & Document;

export enum ShopCodeStatus {
  AVAILABLE = 'AVAILABLE',
  SOLD = 'SOLD',
  RESERVED = 'RESERVED',
  DISABLED = 'DISABLED',
}

@Schema({
  timestamps: true,
  collection: 'giftcard_shop_codes',
})
export class GiftCardShopCode {
  @Prop({ type: Types.ObjectId, ref: 'GiftCardShopProduct', required: true, index: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  code: string;

  @Prop({ type: String, default: null })
  pin: string | null;

  @Prop({ type: String, default: null })
  serialNumber: string | null;

  @Prop({
    type: String,
    enum: ShopCodeStatus,
    default: ShopCodeStatus.AVAILABLE,
    index: true,
  })
  status: ShopCodeStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  purchasedBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'GiftCardShopPurchase', default: null })
  purchaseId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  purchasedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const GiftCardShopCodeSchema =
  SchemaFactory.createForClass(GiftCardShopCode);

// Indexes
GiftCardShopCodeSchema.index({ productId: 1, status: 1 });
GiftCardShopCodeSchema.index({ purchasedBy: 1 });
