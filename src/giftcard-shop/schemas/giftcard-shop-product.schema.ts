/**
 * Gift Card Shop Product Schema
 *
 * Represents a gift card product that admin uploads for users to buy.
 * All monetary amounts are stored in kobo (1 NGN = 100 kobo).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type GiftCardShopProductDocument = GiftCardShopProduct & Document;

export enum ShopProductStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

@Schema({
  timestamps: true,
  collection: 'giftcard_shop_products',
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
export class GiftCardShopProduct {
  @ApiProperty({ description: 'Brand name', example: 'Amazon' })
  @Prop({ required: true, trim: true })
  brandName: string;

  @ApiProperty({ description: 'URL-friendly slug', example: 'amazon-us-50' })
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @ApiProperty({ description: 'Card type', example: 'E-Code' })
  @Prop({ type: String, default: null })
  cardType: string | null;

  @ApiProperty({ description: 'Country code', example: 'US' })
  @Prop({ type: String, default: null })
  countryCode: string | null;

  @ApiProperty({ description: 'Country/region name', example: 'United States' })
  @Prop({ type: String, default: null })
  region: string | null;

  @ApiProperty({ description: 'Face value of the card', example: 50 })
  @Prop({ required: true, min: 0 })
  denominationValue: number;

  @ApiProperty({ description: 'Currency of the face value', example: 'USD' })
  @Prop({ required: true, default: 'USD' })
  denominationCurrency: string;

  @ApiProperty({ description: 'Selling price in kobo' })
  @Prop({ required: true, min: 0 })
  priceNgn: number;

  @ApiProperty({ description: 'Admin cost price in kobo (for profit tracking)' })
  @Prop({ type: Number, default: null })
  costPriceNgn: number | null;

  @ApiProperty({ description: 'Product images' })
  @Prop({ type: [String], default: [] })
  images: string[];

  @ApiProperty({ description: 'Product description' })
  @Prop({ type: String, default: null })
  description: string | null;

  @ApiProperty({ description: 'How to redeem the card' })
  @Prop({ type: String, default: null })
  redeemInstructions: string | null;

  @ApiProperty({ description: 'Product status', enum: ShopProductStatus })
  @Prop({
    type: String,
    enum: ShopProductStatus,
    default: ShopProductStatus.ACTIVE,
  })
  status: ShopProductStatus;

  @ApiProperty({ description: 'Total codes ever added' })
  @Prop({ type: Number, default: 0 })
  totalCodes: number;

  @ApiProperty({ description: 'Currently available codes' })
  @Prop({ type: Number, default: 0 })
  availableCodes: number;

  @ApiProperty({ description: 'Total codes sold' })
  @Prop({ type: Number, default: 0 })
  soldCount: number;

  @ApiProperty({ description: 'Display sort order' })
  @Prop({ type: Number, default: 0 })
  sortOrder: number;

  @ApiProperty({ description: 'Whether product is featured' })
  @Prop({ type: Boolean, default: false })
  isFeatured: boolean;

  @ApiProperty({ description: 'Extra metadata' })
  @Prop({ type: Object, default: {} })
  meta: Record<string, any>;

  createdAt: Date;
  updatedAt: Date;
}

export const GiftCardShopProductSchema =
  SchemaFactory.createForClass(GiftCardShopProduct);

// Indexes
GiftCardShopProductSchema.index({ status: 1, brandName: 1 });
GiftCardShopProductSchema.index({ countryCode: 1 });
GiftCardShopProductSchema.index({ isFeatured: 1, sortOrder: 1 });
GiftCardShopProductSchema.index({ brandName: 'text', description: 'text' });
