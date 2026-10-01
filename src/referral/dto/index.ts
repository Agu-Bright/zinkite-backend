/**
 * Referral DTOs (points-based system)
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';

// ── User: Query My Referrals ────────────────────────────────

export class MyReferralsQueryDto extends PaginationDto {}

// ── User: Update referral code ──────────────────────────────

export class UpdateMyReferralCodeDto {
  @ApiProperty({
    description: 'Unique custom referral code (4-20 letters, numbers, hyphens, or underscores)',
    example: 'JOHN-DEALS',
  })
  @Transform(({ value }) => String(value ?? '').trim().toUpperCase())
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/, {
    message:
      'Referral code must start with a letter or number and contain only letters, numbers, hyphens, or underscores',
  })
  referralCode: string;
}

// ── User: Convert points → wallet ───────────────────────────

export class ConvertPointsDto {
  @ApiProperty({ description: 'Number of points to convert into wallet Naira', example: 100 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  points: number;
}

// ── Admin: Update referral settings ─────────────────────────

export class UpdateReferralSettingsDto {
  @ApiProperty({ description: 'Points the REFERRER earns per referral', example: 10 })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  pointsPerReferral: number;

  @ApiProperty({ description: 'Points the REFEREE (new user) earns for signing up with a code', example: 5 })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  refereePoints: number;

  @ApiProperty({ description: 'Value of 1 referral point in Naira', example: 50 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  pointValue: number;

  @ApiPropertyOptional({ description: 'Minimum points required before a user can convert', example: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minConversionPoints?: number;

  @ApiProperty({
    description:
      'Total transactions (₦) the referee must make to UNLOCK both bonuses. 0 = unlocks on first transaction.',
    example: 5000,
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unlockThreshold: number;
}

// ── Admin: Query referral earnings ──────────────────────────

export class AdminReferralEarningsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Search referrers by name, email, phone, or referral code',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
