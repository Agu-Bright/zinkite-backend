/**
 * Gift Card Buy DTOs
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsPositive,
  IsEnum,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { MarkupLevel } from '../schemas/giftcard-buy-markup.schema';

// ─── User DTOs ──────────────────────────────────────────────

export class PurchaseGiftCardDto {
  @ApiProperty({ description: 'Reloadly product DB ID' })
  @IsString()
  productId: string;

  @ApiProperty({ description: 'Face value in recipient currency (e.g. 5 for $5)', example: 5 })
  @IsNumber()
  @IsPositive()
  unitPrice: number;

  @ApiPropertyOptional({ description: 'Quantity (default 1)', default: 1, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  quantity?: number = 1;
}

export class PricePreviewQueryDto {
  @ApiProperty({ description: 'Reloadly product DB ID' })
  @IsString()
  productId: string;

  @ApiProperty({ description: 'Unit price in recipient currency', example: 5 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  unitPrice: number;
}

export class ProductsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by country code (e.g. US, NG)' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Filter by brand name' })
  @IsOptional()
  @IsString()
  brandName?: string;

  @ApiPropertyOptional({ description: 'Search by product or brand name' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class UserOrdersQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;
}

// ─── Admin DTOs ─────────────────────────────────────────────

export class AdminProductsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by country code' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Filter by brand name' })
  @IsOptional()
  @IsString()
  brandName?: string;

  @ApiPropertyOptional({ description: 'Filter by enabled status' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Search by product or brand name' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ToggleProductDto {
  @ApiProperty({ description: 'Enable or disable the product' })
  @IsBoolean()
  isEnabled: boolean;
}

export class UpsertMarkupDto {
  @ApiProperty({ description: 'Markup level', enum: MarkupLevel })
  @IsEnum(MarkupLevel)
  level: MarkupLevel;

  @ApiPropertyOptional({ description: 'Country code (required for COUNTRY level)' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Brand name (required for BRAND level)' })
  @IsOptional()
  @IsString()
  brandName?: string;

  @ApiProperty({ description: 'Markup percentage (e.g. 5.0 = 5%)', example: 5.0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  markupPercentage: number;
}

export class AdminOrdersQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by country code' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Filter by brand name' })
  @IsOptional()
  @IsString()
  brandName?: string;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Search by reference or product name' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class RefundOrderDto {
  @ApiPropertyOptional({ description: 'Reason for refund' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateExchangeRateDto {
  @ApiProperty({ description: 'USD to NGN exchange rate', example: 1600 })
  @IsNumber()
  @IsPositive()
  rate: number;
}
