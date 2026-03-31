/**
 * Gift Card Rate Schema
 * Represents exchange rates for different card value ranges
 * Rate is expressed as NGN per USD (e.g., rate: 400 means 1 USD = 400 NGN)
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type GiftCardRateDocument = GiftCardRate & Document;

export enum RateStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
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
export class GiftCardRate {
  @ApiProperty({ description: 'Reference to category' })
  @Prop({ type: Types.ObjectId, ref: 'GiftCardCategory', required: true })
  categoryId: Types.ObjectId;

  @ApiProperty({ description: 'Minimum card value in USD for this rate', example: 25 })
  @Prop({ type: Number, required: true, min: 0 })
  minValue: number;

  @ApiProperty({ description: 'Maximum card value in USD for this rate', example: 100 })
  @Prop({ type: Number, required: true, min: 0 })
  maxValue: number;

  @ApiProperty({ description: 'Exchange rate (NGN per 1 USD)', example: 450 })
  @Prop({ type: Number, required: true, min: 0 })
  rate: number;

  @ApiProperty({ description: 'Rate status', enum: RateStatus })
  @Prop({ type: String, enum: RateStatus, default: RateStatus.ACTIVE })
  status: RateStatus;

  @ApiProperty({ description: 'Admin notes about this rate', required: false })
  @Prop({ type: String, default: null })
  notes: string | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

export const GiftCardRateSchema = SchemaFactory.createForClass(GiftCardRate);

// Indexes for efficient queries
GiftCardRateSchema.index({ categoryId: 1, status: 1 });
GiftCardRateSchema.index({ categoryId: 1, minValue: 1, maxValue: 1 });
GiftCardRateSchema.index({ status: 1 });

// Ensure no overlapping ranges within same category
// This validation should be done at application level