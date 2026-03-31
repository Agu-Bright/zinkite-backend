/**
 * Gift Card Category Schema
 * Represents categories within a brand (e.g., Physical, E-code, etc.)
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type GiftCardCategoryDocument = GiftCardCategory & Document;

export enum CategoryStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum CardType {
  PHYSICAL = 'PHYSICAL',
  ECODE = 'ECODE',
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
export class GiftCardCategory {
  @ApiProperty({ description: 'Reference to brand' })
  @Prop({ type: Types.ObjectId, ref: 'GiftCardBrand', required: true })
  brandId: Types.ObjectId;

  @ApiProperty({ description: 'Category name', example: 'USA Physical Card' })
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @ApiProperty({ description: 'Category slug', example: 'usa-physical' })
  @Prop({ type: String, required: true, lowercase: true, trim: true })
  slug: string;

  @ApiProperty({ description: 'Card type', enum: CardType })
  @Prop({ type: String, enum: CardType, required: true })
  cardType: CardType;

  @ApiProperty({ description: 'Country/Region', example: 'USA', required: false })
  @Prop({ type: String, default: null })
  country: string | null;

  @ApiProperty({ description: 'Category description', required: false })
  @Prop({ type: String, default: null })
  description: string | null;

  @ApiProperty({ description: 'Category status', enum: CategoryStatus })
  @Prop({ type: String, enum: CategoryStatus, default: CategoryStatus.ACTIVE })
  status: CategoryStatus;

  @ApiProperty({ description: 'Minimum card value in USD' })
  @Prop({ type: Number, required: true, min: 0 })
  minValue: number;

  @ApiProperty({ description: 'Maximum card value in USD' })
  @Prop({ type: Number, required: true, min: 0 })
  maxValue: number;

  @ApiProperty({ description: 'Display order for sorting' })
  @Prop({ type: Number, default: 0 })
  sortOrder: number;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

export const GiftCardCategorySchema = SchemaFactory.createForClass(GiftCardCategory);

// Indexes for efficient queries
GiftCardCategorySchema.index({ brandId: 1, status: 1 });
GiftCardCategorySchema.index({ brandId: 1, slug: 1 }, { unique: true });
GiftCardCategorySchema.index({ status: 1 });
GiftCardCategorySchema.index({ cardType: 1 });
GiftCardCategorySchema.index({ sortOrder: 1 });