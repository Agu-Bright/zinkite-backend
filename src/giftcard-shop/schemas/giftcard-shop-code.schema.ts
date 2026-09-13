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

  // A deliverable card can be a text code and/or an image of the card. At
  // least one of `code` / `imageUrl` is present (enforced in the service).
  @Prop({ type: String, default: null })
  code: string | null;

  @Prop({ type: String, default: null })
  pin: string | null;

  @Prop({ type: String, default: null })
  serialNumber: string | null;

  // Secret card image (e.g. a scan/photo of the card). Stored only on this
  // hidden code doc and copied to the purchase on sale — never returned by
  // any browse/detail endpoint.
  @Prop({ type: String, default: null })
  imageUrl: string | null;

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
