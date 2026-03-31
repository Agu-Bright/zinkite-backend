/**
 * Admin DTOs
 * Data Transfer Objects for admin operations
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsMongoId,
  Min,
  Max,
  MinLength,
  MaxLength,IsDateString
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';

// ============================================
// WALLET ADJUSTMENT DTOs
// ============================================

export enum AdjustmentType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

export class ManualWalletAdjustmentDto {
  @ApiProperty({ description: 'User ID' })
  @IsMongoId()
  userId: string;

  @ApiProperty({ description: 'Adjustment type', enum: AdjustmentType })
  @IsEnum(AdjustmentType)
  type: AdjustmentType;

  @ApiProperty({ description: 'Amount in Naira (will be converted to kobo)', example: 1000 })
  @IsNumber()
  @Min(1)
  @Max(10000000) // Max 10 million Naira
  @Type(() => Number)
  amount: number;

  @ApiProperty({ description: 'Reason for adjustment' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ description: 'Internal reference number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  internalReference?: string;
}

// ============================================
// USER ADMIN DTOs
// ============================================

export enum UserStatusFilter {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

export class UsersQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status', enum: UserStatusFilter })
  @IsOptional()
  @IsEnum(UserStatusFilter)
  status?: UserStatusFilter;

  @ApiPropertyOptional({ description: 'Filter by email verified status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isEmailVerified?: boolean;

  @ApiPropertyOptional({ description: 'Filter by PIN set status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  hasPinSet?: boolean;

  @ApiPropertyOptional({ description: 'Search by email, phone, or name' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ description: 'New status', enum: ['ACTIVE', 'SUSPENDED'] })
  @IsEnum(['ACTIVE', 'SUSPENDED'])
  status: 'ACTIVE' | 'SUSPENDED';

  @ApiProperty({ description: 'Reason for status change' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

// ============================================
// DASHBOARD DTOs
// ============================================

export class DashboardStatsResponse {
  @ApiProperty({ description: 'Total users count' })
  totalUsers: number;

  @ApiProperty({ description: 'Active users count' })
  activeUsers: number;

  @ApiProperty({ description: 'New users today' })
  newUsersToday: number;

  @ApiProperty({ description: 'Total wallet balance across all users (Naira)' })
  totalWalletBalance: number;

  @ApiProperty({ description: 'Pending gift card trades count' })
  pendingTrades: number;

  @ApiProperty({ description: 'Total trades today' })
  tradesToday: number;

  @ApiProperty({ description: 'Revenue today (Naira)' })
  revenueToday: number;
}

export class DateRangeDto {
  @ApiPropertyOptional({ description: 'Start date' })
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  startDate?: Date;

  @ApiPropertyOptional({ description: 'End date' })
  @IsOptional()
  @Transform(({ value }) => new Date(value))
  endDate?: Date;
}

// ============================================
// PAYSTACK ADMIN DTOs
// ============================================

// ============================================
// WITHDRAWALS ADMIN DTOs
// ============================================

export class WithdrawalsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Search by reference, account name, or account number' })
  @IsOptional()
  @IsString()
  search?: string;
}

// ============================================
// CREDIT REQUEST DTOs
// ============================================

export class CreditRequestsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status', enum: ['PENDING', 'APPROVED', 'DENIED'] })
  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateCreditRequestDto {
  @ApiProperty({ description: 'Target user ID' })
  @IsMongoId()
  userId: string;

  @ApiProperty({ description: 'Amount in Naira (converted to kobo server-side)', example: 5000 })
  @IsNumber()
  @Min(1)
  @Max(10000000)
  @Type(() => Number)
  amount: number;

  @ApiProperty({ description: 'Reason for the credit', example: 'Compensation for failed transaction' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class DenyCreditRequestDto {
  @ApiProperty({ description: 'Reason for denial' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  deniedReason: string;
}

// ============================================
// NOTIFICATION DTOs
// ============================================

export enum NotificationType {
  EMAIL = 'email',
  PUSH = 'push',
}

export enum NotificationRecipients {
  ALL = 'all',
  ACTIVE = 'active',
  INDIVIDUAL = 'individual',
}

export class SendNotificationDto {
  @ApiProperty({ description: 'Notification type', enum: NotificationType })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ description: 'Recipient group', enum: NotificationRecipients })
  @IsEnum(NotificationRecipients)
  recipients: NotificationRecipients;

  @ApiProperty({ description: 'Subject / title' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  subject: string;

  @ApiProperty({ description: 'Notification body / message' })
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  body: string;

  @ApiPropertyOptional({ description: 'Target user ID (required when recipients=individual)' })
  @IsOptional()
  @IsMongoId()
  targetUserId?: string;
}

export class NotificationsQueryDto extends PaginationDto {}

// ============================================
// PAYSTACK ADMIN DTOs
// ============================================

export class PaystackQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ description: 'Search by reference' })
  @IsOptional()
  @IsString()
  search?: string;
   @ApiPropertyOptional({
    description: 'Filter transactions from this date',
    example: '2024-01-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter transactions until this date',
    example: '2024-12-31',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
