/**
 * Referral DTOs
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsMongoId,
  IsDateString,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ChallengeStatus } from '../schemas/referral-challenge.schema';

// ── Admin: Create Challenge ─────────────────────────────────

export class CreateChallengeDto {
  @ApiProperty({ example: 'Refer & Win ₦25,000' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ description: 'Reward per winner in Naira', example: 25000 })
  @IsNumber()
  @Min(100)
  @Type(() => Number)
  rewardAmount: number;

  @ApiProperty({ example: 3 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  numberOfWinners: number;

  @ApiProperty({ description: 'Referrals needed to qualify', example: 50 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  referralTarget: number;

  @ApiProperty({ description: 'Min transaction amount in Naira', example: 500 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  minTransactionAmount: number;

  @ApiProperty()
  @IsDateString()
  startsAt: string;

  @ApiProperty()
  @IsDateString()
  endsAt: string;
}

// ── Admin: Update Challenge ─────────────────────────────────

export class UpdateChallengeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Reward per winner in Naira' })
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Type(() => Number)
  rewardAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  numberOfWinners?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  referralTarget?: number;

  @ApiPropertyOptional({ description: 'Min transaction amount in Naira' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  minTransactionAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

// ── Admin: Query Challenges ─────────────────────────────────

export class ChallengesQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ChallengeStatus })
  @IsOptional()
  @IsEnum(ChallengeStatus)
  status?: ChallengeStatus;
}

// ── User: Query My Referrals ────────────────────────────────

export class MyReferralsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by challenge ID' })
  @IsOptional()
  @IsMongoId()
  challengeId?: string;
}
