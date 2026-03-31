/**
 * Gift Card Buy Markup Schema
 *
 * Admin-configured markup percentages for gift card buying.
 * Supports three levels: GLOBAL (fallback), COUNTRY, BRAND.
 * Cascade priority: BRAND > COUNTRY > GLOBAL.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GiftCardBuyMarkupDocument = GiftCardBuyMarkup & Document;

export enum MarkupLevel {
  GLOBAL = 'GLOBAL',
  COUNTRY = 'COUNTRY',
  BRAND = 'BRAND',
}

@Schema({ timestamps: true, collection: 'giftcard_buy_markups' })
export class GiftCardBuyMarkup {
  @Prop({ required: true, enum: MarkupLevel, index: true })
  level: MarkupLevel;

  @Prop({ type: String, default: null })
  countryCode: string | null;

  @Prop({ type: String, default: null })
  brandName: string | null;

  @Prop({ required: true })
  markupPercentage: number; // e.g. 5.0 = 5%

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser' })
  updatedBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const GiftCardBuyMarkupSchema =
  SchemaFactory.createForClass(GiftCardBuyMarkup);

// Unique compound index: one markup per level+scope
GiftCardBuyMarkupSchema.index(
  { level: 1, countryCode: 1, brandName: 1 },
  { unique: true },
);
