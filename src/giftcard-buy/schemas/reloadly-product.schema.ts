/**
 * Reloadly Product Schema
 *
 * Synced catalog of gift card products from Reloadly API.
 * Products are synced periodically and can be enabled/disabled by admin.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ReloadlyProductDocument = ReloadlyProduct & Document;

export enum DenominationType {
  FIXED = 'FIXED',
  RANGE = 'RANGE',
}

@Schema({ timestamps: true, collection: 'reloadly_products' })
export class ReloadlyProduct {
  @Prop({ required: true, unique: true, index: true })
  reloadlyProductId: number;

  @Prop({ required: true })
  productName: string;

  @Prop({ required: true, index: true })
  brandId: number;

  @Prop({ required: true, index: true })
  brandName: string;

  @Prop({ required: true, index: true })
  countryCode: string;

  @Prop({ required: true })
  countryName: string;

  @Prop()
  countryFlagUrl: string;

  @Prop({ required: true, enum: DenominationType })
  denominationType: DenominationType;

  @Prop({ required: true })
  recipientCurrencyCode: string;

  @Prop({ required: true })
  senderCurrencyCode: string;

  @Prop({ default: 0 })
  senderFee: number;

  @Prop({ default: 0 })
  discountPercentage: number;

  @Prop({ type: Number, default: null })
  minRecipientDenomination: number | null;

  @Prop({ type: Number, default: null })
  maxRecipientDenomination: number | null;

  @Prop({ type: [Number], default: [] })
  fixedRecipientDenominations: number[];

  @Prop({ type: [Number], default: [] })
  fixedSenderDenominations: number[];

  @Prop({ type: Object, default: {} })
  fixedRecipientToSenderDenominationsMap: Record<string, number>;

  @Prop({ type: [String], default: [] })
  logoUrls: string[];

  @Prop({ default: '' })
  redeemInstructionConcise: string;

  @Prop({ default: '' })
  redeemInstructionVerbose: string;

  @Prop({ default: true, index: true })
  isEnabled: boolean;

  @Prop()
  lastSyncedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const ReloadlyProductSchema =
  SchemaFactory.createForClass(ReloadlyProduct);

// Compound indexes
ReloadlyProductSchema.index({ countryCode: 1, isEnabled: 1 });
ReloadlyProductSchema.index({ brandName: 1, countryCode: 1 });
ReloadlyProductSchema.index({ productName: 'text', brandName: 'text' });
