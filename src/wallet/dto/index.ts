/**
 * Wallet DTOs
 *
 * Data Transfer Objects for wallet operations.
 */
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNumber,
  IsPositive,
  Min,
  Max,
  IsOptional,
  IsString,
  IsDateString,
} from "class-validator";
import { Type } from "class-transformer";
import { PaginationDto } from "../../common/dto/pagination.dto";

// =====================
// Top-up
// =====================

export class InitializeTopupDto {
  @ApiProperty({
    example: 5000,
    description: "Amount to top up in Naira",
    minimum: 100,
    maximum: 1000000,
  })
  @IsNumber()
  @IsPositive()
  @Min(100, { message: "Minimum top-up amount is ₦100" })
  @Max(1000000, { message: "Maximum top-up amount is ₦1,000,000" })
  amount: number;

  @ApiPropertyOptional({
    example: "https://myapp.com/payment-callback",
    description: "URL to redirect after payment",
  })
  @IsOptional()
  @IsString()
  callbackUrl?: string;
}

export class VerifyTopupDto {
  @ApiProperty({
    example: "TXN_LX1Y2Z_A1B2C3D4",
    description: "Payment reference",
  })
  @IsString()
  reference: string;
}

// =====================
// Transactions Query
// =====================

export class TransactionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: "Filter by transaction type",
    enum: ["CREDIT", "DEBIT"],
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    description: "Filter by category",
    enum: ["GIFTCARD", "AIRTIME", "DATA", "TOPUP", "MANUAL", "REFUND"],
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: "Filter by status",
    enum: ["PENDING", "SUCCESS", "FAILED"],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: "Search by reference or narration",
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: "Filter transactions from this date",
    example: "2024-01-01",
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: "Filter transactions until this date",
    example: "2024-12-31",
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

// =====================
// Response Types
// =====================

export class WalletBalanceResponse {
  @ApiProperty({ example: "507f1f77bcf86cd799439011" })
  walletId: string;

  @ApiProperty({ example: 25000 })
  balance: number;

  @ApiProperty({ example: "NGN" })
  currency: string;

  @ApiProperty({ example: "ACTIVE" })
  status: string;

  @ApiProperty({ example: "250.00", description: "Formatted balance" })
  formattedBalance: string;
}

export class TransactionResponse {
  @ApiProperty()
  id: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  category: string;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  reference: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  narration: string;

  @ApiProperty()
  createdAt: Date;
}

export class InitializeTopupResponse {
  @ApiProperty({ example: "https://checkout.paystack.com/xyz123" })
  authorizationUrl: string;

  @ApiProperty({ example: "xyz123" })
  accessCode: string;

  @ApiProperty({ example: "TXN_LX1Y2Z_A1B2C3D4" })
  reference: string;
}
