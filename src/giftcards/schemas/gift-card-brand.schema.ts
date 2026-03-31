/**
 * Gift Card Brand Schema
 * Represents a gift card brand (e.g., Amazon, iTunes, Google Play)
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type GiftCardBrandDocument = GiftCardBrand & Document;

export enum BrandStatus {
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
export class GiftCardBrand {
  @ApiProperty({ description: 'Brand name', example: 'Amazon' })
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @ApiProperty({ description: 'Brand slug for URL', example: 'amazon' })
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @ApiProperty({ description: 'Brand logo URL', required: false })
  @Prop({ type: String, default: null })
  logoUrl: string | null;

  @ApiProperty({ description: 'Brand description', required: false })
  @Prop({ type: String, default: null })
  description: string | null;

  @ApiProperty({ description: 'Brand status', enum: BrandStatus })
  @Prop({ type: String, enum: BrandStatus, default: BrandStatus.ACTIVE })
  status: BrandStatus;

  @ApiProperty({ description: 'Display order for sorting' })
  @Prop({ type: Number, default: 0 })
  sortOrder: number;

  @ApiProperty({ description: 'Whether brand is featured' })
  @Prop({ type: Boolean, default: false })
  isFeatured: boolean;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

export const GiftCardBrandSchema = SchemaFactory.createForClass(GiftCardBrand);

// Indexes for efficient queries
GiftCardBrandSchema.index({ status: 1 });
GiftCardBrandSchema.index({ sortOrder: 1 });
GiftCardBrandSchema.index({ isFeatured: 1 });
GiftCardBrandSchema.index({ name: 'text', description: 'text' });