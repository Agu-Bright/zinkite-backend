/**
 * Gift Card Buy Config Schema
 *
 * Key-value configuration store for gift card buying settings.
 * Used for exchange rates and other configurable values.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type GiftCardBuyConfigDocument = GiftCardBuyConfig & Document;

@Schema({ timestamps: true, collection: 'giftcard_buy_config' })
export class GiftCardBuyConfig {
  @Prop({ required: true, unique: true, index: true })
  key: string;

  @Prop({ required: true, type: Number })
  value: number;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser' })
  updatedBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const GiftCardBuyConfigSchema =
  SchemaFactory.createForClass(GiftCardBuyConfig);
