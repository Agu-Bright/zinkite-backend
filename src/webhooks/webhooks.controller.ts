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
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request } from 'express';
import { PaystackService } from '../paystack/paystack.service';
import { KorapayService } from '../korapay/korapay.service';
import { WalletService } from '../wallet/wallet.service';
import { WithdrawalService } from '../wallet/withdrawal.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TransactionCategory, TransactionSource } from '../wallet/schemas/wallet-transaction.schema';
import { toKobo } from '../common/utils/helpers';
import { Public } from '../common/decorators';
import { UserTaskService } from '../user-tasks/user-task.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly paystackService: PaystackService,
    private readonly korapayService: KorapayService,
    private readonly walletService: WalletService,
    private readonly withdrawalService: WithdrawalService,
    private readonly notificationsService: NotificationsService,
    private readonly userTaskService: UserTaskService,
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
  @SkipThrottle()
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
   * Kora Pay Webhook Handler
   *
   * Kora signs the JSON-stringified `data` object with HMAC-SHA256(secret key)
   * and sends it in the `x-korapay-signature` header.
   *
   * Supported events:
   * - charge.success   → wallet top-up (card / bank transfer / VBA)
   * - transfer.success → withdrawal completed
   * - transfer.failed  → withdrawal failed (auto-refund)
   */
  @Post('korapay')
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kora Pay webhook endpoint' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 400, description: 'Invalid signature' })
  async handleKorapayWebhook(
    @Body() body: any,
    @Headers('x-korapay-signature') signature: string,
  ) {
    const event = body?.event || 'unknown';
    const data = body?.data || {};
    const reference = data?.reference || 'N/A';

    this.logger.log(`Kora webhook received: event=${event}, ref=${reference}`);

    // Kora signs the `data` object specifically (not the whole payload).
    if (!this.korapayService.verifyWebhookSignature(data, signature)) {
      this.logger.warn(`Kora webhook signature mismatch: event=${event}, ref=${reference}`);
      throw new BadRequestException('Invalid signature');
    }

    try {
      switch (event) {
        case 'charge.success': {
          // A virtual-account deposit has no checkout metadata.userId — route it
          // to the VBA handler which resolves the user from the account reference.
          const isVbaDeposit =
            !data?.metadata?.userId &&
            (data?.virtual_bank_account_details ||
              data?.virtual_account ||
              data?.account_reference ||
              data?.payment_method === 'bank_transfer');

          if (isVbaDeposit) {
            this.logger.log(`Kora VBA deposit: ref=${reference}, amount=${data?.amount}`);
            await this.walletService.handleKoraVbaTransfer(data);
          } else {
            await this.handleKoraChargeSuccess(data, body);
          }
          break;
        }
        case 'transfer.success':
        case 'transfer.failed': {
          this.logger.log(`Kora transfer webhook: event=${event}, ref=${reference}`);
          await this.withdrawalService.handleKoraTransferWebhook(event, data);
          break;
        }
        default:
          this.logger.log(`Unhandled Kora event: ${event}`);
      }
    } catch (error) {
      this.logger.error(
        `Kora webhook error: event=${event}, ref=${reference}, error=${(error as Error).message}`,
        (error as Error).stack,
      );
      // Still 200 so Kora doesn't retry endlessly
    }

    return { received: true };
  }

  /**
   * Handle a successful Kora charge → credit wallet.
   * Kora amounts are in MAJOR units (NGN); the wallet stores kobo.
   */
  private async handleKoraChargeSuccess(data: any, fullEvent: any): Promise<void> {
    const reference = data.reference;
    const amountKobo = toKobo(Number(data.amount) || 0);
    const metadata = data.metadata || {};

    if (!reference) {
      this.logger.warn('Kora webhook missing reference');
      return;
    }

    // Idempotency on the Kora transaction record
    if (await this.korapayService.isTransactionProcessed(reference)) {
      this.logger.log(`Kora payment already processed: ${reference}`);
      return;
    }
    await this.korapayService.updateTransactionFromWebhook(reference, fullEvent);

    // ── Resolve userId with fallback ──
    // Some Kora channels (bank transfer / Pay With Bank) don't always echo the
    // metadata we set at init. We saved a KorapayTransaction record with the
    // userId at /charges/initialize time, so look it up by reference.
    let userId: string | undefined = metadata.userId;
    let topupType: string | undefined = metadata.type;
    let userIdSource = 'metadata';

    if (!userId || topupType !== 'WALLET_TOPUP') {
      const record = await this.korapayService.getTransactionByReference(reference);
      if (record) {
        userId = userId || record.userId?.toString();
        topupType = topupType || (record.metadata as any)?.type;
        userIdSource = 'record';
      }
    }

    this.logger.log(
      `Kora charge.success resolution: ref=${reference}, amount=₦${amountKobo / 100}, ` +
      `userId=${userId || 'missing'}, type=${topupType || 'missing'}, source=${userIdSource}`,
    );

    if (!userId || topupType !== 'WALLET_TOPUP') {
      this.logger.warn(
        `Kora charge.success skipped — could not resolve userId or type from metadata or record: ref=${reference}`,
      );
      return;
    }

    try {
      // Double idempotency against the wallet ledger
      const existingTxn = await this.walletService.findTransactionByReference(reference);
      if (existingTxn) {
        this.logger.log(`Wallet already credited for: ${reference}`);
        return;
      }

      await this.walletService.creditWallet({
        userId,
        amount: amountKobo,
        category: TransactionCategory.TOPUP,
        source: TransactionSource.KORAPAY_TOPUP,
        narration: 'Wallet top-up via Kora Pay',
        reference,
        meta: {
          korapayReference: reference,
          channel: data.payment_method || data.channel,
        },
      });

      this.logger.log(
        `Wallet credited (Kora): userId=${userId}, amount=₦${amountKobo / 100}, ref=${reference}, source=${userIdSource}`,
      );

      this.userTaskService.completeTask(userId, 'FUND_WALLET').catch((e) =>
        this.logger.debug(`Task completion skipped for FUND_WALLET: ${e.message}`),
      );

      this.notificationsService.sendToUser(
        userId,
        'Wallet Funded',
        `Your wallet has been funded with ₦${(amountKobo / 100).toLocaleString('en-NG')}.`,
        { type: 'wallet_topup', reference },
        'TRANSACTION' as any,
        'wallet_topup',
      ).catch((err) => this.logger.error('Failed to send topup notification:', err.message));
    } catch (error) {
      if ((error as any).code === 11000) {
        this.logger.log(`Duplicate transaction reference: ${reference}`);
        return;
      }
      this.logger.error(`Failed to credit wallet (Kora): ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
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

    if (!reference) {
      this.logger.warn('Paystack webhook missing reference');
      return;
    }

    // Check if already processed (idempotency)
    const isProcessed = await this.paystackService.isTransactionProcessed(reference);
    if (isProcessed) {
      this.logger.log(`Paystack payment already processed: ${reference}`);
      return;
    }

    // Update Paystack transaction record
    await this.paystackService.updateTransactionFromWebhook(reference, fullEvent);

    // ── Resolve userId with fallback ──
    // If Paystack didn't echo our metadata back (rare but observed),
    // look up the PaystackTransaction record we saved at init time.
    let userId: string | undefined = metadata.userId;
    let topupType: string | undefined = metadata.type;
    let userIdSource = 'metadata';

    if (!userId || topupType !== 'WALLET_TOPUP') {
      const record = await this.paystackService.getTransactionByReference(reference);
      if (record) {
        userId = userId || record.userId?.toString();
        topupType = topupType || (record.metadata as any)?.type;
        userIdSource = 'record';
      }
    }

    this.logger.log(
      `Paystack charge.success resolution: ref=${reference}, amount=₦${amount / 100}, ` +
      `userId=${userId || 'missing'}, type=${topupType || 'missing'}, channel=${data.channel}, source=${userIdSource}`,
    );

    // Credit wallet if this is a top-up
    if (topupType === 'WALLET_TOPUP' && userId) {
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

        this.logger.log(
          `Wallet credited: userId=${userId}, amount=₦${amount / 100}, ref=${reference}, source=${userIdSource}`,
        );

        // Auto-complete FUND_WALLET task
        this.userTaskService.completeTask(userId, 'FUND_WALLET').catch((e) =>
          this.logger.debug(`Task completion skipped for FUND_WALLET: ${e.message}`),
        );

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
        `charge.success skipped — could not resolve userId or type from metadata or record: ref=${reference}, ` +
        `metadata=${JSON.stringify(metadata)}`,
      );
    }
  }
}
