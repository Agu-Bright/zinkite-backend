/**
 * Gift Card Shop DTOs
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsArray,
  IsMongoId,
  ValidateNested,
  Min,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ShopProductStatus } from '../schemas/giftcard-shop-product.schema';

// ─── Product DTOs ──────────────────────────────────────────

export class CreateShopProductDto {
  @ApiProperty({ description: 'Brand name', example: 'Amazon' })
  @IsString()
  @MaxLength(100)
  brandName: string;

  @ApiPropertyOptional({ description: 'Card type', example: 'E-Code' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  cardType?: string;

  @ApiPropertyOptional({ description: 'Country code', example: 'US' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Region name', example: 'United States' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiProperty({ description: 'Face value of the card', example: 50 })
  @IsNumber()
  @IsPositive()
  denominationValue: number;

  @ApiPropertyOptional({ description: 'Currency of face value', example: 'USD', default: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  denominationCurrency?: string;

  @ApiProperty({ description: 'Selling price in Naira (will be converted to kobo)', example: 45000 })
  @IsNumber()
  @IsPositive()
  priceNgn: number;

  @ApiPropertyOptional({ description: 'Admin cost price in Naira', example: 40000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPriceNgn?: number;

  @ApiPropertyOptional({ description: 'Product description' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Redeem instructions' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  redeemInstructions?: string;

  @ApiPropertyOptional({ description: 'Whether product is featured', default: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ description: 'Product image URLs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ description: 'Display sort order', default: 0 })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class UpdateShopProductDto {
  @ApiPropertyOptional({ description: 'Brand name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brandName?: string;

  @ApiPropertyOptional({ description: 'Card type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  cardType?: string;

  @ApiPropertyOptional({ description: 'Country code' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Region name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({ description: 'Face value' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  denominationValue?: number;

  @ApiPropertyOptional({ description: 'Currency of face value' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  denominationCurrency?: string;

  @ApiPropertyOptional({ description: 'Selling price in Naira' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  priceNgn?: number;

  @ApiPropertyOptional({ description: 'Cost price in Naira' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPriceNgn?: number;

  @ApiPropertyOptional({ description: 'Product description' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Redeem instructions' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  redeemInstructions?: string;

  @ApiPropertyOptional({ description: 'Product status', enum: ShopProductStatus })
  @IsOptional()
  @IsEnum(ShopProductStatus)
  status?: ShopProductStatus;

  @ApiPropertyOptional({ description: 'Whether product is featured' })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ description: 'Product image URLs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ description: 'Display sort order' })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class ShopProductQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by brand name' })
  @IsOptional()
  @IsString()
  brandName?: string;

  @ApiPropertyOptional({ description: 'Filter by country code' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Filter by status', enum: ShopProductStatus })
  @IsOptional()
  @IsEnum(ShopProductStatus)
  status?: ShopProductStatus;

  @ApiPropertyOptional({ description: 'Search by brand or description' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter featured only' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isFeatured?: boolean;
}

// ─── Code DTOs ─────────────────────────────────────────────

export class CodeEntryDto {
  @ApiProperty({ description: 'Gift card code' })
  @IsString()
  @MaxLength(500)
  code: string;

  @ApiPropertyOptional({ description: 'Card PIN' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  pin?: string;

  @ApiPropertyOptional({ description: 'Serial number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;
}

export class AddCodesDto {
  @ApiProperty({ description: 'Array of card codes to add', type: [CodeEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CodeEntryDto)
  codes: CodeEntryDto[];
}

// ─── Purchase DTOs ─────────────────────────────────────────

export class PurchaseShopCardDto {
  @ApiProperty({ description: 'Product ID to purchase' })
  @IsMongoId()
  productId: string;
}

export class ShopPurchaseQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter by product ID' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ description: 'Search by reference or brand' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class UserShopPurchaseQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class RefundShopPurchaseDto {
  @ApiPropertyOptional({ description: 'Reason for refund' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
