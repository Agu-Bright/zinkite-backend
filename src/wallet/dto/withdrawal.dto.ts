/**
 * Bank Account & Withdrawal DTOs
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  Max,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

// ─────────────────────────────────────
// Bank Account
// ─────────────────────────────────────

export class VerifyBankAccountDto {
  @ApiProperty({ description: 'CBN bank code', example: '044' })
  @IsString()
  @IsNotEmpty()
  bankCode: string;

  @ApiProperty({ description: '10-digit account number', example: '0123456789' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(10)
  @Matches(/^\d{10}$/, { message: 'Account number must be exactly 10 digits' })
  accountNumber: string;
}

export class SaveBankAccountDto {
  @ApiProperty({ example: 'Access Bank' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  bankName: string;

  @ApiProperty({ example: '044' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  bankCode: string;

  @ApiProperty({ example: '0123456789' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(10)
  @Matches(/^\d{10}$/, { message: 'Account number must be exactly 10 digits' })
  accountNumber: string;

  @ApiProperty({ description: 'Verified account holder name', example: 'JOHN DOE' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  accountName: string;
}

// ─────────────────────────────────────
// Withdrawal
// ─────────────────────────────────────

export class InitiateWithdrawalDto {
  @ApiProperty({
    description: 'Amount in naira (not kobo). Min ₦5,000, Max ₦1,000,000',
    example: 5000,
  })
  @IsNumber()
  @Min(5000, { message: 'Minimum withdrawal is ₦5,000' })
  @Max(1000000, { message: 'Maximum withdrawal is ₦1,000,000' })
  amount: number;
}

export class WithdrawalsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    enum: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED'],
  })
  @IsOptional()
  @IsString()
  status?: string;
}

// ─────────────────────────────────────
// Admin
// ─────────────────────────────────────

export class AdminWithdrawalsQueryDto extends WithdrawalsQueryDto {
  @ApiPropertyOptional({ description: 'Search by reference / account name / user email' })
  @IsOptional()
  @IsString()
  search?: string;
}