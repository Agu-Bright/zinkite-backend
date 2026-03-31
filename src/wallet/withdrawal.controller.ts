/**
 * Withdrawal Controller (User-facing)
 *
 * Endpoints:
 *   GET    /wallet/banks               — List Nigerian banks (Paystack)
 *   POST   /wallet/bank-account/verify — Verify account name (Paystack)
 *   GET    /wallet/bank-account        — Get saved bank account
 *   POST   /wallet/bank-account        — Save / update bank account + create Paystack recipient
 *   DELETE /wallet/bank-account        — Delete bank account
 *   POST   /wallet/withdraw            — Initiate automatic withdrawal (PIN REQUIRED)
 *   GET    /wallet/withdrawals         — Withdrawal history
 *   GET    /wallet/withdrawals/:ref    — Single withdrawal by reference
 */
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PinGuard } from '../common/guards/pin.guard';
import { WithdrawalService } from './withdrawal.service';
import {
  SaveBankAccountDto,
  VerifyBankAccountDto,
  InitiateWithdrawalDto,
  WithdrawalsQueryDto,
} from './dto/withdrawal.dto';

@ApiTags('Wallet — Bank Account & Withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WithdrawalController {
  constructor(private readonly svc: WithdrawalService) {}

  // ── Banks list ──

  @Get('banks')
  @ApiOperation({ summary: 'List Nigerian banks (Paystack)' })
  async getBanks() {
    return { success: true, data: await this.svc.getBanksList() };
  }

  // ── Bank account ──

  @Post('bank-account/verify')
  @ApiOperation({ summary: 'Verify account number and get account name' })
  async verifyAccount(@Body() dto: VerifyBankAccountDto) {
    return { success: true, data: await this.svc.verifyBankAccount(dto) };
  }

  @Get('bank-account')
  @ApiOperation({ summary: 'Get saved bank account (or null)' })
  async getAccount(@Req() req: any) {
    return { success: true, data: await this.svc.getBankAccount(req.user.sub) };
  }

  @Post('bank-account')
  @ApiOperation({ summary: 'Save / update bank account (creates Paystack recipient)' })
  async saveAccount(@Req() req: any, @Body() dto: SaveBankAccountDto) {
    const data = await this.svc.saveBankAccount(req.user.sub, dto);
    return { success: true, message: 'Bank account saved', data };
  }

  @Delete('bank-account')
  @ApiOperation({ summary: 'Delete bank account' })
  async deleteAccount(@Req() req: any) {
    await this.svc.deleteBankAccount(req.user.sub);
    return { success: true, message: 'Bank account removed' };
  }

  // ── Withdraw ──

  @Post('withdraw')
  @UseGuards(PinGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Withdraw to bank account (automatic via Paystack Transfer)' })
  @ApiHeader({ name: 'x-txn-pin', description: '4-digit transaction PIN', required: true })
  @ApiResponse({ status: 201, description: 'Withdrawal initiated — money is being sent' })
  @ApiResponse({ status: 400, description: 'Insufficient balance / no bank account / Paystack error' })
  async withdraw(@Req() req: any, @Body() dto: InitiateWithdrawalDto) {
    const data = await this.svc.initiateWithdrawal(req.user.sub, dto);
    return {
      success: true,
      message: 'Withdrawal initiated. Funds are being sent to your bank account.',
      data: {
        ...data,
        formattedAmount: `₦${(data.amount / 100).toLocaleString()}`,
      },
    };
  }

  // ── History ──

  @Get('withdrawals')
  @ApiOperation({ summary: 'Get withdrawal history' })
  async list(@Req() req: any, @Query() q: WithdrawalsQueryDto) {
    const r = await this.svc.getUserWithdrawals(req.user.sub, q);
    return {
      success: true,
      data: r.data.map((w: any) => ({
        ...w,
        formattedAmount: `₦${(w.amount / 100).toLocaleString()}`,
      })),
      pagination: { total: r.total, page: r.page, limit: r.limit, totalPages: Math.ceil(r.total / r.limit) },
    };
  }

  @Get('withdrawals/:reference')
  @ApiOperation({ summary: 'Get withdrawal by reference' })
  async detail(@Req() req: any, @Param('reference') ref: string) {
    const w: any = await this.svc.getUserWithdrawalByReference(req.user.sub, ref);
    return {
      success: true,
      data: { ...w, formattedAmount: `₦${(w.amount / 100).toLocaleString()}` },
    };
  }
}