/**
 * Gift Cards DTOs
 * Data Transfer Objects for gift card operations
 */
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
  IsUrl,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsMongoId,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { BrandStatus } from '../schemas/gift-card-brand.schema';
import { CategoryStatus, CardType, CategoryCurrency } from '../schemas/gift-card-category.schema';
import { RateStatus } from '../schemas/gift-card-rate.schema';
import { TradeStatus } from '../schemas/gift-card-trade.schema';
import { PaginationDto } from '../../common/dto/pagination.dto';

// ============================================
// BRAND DTOs
// ============================================

export class CreateBrandDto {
  @ApiProperty({ description: 'Brand name', example: 'Amazon' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Brand slug', example: 'amazon' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Transform(({ value }) => value?.toLowerCase()?.trim())
  slug: string;

  @ApiPropertyOptional({ description: 'Logo URL' })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'Brand description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Display order', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Is featured brand', default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isFeatured?: boolean;
}

export class UpdateBrandDto extends PartialType(CreateBrandDto) {
  @ApiPropertyOptional({ description: 'Brand status', enum: BrandStatus })
  @IsOptional()
  @IsEnum(BrandStatus)
  status?: BrandStatus;
}

export class BrandQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status', enum: BrandStatus })
  @IsOptional()
  @IsEnum(BrandStatus)
  status?: BrandStatus;

  @ApiPropertyOptional({ description: 'Filter featured only' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  featured?: boolean;

  @ApiPropertyOptional({ description: 'Search by name' })
  @IsOptional()
  @IsString()
  search?: string;
}

// ============================================
// CATEGORY DTOs
// ============================================

export class CreateCategoryDto {
  @ApiProperty({ description: 'Brand ID' })
  @IsMongoId()
  brandId: string;

  @ApiProperty({ description: 'Category name', example: 'USA Physical Card' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Category slug', example: 'usa-physical' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Transform(({ value }) => value?.toLowerCase()?.trim())
  slug: string;

  @ApiProperty({ description: 'Card type', enum: CardType })
  @IsEnum(CardType)
  cardType: CardType;

  @ApiPropertyOptional({ description: 'Currency for card value', enum: CategoryCurrency, default: CategoryCurrency.USD })
  @IsOptional()
  @IsEnum(CategoryCurrency)
  currency?: CategoryCurrency;

  @ApiPropertyOptional({ description: 'Country/Region', example: 'USA' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ description: 'Country flag image URL' })
  @IsOptional()
  @IsString()
  flagUrl?: string;

  @ApiPropertyOptional({ description: 'Category description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'Minimum card value in USD', example: 10 })
  @IsNumber()
  @Min(1)
  minValue: number;

  @ApiProperty({ description: 'Maximum card value in USD', example: 500 })
  @IsNumber()
  @Min(1)
  maxValue: number;

  @ApiPropertyOptional({ description: 'Display order', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {
  @ApiPropertyOptional({ description: 'Category status', enum: CategoryStatus })
  @IsOptional()
  @IsEnum(CategoryStatus)
  status?: CategoryStatus;
}

export class CategoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by brand ID' })
  @IsOptional()
  @IsMongoId()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Filter by status', enum: CategoryStatus })
  @IsOptional()
  @IsEnum(CategoryStatus)
  status?: CategoryStatus;

  @ApiPropertyOptional({ description: 'Filter by card type', enum: CardType })
  @IsOptional()
  @IsEnum(CardType)
  cardType?: CardType;
}

// ============================================
// RATE DTOs
// ============================================

export class CreateRateDto {
  @ApiProperty({ description: 'Category ID' })
  @IsMongoId()
  categoryId: string;

  @ApiProperty({ description: 'Minimum value in USD for this rate', example: 25 })
  @IsNumber()
  @Min(1)
  minValue: number;

  @ApiProperty({ description: 'Maximum value in USD for this rate', example: 100 })
  @IsNumber()
  @Min(1)
  maxValue: number;

  @ApiProperty({ description: 'Exchange rate (NGN per 1 USD)', example: 450 })
  @IsNumber()
  @Min(1)
  rate: number;

  @ApiPropertyOptional({ description: 'Admin notes' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateRateDto extends PartialType(CreateRateDto) {
  @ApiPropertyOptional({ description: 'Rate status', enum: RateStatus })
  @IsOptional()
  @IsEnum(RateStatus)
  status?: RateStatus;
}

export class RateQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by category ID' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Filter by status', enum: RateStatus })
  @IsOptional()
  @IsEnum(RateStatus)
  status?: RateStatus;
}

export class GetRateDto {
  @ApiProperty({ description: 'Category ID' })
  @IsMongoId()
  categoryId: string;

  @ApiProperty({ description: 'Card value in USD', example: 50 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  cardValue: number;
}

// ============================================
// TRADE DTOs
// ============================================

export class SubmitTradeDto {
  @ApiProperty({ description: 'Category ID' })
  @IsMongoId()
  categoryId: string;

  @ApiProperty({ description: 'Card value in USD', example: 50 })
  @IsNumber()
  @Min(1)
  @Max(10000)
  @Type(() => Number)
  cardValueUsd: number;

  @ApiPropertyOptional({ description: 'Card code/serial' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cardCode?: string;

  @ApiPropertyOptional({ description: 'Card PIN' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cardPin?: string;

  @ApiProperty({ description: 'Proof image URLs', type: [String] })
  @IsArray()
  @IsUrl({}, { each: true })
  proofImages: string[];

  @ApiPropertyOptional({ description: 'User notes/comments' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  userNotes?: string;
}

export class ReviewTradeDto {
  @ApiProperty({ description: 'Trade status', enum: [TradeStatus.PROCESSING, TradeStatus.APPROVED, TradeStatus.REJECTED] })
  @IsEnum([TradeStatus.PROCESSING, TradeStatus.APPROVED, TradeStatus.REJECTED])
  status: TradeStatus.PROCESSING | TradeStatus.APPROVED | TradeStatus.REJECTED;

  @ApiPropertyOptional({ description: 'Admin notes' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNotes?: string;

  @ApiPropertyOptional({ description: 'Rejection reason (required if rejected)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;

  @ApiPropertyOptional({ description: 'Adjusted amount in NGN (kobo) - optional override' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  adjustedAmountNgn?: number;
}

export class TradeQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status', enum: TradeStatus })
  @IsOptional()
  @IsEnum(TradeStatus)
  status?: TradeStatus;

  @ApiPropertyOptional({ description: 'Filter by brand ID' })
  @IsOptional()
  @IsMongoId()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Filter by category ID' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Filter by user ID (admin only)' })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ description: 'Search by reference' })
  @IsOptional()
  @IsString()
  search?: string;
}

// ============================================
// RESPONSE DTOs
// ============================================

export class BrandResponse {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ nullable: true })
  logoUrl: string | null;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ enum: BrandStatus })
  status: BrandStatus;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty()
  isFeatured: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CategoryResponse {
  @ApiProperty()
  id: string;

  @ApiProperty()
  brandId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ enum: CardType })
  cardType: CardType;

  @ApiProperty({ nullable: true })
  country: string | null;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ enum: CategoryStatus })
  status: CategoryStatus;

  @ApiProperty()
  minValue: number;

  @ApiProperty()
  maxValue: number;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class RateResponse {
  @ApiProperty()
  id: string;

  @ApiProperty()
  categoryId: string;

  @ApiProperty()
  minValue: number;

  @ApiProperty()
  maxValue: number;

  @ApiProperty()
  rate: number;

  @ApiProperty({ enum: RateStatus })
  status: RateStatus;

  @ApiProperty({ nullable: true })
  notes: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CalculatedRateResponse {
  @ApiProperty({ description: 'Category ID' })
  categoryId: string;

  @ApiProperty({ description: 'Card value in USD' })
  cardValueUsd: number;

  @ApiProperty({ description: 'Rate applied (NGN per USD)' })
  rate: number;

  @ApiProperty({ description: 'Calculated amount in Naira' })
  amountNgn: number;

  @ApiProperty({ description: 'Rate ID used' })
  rateId: string;
}

export class TradeResponse {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  brandId: string;

  @ApiProperty()
  categoryId: string;

  @ApiProperty()
  rateId: string;

  @ApiProperty()
  reference: string;

  @ApiProperty()
  cardValueUsd: number;

  @ApiProperty()
  rateApplied: number;

  @ApiProperty()
  amountNgn: number;

  @ApiProperty({ type: [String] })
  proofImages: string[];

  @ApiProperty({ enum: TradeStatus })
  status: TradeStatus;

  @ApiProperty({ nullable: true })
  userNotes: string | null;

  @ApiProperty({ nullable: true })
  adminNotes: string | null;

  @ApiProperty({ nullable: true })
  rejectionReason: string | null;

  @ApiProperty({ nullable: true })
  reviewedBy: string | null;

  @ApiProperty({ nullable: true })
  reviewedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
