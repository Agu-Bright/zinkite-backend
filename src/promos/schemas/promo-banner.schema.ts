/**
 * Promo Banner Schema
 * Represents a promotional banner displayed in the mobile app.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type PromoBannerDocument = PromoBanner & Document;

export enum BannerStatus {
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
export class PromoBanner {
  @ApiProperty({ description: 'Internal admin label', example: 'Black Friday Sale' })
  @Prop({ type: String, default: null, trim: true })
  label: string | null;

  @ApiProperty({ description: 'Banner title (legacy)', example: 'Black Friday deal' })
  @Prop({ type: String, default: null, trim: true })
  title: string | null;

  @ApiProperty({ description: 'Short tag text', example: '30% OFF' })
  @Prop({ type: String, default: null })
  subtitle: string | null;

  @ApiProperty({ description: 'Banner description text' })
  @Prop({ type: String, default: null })
  description: string | null;

  @ApiProperty({ description: 'Banner image URL (uploaded via R2)' })
  @Prop({ type: String, default: null })
  imageUrl: string | null;

  @ApiProperty({ description: 'Background hex color', example: '#0F1724' })
  @Prop({ type: String, default: '#0F1724' })
  backgroundColor: string;

  @ApiProperty({ description: 'Gradient color array', example: ['#1a2a4a', '#2563EB'] })
  @Prop({ type: [String], default: [] })
  gradientColors: string[];

  @ApiProperty({ description: 'Call-to-action button text', example: 'Learn More' })
  @Prop({ type: String, default: 'Learn More' })
  ctaText: string;

  @ApiProperty({ description: 'CTA link (deep link or URL)' })
  @Prop({ type: String, default: null })
  ctaUrl: string | null;

  @ApiProperty({ description: 'Banner status', enum: BannerStatus })
  @Prop({ type: String, enum: BannerStatus, default: BannerStatus.INACTIVE })
  status: BannerStatus;

  @ApiProperty({ description: 'Display sort order' })
  @Prop({ type: Number, default: 0 })
  displayOrder: number;

  @ApiProperty({ description: 'Scheduled start date' })
  @Prop({ type: Date, default: null })
  startsAt: Date | null;

  @ApiProperty({ description: 'Scheduled end date' })
  @Prop({ type: Date, default: null })
  endsAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const PromoBannerSchema = SchemaFactory.createForClass(PromoBanner);

PromoBannerSchema.index({ status: 1, displayOrder: 1 });
PromoBannerSchema.index({ startsAt: 1, endsAt: 1 });
