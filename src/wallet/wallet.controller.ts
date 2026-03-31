/**
 * Wallet Controller
 * 
 * Handles wallet-related HTTP endpoints:
 * - Balance queries
 * - Transaction history
 * - Paystack top-up
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PinGuard } from '../common/guards/pin.guard';
import { CurrentUser, RequirePin } from '../common/decorators';
import {
  InitializeTopupDto,
  VerifyTopupDto,
  TransactionsQueryDto,
  WalletBalanceResponse,
  InitializeTopupResponse,
} from './dto';

@ApiTags('Wallet')
@ApiBearerAuth('JWT-auth')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * Get wallet balance
   */
  @Get('balance')
  @ApiOperation({ summary: 'Get wallet balance' })
  @ApiResponse({
    status: 200,
    description: 'Balance retrieved successfully',
    type: WalletBalanceResponse,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async getBalance(
    @CurrentUser('sub') userId: string,
  ): Promise<WalletBalanceResponse> {
    return this.walletService.getBalance(userId);
  }

  /**
   * Get transaction history
   */
  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction history with pagination' })
  @ApiResponse({
    status: 200,
    description: 'Transactions retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTransactions(
    @CurrentUser('sub') userId: string,
    @Query() query: TransactionsQueryDto,
  ) {
    return this.walletService.getTransactions(userId, query);
  }

  /**
   * Initialize Paystack top-up
   * Requires transaction PIN
   */
  @Post('topup/paystack/initialize')
  @UseGuards(PinGuard)
  @RequirePin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initialize Paystack wallet top-up (PIN required)' })
  @ApiSecurity('PIN-auth')
  @ApiResponse({
    status: 200,
    description: 'Top-up initialized successfully',
    type: InitializeTopupResponse,
  })
  @ApiResponse({ status: 400, description: 'Invalid amount' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Invalid PIN' })
  async initializeTopup(
    @CurrentUser('sub') userId: string,
    @CurrentUser('email') email: string,
    @Body() dto: InitializeTopupDto,
  ): Promise<InitializeTopupResponse> {
    return this.walletService.initializeTopup(userId, email, dto);
  }

  /**
   * Verify Paystack top-up
   */
  @Get('topup/paystack/verify')
  @ApiOperation({ summary: 'Verify Paystack payment and credit wallet' })
  @ApiResponse({
    status: 200,
    description: 'Payment verification result',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async verifyTopup(
    @CurrentUser('sub') userId: string,
    @Query() dto: VerifyTopupDto,
  ) {
    return this.walletService.verifyTopup(dto.reference, userId);
  }

  // ============================================
  // DEDICATED VIRTUAL ACCOUNT (DVA)
  // ============================================

  /**
   * Get user's dedicated virtual account.
   * Creates one automatically if it doesn't exist.
   */
  @Get('virtual-account')
  @ApiOperation({ summary: 'Get dedicated virtual account for wallet funding' })
  @ApiResponse({
    status: 200,
    description: 'Virtual account details',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getVirtualAccount(@CurrentUser('sub') userId: string) {
    const va = await this.walletService.getOrCreateVirtualAccount(userId);
    return {
      accountName: va.accountName,
      accountNumber: va.accountNumber,
      bankName: va.bankName,
      bankSlug: va.bankSlug,
    };
  }
}
