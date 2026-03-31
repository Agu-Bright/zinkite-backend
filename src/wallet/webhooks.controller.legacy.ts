import {
  Controller,
  Post,
  Req,
  Res,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { WalletService } from '../wallet/wallet.service';
import { WithdrawalService } from '../wallet/withdrawal.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly walletService: WalletService,          // ← Use WalletService instead of PaystackService
    private readonly withdrawalService: WithdrawalService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret = this.configService.get<string>('PAYSTACK_WEBHOOK_SECRET') || '';
  }

  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paystack webhook receiver (payments + transfers)' })
  async handlePaystackWebhook(@Req() req: any, @Res() res: any) {
    // ── Verify signature ──
    const signature = req.headers['x-paystack-signature'];
    const hash = crypto
      .createHmac('sha512', this.webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== signature) {
      this.logger.warn('Paystack webhook signature mismatch — rejecting');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event: string = req.body.event;
    const data: any = req.body.data;

    this.logger.log(`Paystack webhook received: ${event} ref=${data?.reference || 'N/A'}`);

    try {
      switch (event) {
        // ── Payment / Top-up ──
        case 'charge.success': {
          const reference = data?.reference;
          const userId = data?.metadata?.userId;
          if (reference && userId) {
            await this.walletService.verifyTopup(reference, userId);
            this.logger.log(`charge.success processed for ref=${reference}`);
          } else {
            this.logger.warn(`charge.success missing reference or userId metadata`);
          }
          break;
        }

        // ── Automatic withdrawal transfers ──
        case 'transfer.success':
        case 'transfer.failed':
        case 'transfer.reversed':
          await this.withdrawalService.handleTransferWebhook(event, data);
          break;

        default:
          this.logger.log(`Unhandled Paystack event: ${event}`);
      }
    } catch (err) {
      this.logger.error(`Webhook processing error for ${event}: ${(err as Error).message}`);
      // Still return 200 so Paystack doesn't retry endlessly
    }

    return res.status(200).json({ received: true });
  }
}