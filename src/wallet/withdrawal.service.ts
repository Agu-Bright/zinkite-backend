/**
 * Withdrawal Service — Automatic Payouts via Paystack Transfers
 *
 * How it works:
 * ─────────────
 * 1. User saves bank account
 *    → Verify account via Paystack Resolve Account API
 *    → Create a Paystack Transfer Recipient (stored for reuse)
 *
 * 2. User initiates withdrawal
 *    → Validate balance
 *    → Debit wallet atomically
 *    → Call Paystack POST /transfer to send money immediately
 *    → Store transfer code and mark status PENDING
 *
 * 3. Paystack processes the transfer in the background
 *    → Sends webhook: transfer.success / transfer.failed / transfer.reversed
 *
 * 4. Webhook handler updates withdrawal status
 *    → SUCCESS  → mark completed
 *    → FAILED   → auto-refund wallet
 *    → REVERSED → auto-refund wallet
 *
 * Paystack Transfer APIs used:
 *   POST   https://api.paystack.co/transferrecipient   — create recipient
 *   GET    https://api.paystack.co/bank?country=nigeria — list banks
 *   GET    https://api.paystack.co/bank/resolve         — verify account name
 *   POST   https://api.paystack.co/transfer             — initiate transfer
 */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

import { BankAccount, BankAccountDocument } from './schemas/bank-account.schema';
import {
  Withdrawal,
  WithdrawalDocument,
  WithdrawalStatus,
} from './schemas/withdrawal.schema';
import { Wallet, WalletDocument } from './schemas/wallet.schema';
import {
  WalletTransaction,
  WalletTransactionDocument,
  TransactionType,
  TransactionCategory,
  TransactionSource,
  TransactionStatus,
} from './schemas/wallet-transaction.schema';
import {
  SaveBankAccountDto,
  VerifyBankAccountDto,
  InitiateWithdrawalDto,
  WithdrawalsQueryDto,
  AdminWithdrawalsQueryDto,
} from './dto/withdrawal.dto';
import { generateReference } from '../common/utils/helpers';
import { KorapayService } from '../korapay/korapay.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UserTaskService } from '../user-tasks/user-task.service';

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);
  private readonly paystack: AxiosInstance;

  constructor(
    @InjectModel(BankAccount.name) private bankAccountModel: Model<BankAccountDocument>,
    @InjectModel(Withdrawal.name) private withdrawalModel: Model<WithdrawalDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
    @InjectModel(WalletTransaction.name) private walletTxnModel: Model<WalletTransactionDocument>,
    @InjectConnection() private connection: Connection,
    private configService: ConfigService,
    private readonly korapayService: KorapayService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly userTaskService: UserTaskService,
  ) {
    // Paystack axios instance with auth header baked in
    this.paystack = axios.create({
      baseURL: 'https://api.paystack.co',
      headers: {
        Authorization: `Bearer ${this.configService.get<string>('PAYSTACK_SECRET_KEY')}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Active payment provider. Defaults to 'paystack' (safe) when unset —
   * set PAYMENT_PROVIDER=korapay to activate Kora.
   */
  private getPaymentProvider(): 'korapay' | 'paystack' {
    const p = (this.configService.get<string>('PAYMENT_PROVIDER') || 'paystack').toLowerCase();
    return p === 'korapay' ? 'korapay' : 'paystack';
  }

  // ═══════════════════════════════════════════════════
  //  BANK ACCOUNT MANAGEMENT
  // ═══════════════════════════════════════════════════

  /**
   * Fetch the list of Nigerian banks from Paystack (cached on client side).
   */
  async getBanksList(): Promise<Array<{ name: string; code: string }>> {
    // Kora and Paystack use different bank-code schemes, so the list MUST come
    // from the same provider that will resolve + disburse.
    if (this.getPaymentProvider() === 'korapay') {
      return this.korapayService.listBanks();
    }
    try {
      const { data } = await this.paystack.get('/bank?country=nigeria&perPage=100');
      return (data.data || []).map((b: any) => ({ name: b.name, code: b.code }));
    } catch (err: any) {
      this.logger.error(`Paystack banks list failed: ${err.message}`);
      throw new BadRequestException('Could not fetch banks list');
    }
  }

  /**
   * Verify an account number + bank code via Paystack Resolve Account.
   * Returns the verified account name.
   */
  async verifyBankAccount(dto: VerifyBankAccountDto) {
    // ── Kora path ──
    if (this.getPaymentProvider() === 'korapay') {
      try {
        const resolved = await this.korapayService.resolveBankAccount({
          bankCode: dto.bankCode,
          accountNumber: dto.accountNumber,
        });
        return {
          verified: true,
          accountName: resolved.accountName,
          accountNumber: dto.accountNumber,
          bankCode: dto.bankCode,
        };
      } catch (err: any) {
        const msg = err.response?.data?.message || 'Could not verify account. Check the details.';
        this.logger.warn(`Kora resolve account failed: ${msg}`);
        throw new BadRequestException(msg);
      }
    }

    // ── Paystack path ──
    try {
      const { data } = await this.paystack.get(
        `/bank/resolve?account_number=${dto.accountNumber}&bank_code=${dto.bankCode}`,
      );
      return {
        verified: true,
        accountName: data.data.account_name as string,
        accountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
      };
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Could not verify account. Check the details.';
      this.logger.warn(`Resolve account failed: ${msg}`);
      throw new BadRequestException(msg);
    }
  }

  /**
   * Save (or replace) a user's bank account.
   *
   * Steps:
   *  1. Create a Paystack Transfer Recipient
   *  2. Upsert the bank account document with the recipient code
   *
   * A valid recipient code is required for transfers, so we create it up front.
   */
  async saveBankAccount(userId: string, dto: SaveBankAccountDto) {
    this.logger.log(`Saving bank account for user ${userId}: ${dto.bankName} ${dto.accountNumber}`);

    // 1 — Paystack needs a Transfer Recipient created up front.
    //     Kora disburses directly to bank code + account number, so no recipient.
    let recipientCode: string | undefined;
    if (this.getPaymentProvider() === 'paystack') {
      try {
        const { data } = await this.paystack.post('/transferrecipient', {
          type: 'nuban',
          name: dto.accountName,
          account_number: dto.accountNumber,
          bank_code: dto.bankCode,
          currency: 'NGN',
        });
        recipientCode = data.data.recipient_code;
        this.logger.log(`Paystack recipient created: ${recipientCode}`);
      } catch (err: any) {
        const msg = err.response?.data?.message || 'Could not create transfer recipient';
        this.logger.error(`Create recipient failed: ${msg}`);
        throw new BadRequestException(msg);
      }
    }

    // 2 — Upsert bank account
    const bankAccount = await this.bankAccountModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      {
        userId: new Types.ObjectId(userId),
        bankName: dto.bankName,
        bankCode: dto.bankCode,
        accountNumber: dto.accountNumber,
        accountName: dto.accountName,
        ...(recipientCode && { paystackRecipientCode: recipientCode }),
        isVerified: true,
      },
      { upsert: true, new: true },
    );

    // Auto-complete the SETUP_WITHDRAWAL task
    try {
      await this.userTaskService.completeTask(userId, 'SETUP_WITHDRAWAL');
    } catch (e) {
      // Task may already be completed or not exist — don't block the flow
      this.logger.debug(`Task completion skipped for SETUP_WITHDRAWAL: ${e.message}`);
    }

    return bankAccount.toJSON();
  }

  /** Get user's saved bank account (or null) */
  async getBankAccount(userId: string) {
    return this.bankAccountModel.findOne({ userId: new Types.ObjectId(userId) }).lean();
  }

  /** Delete bank account (blocked while pending withdrawals exist) */
  async deleteBankAccount(userId: string) {
    const pending = await this.withdrawalModel.countDocuments({
      userId: new Types.ObjectId(userId),
      status: { $in: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING] },
    });
    if (pending > 0) {
      throw new BadRequestException('Cannot delete bank account while withdrawals are in progress');
    }
    const res = await this.bankAccountModel.deleteOne({ userId: new Types.ObjectId(userId) });
    if (res.deletedCount === 0) throw new NotFoundException('No bank account found');
  }

  // ═══════════════════════════════════════════════════
  //  INITIATE WITHDRAWAL  (fully automatic)
  // ═══════════════════════════════════════════════════

  /**
   * Initiate a withdrawal — money is sent automatically via Paystack.
   *
   * Atomic flow inside a Mongo session:
   *  1. Debit wallet
   *  2. Create wallet transaction (DEBIT / SUCCESS)
   *  3. Create withdrawal record (PENDING)
   *  — commit —
   *  4. Call Paystack POST /transfer
   *  5. Update withdrawal with transfer code
   *
   * If Paystack call fails immediately we refund in a separate session.
   * If Paystack accepts the transfer, the final outcome is determined
   * by the webhook (transfer.success / transfer.failed / transfer.reversed).
   */
  async initiateWithdrawal(userId: string, dto: InitiateWithdrawalDto) {
    this.logger.log(`Withdrawal request: user=${userId} amount=₦${dto.amount}`);

    const provider = this.getPaymentProvider();

    // ── Pre-checks ──
    const bankAccount = await this.bankAccountModel.findOne({
      userId: new Types.ObjectId(userId),
    });
    if (!bankAccount) {
      throw new BadRequestException('Please add and verify your bank account first');
    }
    // Paystack needs a saved transfer-recipient code; Kora disburses directly to
    // the stored bank code + account number, so no recipient code is required.
    if (provider === 'paystack' && !bankAccount.paystackRecipientCode) {
      throw new BadRequestException('Please add and verify your bank account first');
    }
    if (provider === 'korapay' && (!bankAccount.bankCode || !bankAccount.accountNumber)) {
      throw new BadRequestException('Please add and verify your bank account first');
    }

    const amountKobo = Math.round(dto.amount * 100);

    const wallet = await this.walletModel.findOne({ userId: new Types.ObjectId(userId) });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.balance < amountKobo) {
      throw new BadRequestException(
        `Insufficient balance. You have ₦${(wallet.balance / 100).toLocaleString()}`,
      );
    }

    const reference = generateReference('WDR');

    // ── Step 1-3: Debit wallet + create records atomically ──
    const session = await this.connection.startSession();
    session.startTransaction();

    let withdrawal: WithdrawalDocument;
    try {
      const updatedWallet = await this.walletModel.findOneAndUpdate(
        { _id: wallet._id, balance: { $gte: amountKobo } },
        { $inc: { balance: -amountKobo } },
        { new: true, session },
      );
      if (!updatedWallet) throw new BadRequestException('Insufficient balance');

      await this.walletTxnModel.create(
        [
          {
            userId: new Types.ObjectId(userId),
            walletId: wallet._id,
            type: TransactionType.DEBIT,
            category: TransactionCategory.MANUAL, // or add WITHDRAWAL to your enum
            source: TransactionSource.MANUAL_ADJUSTMENT, // or add WITHDRAWAL
            amount: amountKobo,
            currency: 'NGN',
            reference,
            status: TransactionStatus.SUCCESS,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance - amountKobo,
            narration: `Withdrawal to ${bankAccount.bankName} - ${bankAccount.accountNumber}`,
            meta: {
              withdrawalType: 'PAYSTACK_TRANSFER',
              bankName: bankAccount.bankName,
              accountNumber: bankAccount.accountNumber,
              accountName: bankAccount.accountName,
            },
          },
        ],
        { session },
      );

      [withdrawal] = await this.withdrawalModel.create(
        [
          {
            userId: new Types.ObjectId(userId),
            walletId: wallet._id,
            amount: amountKobo,
            currency: 'NGN',
            reference,
            status: WithdrawalStatus.PENDING,
            bankName: bankAccount.bankName,
            bankCode: bankAccount.bankCode,
            accountNumber: bankAccount.accountNumber,
            accountName: bankAccount.accountName,
            ...(bankAccount.paystackRecipientCode && {
              paystackRecipientCode: bankAccount.paystackRecipientCode,
            }),
            walletTransactionReference: reference,
          },
        ],
        { session },
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    // ── Step 4-5: Initiate the payout via the active provider ──
    try {
      if (provider === 'korapay') {
        const result = await this.korapayService.disburse({
          reference,
          amount: dto.amount, // Kora uses major NGN units
          bankCode: bankAccount.bankCode,
          accountNumber: bankAccount.accountNumber,
          accountName: bankAccount.accountName,
          customerEmail: '',
          customerName: bankAccount.accountName,
          narration: `Zinkitex withdrawal ${reference}`,
        });

        this.logger.log(`Kora disburse: ref=${reference} status=${result.status}`);

        if (result.status === 'success') {
          withdrawal.status = WithdrawalStatus.SUCCESS;
          withdrawal.completedAt = new Date();
        } else {
          // 'processing' / 'pending' → wait for the transfer webhook
          withdrawal.status = WithdrawalStatus.PROCESSING;
        }

        await withdrawal.save();
        return withdrawal.toJSON();
      }

      // ── Paystack path (fallback / rollback) ──
      const { data: transferRes } = await this.paystack.post('/transfer', {
        source: 'balance',
        reason: `Zinkite withdrawal ${reference}`,
        amount: amountKobo, // Paystack expects kobo
        recipient: bankAccount.paystackRecipientCode,
        reference, // our own unique reference
      });

      const transferData = transferRes.data;
      this.logger.log(
        `Paystack transfer initiated: code=${transferData.transfer_code} status=${transferData.status}`,
      );

      // Update withdrawal with Paystack transfer details
      withdrawal.paystackTransferCode = transferData.transfer_code;
      withdrawal.paystackTransferId = transferData.id;

      // Paystack may return "success" immediately for small amounts or return "pending"
      if (transferData.status === 'success') {
        withdrawal.status = WithdrawalStatus.SUCCESS;
        withdrawal.completedAt = new Date();
      } else if (transferData.status === 'pending' || transferData.status === 'otp') {
        withdrawal.status = WithdrawalStatus.PROCESSING;
      }

      await withdrawal.save();
      return withdrawal.toJSON();
    } catch (err: any) {
      // Provider rejected the transfer — refund wallet
      const reason = err.response?.data?.message || err.message || 'Transfer initiation failed';
      this.logger.error(`Payout failed for ${reference}: ${reason}`);

      withdrawal.status = WithdrawalStatus.FAILED;
      withdrawal.failureReason = reason;
      await withdrawal.save();

      // Refund wallet
      await this.refundWallet(withdrawal);

      throw new BadRequestException(
        `Withdrawal failed: ${reason}. Your wallet has been refunded.`,
      );
    }
  }

  // ═══════════════════════════════════════════════════
  //  KORA TRANSFER WEBHOOK HANDLER
  // ═══════════════════════════════════════════════════

  /**
   * Handle Kora payout webhook events.
   * Kora uses our own `reference` to identify the disbursement.
   *
   *  - transfer.success → mark SUCCESS
   *  - transfer.failed  → mark FAILED, auto-refund
   */
  async handleKoraTransferWebhook(event: string, webhookData: any) {
    const reference = webhookData.reference;
    this.logger.log(`Kora transfer webhook: event=${event} ref=${reference}`);

    const withdrawal = await this.withdrawalModel.findOne({ reference });
    if (!withdrawal) {
      this.logger.warn(`Withdrawal not found for Kora webhook: ref=${reference}`);
      return;
    }

    // Idempotency: skip if already terminal
    if (
      [WithdrawalStatus.SUCCESS, WithdrawalStatus.FAILED, WithdrawalStatus.REVERSED].includes(
        withdrawal.status,
      )
    ) {
      this.logger.log(`Withdrawal ${withdrawal.reference} already terminal (${withdrawal.status}), skipping`);
      return;
    }

    withdrawal.rawWebhookEvent = webhookData;

    if (event === 'transfer.success') {
      withdrawal.status = WithdrawalStatus.SUCCESS;
      withdrawal.completedAt = new Date();
      await withdrawal.save();
      this.logger.log(`✅ Withdrawal ${withdrawal.reference} SUCCESS (Kora)`);

      const amountNaira = withdrawal.amount / 100;
      this.notificationsService.sendToUser(
        withdrawal.userId.toString(),
        'Withdrawal Successful',
        `Your withdrawal of ₦${amountNaira.toLocaleString()} has been sent to your bank account.`,
        { type: 'withdrawal_update', withdrawalId: withdrawal._id.toString(), status: 'SUCCESS' },
        'TRANSACTION' as any,
        'withdrawal_update',
      ).catch((err) => this.logger.error(`Withdrawal notification error: ${err.message}`));
    } else if (event === 'transfer.failed') {
      withdrawal.status = WithdrawalStatus.FAILED;
      withdrawal.failureReason = webhookData.reason || webhookData.message || 'Transfer failed';
      await withdrawal.save();
      this.logger.warn(`❌ Withdrawal ${withdrawal.reference} FAILED (Kora) — refunding`);
      await this.refundWallet(withdrawal);

      this.notificationsService.sendToUser(
        withdrawal.userId.toString(),
        'Withdrawal Failed',
        `Your withdrawal of ₦${(withdrawal.amount / 100).toLocaleString()} failed and your wallet has been refunded.`,
        { type: 'withdrawal_update', withdrawalId: withdrawal._id.toString(), status: 'FAILED' },
        'TRANSACTION' as any,
        'withdrawal_update',
      ).catch((err) => this.logger.error(`Withdrawal notification error: ${err.message}`));
    }
  }

  // ═══════════════════════════════════════════════════
  //  PAYSTACK TRANSFER WEBHOOK HANDLER
  // ═══════════════════════════════════════════════════

  /**
   * Handle Paystack transfer webhook events.
   * Called from the webhooks controller after signature verification.
   *
   * Events handled:
   *  - transfer.success  → mark SUCCESS
   *  - transfer.failed   → mark FAILED, auto-refund
   *  - transfer.reversed → mark REVERSED, auto-refund
   */
  async handleTransferWebhook(event: string, webhookData: any) {
    const transferCode = webhookData.transfer_code;
    const paystackRef = webhookData.reference;

    this.logger.log(`Transfer webhook: event=${event} ref=${paystackRef} code=${transferCode}`);

    // Find the withdrawal by reference or transfer code
    const withdrawal = await this.withdrawalModel.findOne({
      $or: [
        { reference: paystackRef },
        { paystackTransferCode: transferCode },
      ],
    });

    if (!withdrawal) {
      this.logger.warn(`Withdrawal not found for webhook: ref=${paystackRef} code=${transferCode}`);
      return; // Ignore — could be from another service
    }

    // Idempotency: skip if already in a terminal state
    if ([WithdrawalStatus.SUCCESS, WithdrawalStatus.FAILED, WithdrawalStatus.REVERSED].includes(withdrawal.status)) {
      this.logger.log(`Withdrawal ${withdrawal.reference} already terminal (${withdrawal.status}), skipping`);
      return;
    }

    // Store raw webhook for audit
    withdrawal.rawWebhookEvent = webhookData;

    switch (event) {
      case 'transfer.success': {
        withdrawal.status = WithdrawalStatus.SUCCESS;
        withdrawal.completedAt = new Date();
        withdrawal.paystackTransferCode = withdrawal.paystackTransferCode || transferCode;
        await withdrawal.save();
        this.logger.log(`✅ Withdrawal ${withdrawal.reference} SUCCESS`);

        const amountNaira = withdrawal.amount / 100;
        this.notificationsService.sendToUser(
          withdrawal.userId.toString(),
          'Withdrawal Successful',
          `Your withdrawal of ₦${amountNaira.toLocaleString()} has been sent to your bank account.`,
          { type: 'withdrawal_update', withdrawalId: withdrawal._id.toString(), status: 'SUCCESS' },
          'TRANSACTION' as any,
          'withdrawal_update',
        ).catch((err) => this.logger.error(`Withdrawal notification error: ${err.message}`));

        // Send email
        this.userModel.findById(withdrawal.userId).select('email').lean().then(user => {
          if (user?.email) {
            this.emailService.sendWithdrawalCompleted(
              user.email, amountNaira, withdrawal.bankName, withdrawal.accountNumber, withdrawal.reference,
            ).catch(err => this.logger.error(`Withdrawal email error: ${err.message}`));
          }
        });
        break;
      }

      case 'transfer.failed': {
        withdrawal.status = WithdrawalStatus.FAILED;
        withdrawal.failureReason = webhookData.reason || webhookData.message || 'Transfer failed';
        withdrawal.completedAt = new Date();
        await withdrawal.save();
        await this.refundWallet(withdrawal);
        this.logger.log(`❌ Withdrawal ${withdrawal.reference} FAILED — wallet refunded`);

        const failedAmount = withdrawal.amount / 100;
        this.notificationsService.sendToUser(
          withdrawal.userId.toString(),
          'Withdrawal Failed',
          `Your withdrawal of ₦${failedAmount.toLocaleString()} failed. Funds have been refunded to your wallet.`,
          { type: 'withdrawal_update', withdrawalId: withdrawal._id.toString(), status: 'FAILED' },
          'TRANSACTION' as any,
          'withdrawal_update',
        ).catch((err) => this.logger.error(`Withdrawal notification error: ${err.message}`));

        // Send email
        this.userModel.findById(withdrawal.userId).select('email').lean().then(user => {
          if (user?.email) {
            this.emailService.sendWithdrawalFailed(
              user.email, failedAmount, withdrawal.reference, withdrawal.failureReason || 'Transfer failed',
            ).catch(err => this.logger.error(`Withdrawal email error: ${err.message}`));
          }
        });
        break;
      }

      case 'transfer.reversed': {
        withdrawal.status = WithdrawalStatus.REVERSED;
        withdrawal.failureReason = webhookData.reason || 'Transfer reversed';
        withdrawal.completedAt = new Date();
        await withdrawal.save();
        await this.refundWallet(withdrawal);
        this.logger.log(`🔄 Withdrawal ${withdrawal.reference} REVERSED — wallet refunded`);

        const reversedAmount = withdrawal.amount / 100;
        this.notificationsService.sendToUser(
          withdrawal.userId.toString(),
          'Withdrawal Reversed',
          `Your withdrawal of ₦${reversedAmount.toLocaleString()} was reversed. Funds have been refunded to your wallet.`,
          { type: 'withdrawal_update', withdrawalId: withdrawal._id.toString(), status: 'REVERSED' },
          'TRANSACTION' as any,
          'withdrawal_update',
        ).catch((err) => this.logger.error(`Withdrawal notification error: ${err.message}`));
        break;
      }

      default:
        this.logger.warn(`Unhandled transfer webhook event: ${event}`);
    }
  }

  // ═══════════════════════════════════════════════════
  //  WALLET REFUND (internal)
  // ═══════════════════════════════════════════════════

  /**
   * Refund the wallet when a transfer fails or is reversed.
   * Runs in its own session for atomicity.
   */
  private async refundWallet(withdrawal: WithdrawalDocument) {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const refundRef = generateReference('WDR_REFUND');

      const wallet = await this.walletModel.findOneAndUpdate(
        { _id: withdrawal.walletId },
        { $inc: { balance: withdrawal.amount } },
        { new: true, session },
      );
      if (!wallet) throw new NotFoundException('Wallet not found for refund');

      await this.walletTxnModel.create(
        [
          {
            userId: withdrawal.userId,
            walletId: withdrawal.walletId,
            type: TransactionType.CREDIT,
            category: TransactionCategory.REFUND,
            source: TransactionSource.REFUND,
            amount: withdrawal.amount,
            currency: 'NGN',
            reference: refundRef,
            status: TransactionStatus.SUCCESS,
            balanceBefore: wallet.balance - withdrawal.amount,
            balanceAfter: wallet.balance,
            narration: `Refund: failed withdrawal ${withdrawal.reference}`,
            meta: {
              originalReference: withdrawal.reference,
              reason: withdrawal.failureReason,
            },
          },
        ],
        { session },
      );

      await session.commitTransaction();
      this.logger.log(`Wallet refunded for withdrawal ${withdrawal.reference}`);
    } catch (err) {
      await session.abortTransaction();
      this.logger.error(`CRITICAL: Refund failed for ${withdrawal.reference}: ${(err as Error).message}`);

      // Alert ops team via email
      const adminEmail = this.configService.get<string>('ADMIN_EMAIL') || 'admin@zinkite.com';
      this.emailService.send({
        to: adminEmail,
        subject: `CRITICAL: Withdrawal refund failed — ${withdrawal.reference}`,
        html: `
          <h2>Manual Intervention Required</h2>
          <p>A withdrawal refund failed and requires manual intervention.</p>
          <ul>
            <li><strong>Reference:</strong> ${withdrawal.reference}</li>
            <li><strong>User ID:</strong> ${withdrawal.userId}</li>
            <li><strong>Amount:</strong> ₦${(withdrawal.amount / 100).toLocaleString()}</li>
            <li><strong>Error:</strong> ${(err as Error).message}</li>
            <li><strong>Time:</strong> ${new Date().toISOString()}</li>
          </ul>
          <p>Please investigate and manually credit the user's wallet if appropriate.</p>
        `,
      }).catch(emailErr => this.logger.error(`Failed to send refund alert email: ${emailErr.message}`));

      throw err;
    } finally {
      session.endSession();
    }
  }

  // ═══════════════════════════════════════════════════
  //  QUERIES
  // ═══════════════════════════════════════════════════

  async getUserWithdrawals(userId: string, query: WithdrawalsQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filter: any = { userId: new Types.ObjectId(userId) };
    if (query.status) filter.status = query.status;

    const [data, total] = await Promise.all([
      this.withdrawalModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.withdrawalModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  async getUserWithdrawalByReference(userId: string, reference: string) {
    const w = await this.withdrawalModel.findOne({
      userId: new Types.ObjectId(userId),
      reference,
    }).lean();
    if (!w) throw new NotFoundException('Withdrawal not found');
    return w;
  }

  /** Admin: list all withdrawals */
  async adminListWithdrawals(query: AdminWithdrawalsQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filter: any = {};
    if (query.status) filter.status = query.status;
    if (query.search) {
      filter.$or = [
        { reference: { $regex: query.search, $options: 'i' } },
        { accountName: { $regex: query.search, $options: 'i' } },
        { accountNumber: { $regex: query.search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.withdrawalModel
        .find(filter)
        .populate('userId', 'email fullName phone')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.withdrawalModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  async adminGetWithdrawal(id: string) {
    const w = await this.withdrawalModel
      .findById(id)
      .populate('userId', 'email fullName phone')
      .lean();
    if (!w) throw new NotFoundException('Withdrawal not found');
    return w;
  }
}