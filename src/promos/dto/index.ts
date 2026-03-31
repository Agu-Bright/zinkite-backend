/**
 * Promo Banner DTOs
 */
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  IsISO8601,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { BannerStatus } from '../schemas/promo-banner.schema';

export class CreatePromoBannerDto {
  @ApiPropertyOptional({ description: 'Internal admin label', example: 'Black Friday Sale' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ description: 'Banner title (legacy)', example: 'Black Friday deal' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Short tag text', example: '30% OFF' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subtitle?: string;

  @ApiPropertyOptional({ description: 'Description text' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Banner image URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Background hex color', example: '#0F1724' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  backgroundColor?: string;

  @ApiPropertyOptional({ description: 'Gradient colors', example: ['#1a2a4a', '#2563EB'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  gradientColors?: string[];

  @ApiPropertyOptional({ description: 'CTA button text', example: 'Learn More' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  ctaText?: string;

  @ApiPropertyOptional({ description: 'CTA link URL' })
  @IsOptional()
  @IsString()
  ctaUrl?: string;

  @ApiPropertyOptional({ description: 'Status', enum: BannerStatus })
  @IsOptional()
  @IsEnum(BannerStatus)
  status?: BannerStatus;

  @ApiPropertyOptional({ description: 'Display order', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({ description: 'Scheduled start (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'Scheduled end (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}

export class UpdatePromoBannerDto extends PartialType(CreatePromoBannerDto) {}

export class PromoBannerQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status', enum: BannerStatus })
  @IsOptional()
  @IsEnum(BannerStatus)
  status?: BannerStatus;

  @ApiPropertyOptional({ description: 'Search by label or title' })
  @IsOptional()
  @IsString()
  search?: string;
}
