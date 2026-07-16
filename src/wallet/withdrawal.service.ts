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
import { SettingsService } from '../settings/settings.service';
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
    private readonly settingsService: SettingsService,
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
  //  INITIATE WITHDRAWAL (debit-on-submit, admin-confirmed)
  // ═══════════════════════════════════════════════════

  /**
   * Create a PROCESSING withdrawal — wallet is debited immediately.
   *
   * Flow:
   *  1. Validate that a bank account is saved.
   *  2. Atomic wallet debit with `$gte: amountKobo` guard (race-safe — if the
   *     balance is not enough, nothing changes and we throw).
   *  3. Persist a PROCESSING WalletTransaction so the user's transaction
   *     history shows the debit with an in-progress status.
   *  4. Persist the withdrawal record with status = PROCESSING.
   *  5. Notify admins so someone can send the money and click Approve.
   *
   * On admin approval the WalletTransaction flips to SUCCESS. On rejection
   * the wallet is refunded and the WalletTransaction is marked REVERSED.
   * All three operations run in a Mongo session so they commit or roll back
   * together.
   */
  async initiateWithdrawal(userId: string, dto: InitiateWithdrawalDto) {
    this.logger.log(`Withdrawal request: user=${userId} amount=₦${dto.amount}`);

    const bankAccount = await this.bankAccountModel.findOne({
      userId: new Types.ObjectId(userId),
    });
    if (!bankAccount || !bankAccount.bankCode || !bankAccount.accountNumber) {
      throw new BadRequestException('Please add and verify your bank account first');
    }

    const amountKobo = Math.round(dto.amount * 100);
    const reference = generateReference('WDR');

    const session = await this.connection.startSession();
    session.startTransaction();
    let withdrawalId: Types.ObjectId | undefined;

    try {
      // Race-safe atomic debit.
      const wallet = await this.walletModel.findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          balance: { $gte: amountKobo },
        },
        { $inc: { balance: -amountKobo }, $set: { lastTransactionAt: new Date() } },
        { new: true, session },
      );
      if (!wallet) {
        const current = await this.walletModel
          .findOne({ userId: new Types.ObjectId(userId) })
          .select('balance')
          .lean();
        const availableNaira = ((current?.balance ?? 0) / 100).toLocaleString('en-NG');
        throw new BadRequestException(
          `Insufficient balance. You have ₦${availableNaira} available.`,
        );
      }

      // PROCESSING debit shown in the user's transaction history.
      await this.walletTxnModel.create(
        [
          {
            userId: new Types.ObjectId(userId),
            walletId: wallet._id,
            type: TransactionType.DEBIT,
            category: TransactionCategory.MANUAL,
            source: TransactionSource.MANUAL_ADJUSTMENT,
            amount: amountKobo,
            currency: 'NGN',
            reference,
            status: TransactionStatus.PROCESSING,
            balanceBefore: wallet.balance + amountKobo,
            balanceAfter: wallet.balance,
            narration: `Withdrawal to ${bankAccount.bankName} - ${bankAccount.accountNumber}`,
            meta: {
              withdrawalType: 'MANUAL_PAYOUT',
              bankName: bankAccount.bankName,
              accountNumber: bankAccount.accountNumber,
              accountName: bankAccount.accountName,
            },
          },
        ],
        { session },
      );

      const [withdrawal] = await this.withdrawalModel.create(
        [
          {
            userId: new Types.ObjectId(userId),
            walletId: wallet._id,
            amount: amountKobo,
            currency: 'NGN',
            reference,
            status: WithdrawalStatus.PROCESSING,
            bankName: bankAccount.bankName,
            bankCode: bankAccount.bankCode,
            accountNumber: bankAccount.accountNumber,
            accountName: bankAccount.accountName,
            walletTransactionReference: reference,
          },
        ],
        { session },
      );

      withdrawalId = withdrawal._id;
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    const withdrawal = await this.withdrawalModel.findById(withdrawalId).lean();
    if (!withdrawal) {
      // Should never happen — the commit above just wrote the row.
      throw new InternalServerErrorException('Withdrawal record went missing after commit');
    }

    // Notify admins (best-effort — never blocks the response).
    this.notifyAdminsOfWithdrawal(withdrawal as WithdrawalDocument, userId).catch(
      (err) => this.logger.error(`Failed to send admin withdrawal alert: ${err.message}`),
    );

    return withdrawal;
  }

  /**
   * Send a "new withdrawal needs payout" alert to every email configured in
   * the `admin_notification_emails` admin setting (comma-separated). Falls
   * back to the legacy ADMIN_NOTIFICATION_EMAILS / ADMIN_EMAIL env vars only
   * if the setting is empty, so existing deployments keep working until the
   * admin saves a value via the dashboard. Best-effort — never throws.
   */
  private async notifyAdminsOfWithdrawal(
    withdrawal: WithdrawalDocument,
    userId: string,
  ): Promise<void> {
    // Primary source: AppSettings (editable from /zinkite-admin/settings)
    let raw =
      (await this.settingsService.getValue<string>(
        'admin_notification_emails',
        '',
      )) || '';

    // Backwards-compat fallback to env vars during transition
    if (!raw.trim()) {
      raw =
        this.configService.get<string>('ADMIN_NOTIFICATION_EMAILS') ||
        this.configService.get<string>('ADMIN_EMAIL') ||
        '';
    }

    const recipients = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /.+@.+\..+/.test(s));

    if (recipients.length === 0) {
      this.logger.warn(
        'admin_notification_emails setting is empty — withdrawal alert skipped. ' +
          'Configure it in Admin → Settings → Support.',
      );
      return;
    }

    const user = await this.userModel
      .findById(userId)
      .select('email fullName phone')
      .lean();

    for (const email of recipients) {
      try {
        await this.emailService.sendAdminWithdrawalAlert(email, {
          reference: withdrawal.reference,
          amountNaira: withdrawal.amount / 100,
          bankName: withdrawal.bankName,
          accountNumber: withdrawal.accountNumber,
          accountName: withdrawal.accountName,
          userEmail: user?.email || '—',
          userFullName: user?.fullName || '—',
          userPhone: user?.phone || '—',
          createdAt: withdrawal.createdAt,
        });
        this.logger.log(`Admin withdrawal alert sent to ${email} (ref ${withdrawal.reference})`);
      } catch (err: any) {
        this.logger.warn(
          `Could not send admin withdrawal alert to ${email}: ${err.message}`,
        );
      }
    }
  }

  /**
   * Approve a withdrawal — flips its status to SUCCESS. The admin is expected
   * to have sent the money out-of-band (via their own bank app) BEFORE
   * clicking Approve.
   *
   * Handles two shapes of records:
   *  - PROCESSING (current flow) — wallet was already debited on submit. Just
   *    flip the WalletTransaction from PROCESSING → SUCCESS and mark the
   *    withdrawal SUCCESS. No wallet touch.
   *  - PENDING (legacy flow, kept for records created before this flow flip)
   *    — do the atomic debit + create a SUCCESS WalletTransaction here.
   */
  async approveWithdrawal(
    withdrawalId: string,
    adminUserId: string,
    note?: string,
  ): Promise<WithdrawalDocument> {
    const withdrawal = await this.withdrawalModel.findById(withdrawalId);
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    const isProcessing = withdrawal.status === WithdrawalStatus.PROCESSING;
    const isLegacyPending = withdrawal.status === WithdrawalStatus.PENDING;
    if (!isProcessing && !isLegacyPending) {
      throw new BadRequestException(
        `Withdrawal is ${withdrawal.status} — only PROCESSING requests can be approved`,
      );
    }

    const amountKobo = withdrawal.amount;

    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      if (isProcessing) {
        // Wallet already debited on submit — just flip the audit transaction
        // from PROCESSING → SUCCESS to reflect that the payout is complete.
        await this.walletTxnModel.updateOne(
          { reference: withdrawal.reference },
          {
            $set: {
              status: TransactionStatus.SUCCESS,
              'meta.approvedBy': adminUserId,
            },
          },
          { session },
        );
      } else {
        // Legacy PENDING record — do the debit now (old admin-approved flow).
        const wallet = await this.walletModel.findById(withdrawal.walletId).session(session);
        if (!wallet) throw new NotFoundException('Wallet not found for this withdrawal');

        const updatedWallet = await this.walletModel.findOneAndUpdate(
          { _id: wallet._id, balance: { $gte: amountKobo } },
          { $inc: { balance: -amountKobo }, $set: { lastTransactionAt: new Date() } },
          { new: true, session },
        );
        if (!updatedWallet) {
          throw new BadRequestException(
            'User no longer has sufficient balance to cover this withdrawal',
          );
        }

        await this.walletTxnModel.create(
          [
            {
              userId: withdrawal.userId,
              walletId: wallet._id,
              type: TransactionType.DEBIT,
              category: TransactionCategory.MANUAL,
              source: TransactionSource.MANUAL_ADJUSTMENT,
              amount: amountKobo,
              currency: 'NGN',
              reference: withdrawal.reference,
              status: TransactionStatus.SUCCESS,
              balanceBefore: wallet.balance,
              balanceAfter: wallet.balance - amountKobo,
              narration: `Withdrawal to ${withdrawal.bankName} - ${withdrawal.accountNumber}`,
              meta: {
                withdrawalType: 'MANUAL_PAYOUT',
                withdrawalId: withdrawal._id,
                bankName: withdrawal.bankName,
                accountNumber: withdrawal.accountNumber,
                accountName: withdrawal.accountName,
                approvedBy: adminUserId,
              },
            },
          ],
          { session },
        );
      }

      withdrawal.status = WithdrawalStatus.SUCCESS;
      withdrawal.processedBy = new Types.ObjectId(adminUserId);
      withdrawal.processedAt = new Date();
      withdrawal.completedAt = new Date();
      withdrawal.walletTransactionReference = withdrawal.reference;
      if (note) withdrawal.adminNote = note;
      await withdrawal.save({ session });

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    this.logger.log(
      `Admin ${adminUserId} approved withdrawal ${withdrawal.reference} — wallet debited ₦${(amountKobo / 100).toLocaleString('en-NG')}`,
    );

    // Notify the user (push + email, best-effort)
    const amountNaira = amountKobo / 100;
    this.notificationsService
      .sendToUser(
        withdrawal.userId.toString(),
        'Withdrawal Sent',
        `Your withdrawal of ₦${amountNaira.toLocaleString('en-NG')} has been sent to your bank account.`,
        {
          type: 'withdrawal_update',
          withdrawalId: withdrawal._id.toString(),
          status: 'SUCCESS',
        },
        'TRANSACTION' as any,
        'withdrawal_update',
      )
      .catch((err) => this.logger.error(`Notification error: ${err.message}`));
    this.userModel
      .findById(withdrawal.userId)
      .select('email')
      .lean()
      .then((user) => {
        if (user?.email) {
          this.emailService
            .sendWithdrawalCompleted(
              user.email,
              amountNaira,
              withdrawal.bankName,
              withdrawal.accountNumber,
              withdrawal.reference,
            )
            .catch((err) => this.logger.error(`Email send failed: ${err.message}`));
        }
      });

    return withdrawal;
  }

  /**
   * Reject a withdrawal — marks the request REJECTED and refunds the wallet
   * if the wallet was already debited on submit (PROCESSING flow). Legacy
   * PENDING records were never debited, so no refund is needed for those.
   * Requires a note so the user gets a real explanation.
   */
  async rejectWithdrawal(
    withdrawalId: string,
    adminUserId: string,
    note: string,
  ): Promise<WithdrawalDocument> {
    if (!note || !note.trim()) {
      throw new BadRequestException('A rejection note is required');
    }
    const withdrawal = await this.withdrawalModel.findById(withdrawalId);
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    const isProcessing = withdrawal.status === WithdrawalStatus.PROCESSING;
    const isLegacyPending = withdrawal.status === WithdrawalStatus.PENDING;
    if (!isProcessing && !isLegacyPending) {
      throw new BadRequestException(
        `Withdrawal is ${withdrawal.status} — only PROCESSING requests can be rejected`,
      );
    }

    if (isProcessing) {
      // Refund the wallet + mark the original debit REVERSED atomically.
      const session = await this.connection.startSession();
      session.startTransaction();
      try {
        const wallet = await this.walletModel.findOneAndUpdate(
          { _id: withdrawal.walletId },
          { $inc: { balance: withdrawal.amount }, $set: { lastTransactionAt: new Date() } },
          { new: true, session },
        );
        if (!wallet) throw new NotFoundException('Wallet not found for refund');

        // Flip the original PROCESSING debit → REVERSED so the user sees why
        // the amount came back.
        await this.walletTxnModel.updateOne(
          { reference: withdrawal.reference },
          {
            $set: {
              status: TransactionStatus.REVERSED,
              'meta.rejectedBy': adminUserId,
              'meta.rejectionReason': note.trim(),
            },
          },
          { session },
        );

        // Add an explicit REFUND credit so the ledger tells the whole story.
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
              reference: generateReference('WDR_REFUND'),
              status: TransactionStatus.SUCCESS,
              balanceBefore: wallet.balance - withdrawal.amount,
              balanceAfter: wallet.balance,
              narration: `Refund: rejected withdrawal ${withdrawal.reference}`,
              meta: {
                originalReference: withdrawal.reference,
                reason: note.trim(),
                rejectedBy: adminUserId,
              },
            },
          ],
          { session },
        );

        withdrawal.status = WithdrawalStatus.REJECTED;
        withdrawal.processedBy = new Types.ObjectId(adminUserId);
        withdrawal.processedAt = new Date();
        withdrawal.adminNote = note.trim();
        withdrawal.failureReason = note.trim();
        await withdrawal.save({ session });

        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        session.endSession();
      }
    } else {
      // Legacy PENDING — nothing was debited, so just mark it.
      withdrawal.status = WithdrawalStatus.REJECTED;
      withdrawal.processedBy = new Types.ObjectId(adminUserId);
      withdrawal.processedAt = new Date();
      withdrawal.adminNote = note.trim();
      withdrawal.failureReason = note.trim();
      await withdrawal.save();
    }

    this.logger.log(
      `Admin ${adminUserId} rejected withdrawal ${withdrawal.reference}: ${note.trim()}`,
    );

    const amountNaira = withdrawal.amount / 100;
    this.notificationsService
      .sendToUser(
        withdrawal.userId.toString(),
        'Withdrawal Rejected',
        `Your withdrawal of ₦${amountNaira.toLocaleString('en-NG')} was rejected. Reason: ${note.trim()}`,
        {
          type: 'withdrawal_update',
          withdrawalId: withdrawal._id.toString(),
          status: 'REJECTED',
        },
        'TRANSACTION' as any,
        'withdrawal_update',
      )
      .catch((err) => this.logger.error(`Notification error: ${err.message}`));

    return withdrawal;
  }

  /**
   * @deprecated Kept only so existing admin controllers that still call
   * markWithdrawal don't 500. Delegates to approve/reject based on status.
   * Remove once the admin controller is switched over.
   */
  async markWithdrawal(
    withdrawalId: string,
    adminUserId: string,
    status: WithdrawalStatus.SUCCESS | WithdrawalStatus.FAILED,
    note?: string,
  ): Promise<WithdrawalDocument> {
    if (status === WithdrawalStatus.SUCCESS) {
      return this.approveWithdrawal(withdrawalId, adminUserId, note);
    }
    return this.rejectWithdrawal(withdrawalId, adminUserId, note || 'Marked failed by admin');
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