/**
 * Webhooks Controller
 *
 * Handles incoming webhooks from payment providers:
 * - Paystack payment notifications (charge.success, transfer.*)
 */
import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  Req,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request } from 'express';
import { PaystackService } from '../paystack/paystack.service';
import { WalletService } from '../wallet/wallet.service';
import { WithdrawalService } from '../wallet/withdrawal.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TransactionCategory, TransactionSource } from '../wallet/schemas/wallet-transaction.schema';
import { Public } from '../common/decorators';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly paystackService: PaystackService,
    private readonly walletService: WalletService,
    private readonly withdrawalService: WithdrawalService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Paystack Webhook Handler
   *
   * Processes payment notifications from Paystack:
   * 1. Verifies webhook signature
   * 2. Routes to appropriate handler based on event type
   *
   * Supported events:
   * - charge.success → wallet top-up (card payment or DVA bank transfer)
   * - transfer.success → withdrawal completed
   * - transfer.failed → withdrawal failed (auto-refund)
   * - transfer.reversed → withdrawal reversed (auto-refund)
   */
  @Post('paystack')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paystack webhook endpoint' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 400, description: 'Invalid signature' })
  async handlePaystackWebhook(
    @Body() body: any,
    @Headers('x-paystack-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const event = body?.event || 'unknown';
    const reference = body?.data?.reference || 'N/A';

    this.logger.log(`Paystack webhook received: event=${event}, ref=${reference}`);

    // Get raw body for signature verification
    const rawBody = req.rawBody?.toString();

    if (!rawBody) {
      this.logger.warn('Paystack webhook: rawBody not available, falling back to JSON.stringify');
    }

    const payload = rawBody || JSON.stringify(body);

    // Verify signature
    if (!signature || !this.paystackService.verifyWebhookSignature(payload, signature)) {
      this.logger.warn(`Paystack webhook signature mismatch: event=${event}, ref=${reference}`);
      throw new BadRequestException('Invalid signature');
    }

    const data = body.data;

    try {
      switch (event) {
        // ── Payment / Top-up ──
        case 'charge.success': {
          if (data.channel === 'dedicated_nuban') {
            // DVA transfer (bank transfer to virtual account)
            this.logger.log(`DVA transfer: ref=${reference}, amount=${data.amount}`);
            await this.walletService.handleDvaTransfer(data);
          } else {
            // Regular Paystack payment (card, bank, etc.)
            await this.handlePaystackChargeSuccess(data, body);
          }
          break;
        }

        // ── Withdrawal transfers ──
        case 'transfer.success':
        case 'transfer.failed':
        case 'transfer.reversed': {
          this.logger.log(`Transfer webhook: event=${event}, ref=${reference}, transfer_code=${data?.transfer_code}`);
          await this.withdrawalService.handleTransferWebhook(event, data);
          break;
        }

        default:
          this.logger.log(`Unhandled Paystack event: ${event}`);
      }
    } catch (error) {
      this.logger.error(
        `Webhook processing error: event=${event}, ref=${reference}, error=${(error as Error).message}`,
        (error as Error).stack,
      );
      // Still return 200 so Paystack doesn't retry endlessly
    }

    // Always return 200 to acknowledge receipt
    return { received: true };
  }

  /**
   * Handle successful Paystack charge (card/bank payment)
   */
  private async handlePaystackChargeSuccess(
    data: any,
    fullEvent: any,
  ): Promise<void> {
    const reference = data.reference;
    const amount = data.amount; // In kobo
    const metadata = data.metadata || {};
    const userId = metadata.userId;

    if (!reference) {
      this.logger.warn('Paystack webhook missing reference');
      return;
    }

    this.logger.log(
      `charge.success: ref=${reference}, amount=${amount}, userId=${userId || 'N/A'}, ` +
      `type=${metadata.type || 'N/A'}, channel=${data.channel}`,
    );

    // Check if already processed (idempotency)
    const isProcessed = await this.paystackService.isTransactionProcessed(reference);
    if (isProcessed) {
      this.logger.log(`Paystack payment already processed: ${reference}`);
      return;
    }

    // Update Paystack transaction record
    await this.paystackService.updateTransactionFromWebhook(reference, fullEvent);

    // Credit wallet if this is a top-up
    if (metadata.type === 'WALLET_TOPUP' && userId) {
      try {
        // Check if wallet transaction already exists (double idempotency)
        const existingTxn = await this.walletService.findTransactionByReference(reference);
        if (existingTxn) {
          this.logger.log(`Wallet already credited for: ${reference}`);
          return;
        }

        // Credit wallet
        await this.walletService.creditWallet({
          userId,
          amount,
          category: TransactionCategory.TOPUP,
          source: TransactionSource.PAYSTACK_TOPUP,
          narration: `Wallet top-up via Paystack`,
          reference,
          meta: {
            paystackReference: reference,
            channel: data.channel,
            gatewayResponse: data.gateway_response,
          },
        });

        this.logger.log(`Wallet credited: userId=${userId}, amount=₦${amount / 100}, ref=${reference}`);

        // Send push + in-app notification
        this.notificationsService.sendToUser(
          userId,
          'Wallet Funded',
          `Your wallet has been funded with ₦${(amount / 100).toLocaleString('en-NG')}.`,
          { type: 'wallet_topup', reference },
          'TRANSACTION' as any,
          'wallet_topup',
        ).catch((err) => this.logger.error('Failed to send topup notification:', err.message));
      } catch (error) {
        // Handle duplicate key error gracefully (already processed)
        if ((error as any).code === 11000) {
          this.logger.log(`Duplicate transaction reference: ${reference}`);
          return;
        }
        this.logger.error(`Failed to credit wallet: ${(error as Error).message}`, (error as Error).stack);
        throw error;
      }
    } else {
      this.logger.warn(
        `charge.success not processed: metadata.type=${metadata.type}, userId=${userId || 'missing'}. ` +
        `Full metadata: ${JSON.stringify(metadata)}`,
      );
    }
  }
}
