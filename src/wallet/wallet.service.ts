/**
 * Wallet Service
 *
 * Handles wallet operations including:
 * - Wallet creation
 * - Balance queries
 * - Credit/Debit operations (atomic)
 * - Transaction history
 */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ConflictException,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Types, ClientSession, Connection } from "mongoose";
import { Wallet, WalletDocument, WalletStatus } from "./schemas/wallet.schema";
import {
  VirtualAccount,
  VirtualAccountDocument,
  VirtualAccountStatus,
} from "./schemas/virtual-account.schema";
import {
  WalletTransaction,
  WalletTransactionDocument,
  TransactionType,
  TransactionCategory,
  TransactionSource,
  TransactionStatus,
} from "./schemas/wallet-transaction.schema";
import { User, UserDocument } from "../users/schemas/user.schema";
import { PaystackService } from "../paystack/paystack.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationType } from "../notifications/schemas/user-notification.schema";
import {
  generateReference,
  paginate,
  calculateSkip,
  toKobo,
  toNaira,
} from "../common/utils/helpers";
import { PaginatedResult } from "../common/dto/pagination.dto";
import {
  InitializeTopupDto,
  TransactionsQueryDto,
  WalletBalanceResponse,
  InitializeTopupResponse,
} from "./dto";

export interface CreditWalletParams {
  userId: string | Types.ObjectId;
  amount: number; // In kobo
  category: TransactionCategory;
  source: TransactionSource;
  narration: string;
  reference?: string;
  relatedId?: Types.ObjectId;
  meta?: Record<string, any>;
  session?: ClientSession;
}

export interface DebitWalletParams {
  userId: string | Types.ObjectId;
  amount: number; // In kobo
  category: TransactionCategory;
  source: TransactionSource;
  narration: string;
  reference?: string;
  relatedId?: Types.ObjectId;
  meta?: Record<string, any>;
  session?: ClientSession;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(WalletTransaction.name)
    private readonly transactionModel: Model<WalletTransactionDocument>,
    @InjectModel(VirtualAccount.name)
    private readonly virtualAccountModel: Model<VirtualAccountDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly paystackService: PaystackService,
    private readonly notificationsService: NotificationsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private _referralService: any = undefined;

  /**
   * Lazily resolve ReferralService to avoid circular dependency
   */
  private getReferralService(): any {
    if (this._referralService !== undefined) return this._referralService;
    try {
      this._referralService = this.moduleRef.get('ReferralService', { strict: false });
    } catch {
      this._referralService = null;
    }
    return this._referralService;
  }

  /**
   * Create a wallet for a user
   */
  async createWallet(
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<WalletDocument> {
    const wallet = new this.walletModel({
      userId: new Types.ObjectId(userId),
      balance: 0,
      currency: "NGN",
      status: WalletStatus.ACTIVE,
    });

    const saved = await wallet.save({ session });
    this.logger.log(`Wallet created for user: ${userId}`);
    return saved;
  }

  /**
   * Get wallet by user ID
   */
  async getWalletByUserId(
    userId: string | Types.ObjectId,
  ): Promise<WalletDocument> {
    const wallet = await this.walletModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();

    if (!wallet) {
      throw new NotFoundException("Wallet not found");
    }

    return wallet;
  }

  /**
   * Get wallet balance with formatted response
   */
  async getBalance(userId: string): Promise<WalletBalanceResponse> {
    const wallet = await this.getWalletByUserId(userId);

    return {
      walletId: wallet._id.toString(),
      balance: wallet.balance,
      currency: wallet.currency,
      status: wallet.status,
      formattedBalance: toNaira(wallet.balance).toFixed(2),
    };
  }

  /**
   * Credit wallet (atomic operation)
   */
  async creditWallet(params: CreditWalletParams): Promise<WalletTransaction> {
    const session = params.session || (await this.connection.startSession());
    const shouldCommit = !params.session;

    if (shouldCommit) {
      session.startTransaction();
    }

    try {
      const wallet = await this.walletModel
        .findOne({ userId: new Types.ObjectId(params.userId) })
        .session(session);

      if (!wallet) {
        throw new NotFoundException("Wallet not found");
      }

      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new BadRequestException("Wallet is not active");
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore + params.amount;

      // Update wallet balance atomically
      const updatedWallet = await this.walletModel.findByIdAndUpdate(
        wallet._id,
        {
          $inc: { balance: params.amount },
          lastTransactionAt: new Date(),
        },
        { new: true, session },
      );

      // Create transaction record
      const reference = params.reference || generateReference("CR");
      const transaction = new this.transactionModel({
        userId: new Types.ObjectId(params.userId),
        walletId: wallet._id,
        type: TransactionType.CREDIT,
        category: params.category,
        source: params.source,
        amount: params.amount,
        currency: wallet.currency,
        reference,
        status: TransactionStatus.SUCCESS,
        balanceBefore,
        balanceAfter,
        narration: params.narration,
        meta: params.meta,
        relatedId: params.relatedId,
      });

      const savedTxn = await transaction.save({ session });

      if (shouldCommit) {
        await session.commitTransaction();
      }

      this.logger.log(
        `Wallet credited: ${params.userId}, amount: ${params.amount}, ref: ${reference}`,
      );

      return savedTxn;
    } catch (error) {
      if (shouldCommit) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (shouldCommit) {
        session.endSession();
      }
    }
  }

  /**
   * Debit wallet (atomic operation)
   */
  async debitWallet(params: DebitWalletParams): Promise<WalletTransaction> {
    const session = params.session || (await this.connection.startSession());
    const shouldCommit = !params.session;

    if (shouldCommit) {
      session.startTransaction();
    }

    try {
      const wallet = await this.walletModel
        .findOne({ userId: new Types.ObjectId(params.userId) })
        .session(session);

      if (!wallet) {
        throw new NotFoundException("Wallet not found");
      }

      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new BadRequestException("Wallet is not active");
      }

      if (wallet.balance < params.amount) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore - params.amount;

      // Update wallet balance atomically with optimistic locking
      const updatedWallet = await this.walletModel.findOneAndUpdate(
        {
          _id: wallet._id,
          balance: { $gte: params.amount }, // Double-check balance
        },
        {
          $inc: { balance: -params.amount },
          lastTransactionAt: new Date(),
        },
        { new: true, session },
      );

      if (!updatedWallet) {
        throw new BadRequestException(
          "Insufficient balance or concurrent modification",
        );
      }

      // Create transaction record
      const reference = params.reference || generateReference("DR");
      const transaction = new this.transactionModel({
        userId: new Types.ObjectId(params.userId),
        walletId: wallet._id,
        type: TransactionType.DEBIT,
        category: params.category,
        source: params.source,
        amount: params.amount,
        currency: wallet.currency,
        reference,
        status: TransactionStatus.SUCCESS,
        balanceBefore,
        balanceAfter,
        narration: params.narration,
        meta: params.meta,
        relatedId: params.relatedId,
      });

      const savedTxn = await transaction.save({ session });

      if (shouldCommit) {
        await session.commitTransaction();
      }

      this.logger.log(
        `Wallet debited: ${params.userId}, amount: ${params.amount}, ref: ${reference}`,
      );

      // Async referral qualification check (non-blocking)
      const referralSvc = this.getReferralService();
      if (referralSvc) {
        referralSvc
          .checkAndQualifyReferral(
            params.userId.toString(),
            params.amount,
            savedTxn._id,
          )
          .catch((err: any) =>
            this.logger.debug(`Referral check skipped: ${err.message}`),
          );
      }

      return savedTxn;
    } catch (error) {
      if (shouldCommit) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (shouldCommit) {
        session.endSession();
      }
    }
  }

  /**
   * Create a pending debit transaction (for operations that may fail)
   */
  async createPendingDebit(params: DebitWalletParams): Promise<{
    transaction: WalletTransaction;
    session: ClientSession;
  }> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const wallet = await this.walletModel
        .findOne({ userId: new Types.ObjectId(params.userId) })
        .session(session);

      if (!wallet) {
        throw new NotFoundException("Wallet not found");
      }

      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new BadRequestException("Wallet is not active");
      }

      if (wallet.balance < params.amount) {
        throw new BadRequestException("Insufficient wallet balance");
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore - params.amount;

      // Debit immediately but mark transaction as PENDING
      await this.walletModel.findOneAndUpdate(
        {
          _id: wallet._id,
          balance: { $gte: params.amount },
        },
        {
          $inc: { balance: -params.amount },
          lastTransactionAt: new Date(),
        },
        { session },
      );

      const reference = params.reference || generateReference("DR");
      const transaction = new this.transactionModel({
        userId: new Types.ObjectId(params.userId),
        walletId: wallet._id,
        type: TransactionType.DEBIT,
        category: params.category,
        source: params.source,
        amount: params.amount,
        currency: wallet.currency,
        reference,
        status: TransactionStatus.PENDING,
        balanceBefore,
        balanceAfter,
        narration: params.narration,
        meta: params.meta,
        relatedId: params.relatedId,
      });

      const savedTxn = await transaction.save({ session });

      // Don't commit yet - caller will commit or abort based on external API result
      return { transaction: savedTxn, session };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  /**
   * Mark pending transaction as successful
   */
  async markTransactionSuccess(
    transactionId: string | Types.ObjectId,
    session: ClientSession,
    meta?: Record<string, any>,
  ): Promise<void> {
    await this.transactionModel.findByIdAndUpdate(
      transactionId,
      {
        status: TransactionStatus.SUCCESS,
        ...(meta ? { $set: { "meta.response": meta } } : {}),
      },
      { session },
    );

    await session.commitTransaction();
    session.endSession();
  }

  /**
   * Refund a failed pending transaction
   */
  async refundPendingTransaction(
    transactionId: string | Types.ObjectId,
    session: ClientSession,
    failureReason?: string,
  ): Promise<void> {
    const transaction = await this.transactionModel
      .findById(transactionId)
      .session(session);

    if (!transaction) {
      throw new NotFoundException("Transaction not found");
    }

    // Refund the wallet
    await this.walletModel.findByIdAndUpdate(
      transaction.walletId,
      {
        $inc: { balance: transaction.amount },
        lastTransactionAt: new Date(),
      },
      { session },
    );

    // Mark transaction as failed
    await this.transactionModel.findByIdAndUpdate(
      transactionId,
      {
        status: TransactionStatus.FAILED,
        $set: { "meta.failureReason": failureReason },
      },
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    this.logger.log(`Transaction refunded: ${transactionId}`);
  }

  /**
   * Get transaction history with pagination
   */
  /**
   * Get transaction history with pagination - DEBUG VERSION
   */
  async getTransactions(
    userId: string,
    query: TransactionsQueryDto,
  ): Promise<PaginatedResult<WalletTransaction>> {
    const { page = 1, limit = 10, type, category, status } = query;

    // ========== DEBUG LOGGING ==========
    this.logger.debug(`[getTransactions] Input userId: "${userId}"`);

    // Check total transactions in DB
    const totalInDb = await this.transactionModel.countDocuments({});
    this.logger.debug(
      `[getTransactions] Total transactions in DB: ${totalInDb}`,
    );

    // Get a sample to see what userId looks like in DB
    const sample = await this.transactionModel.findOne({}).lean();
    if (sample) {
      this.logger.debug(
        `[getTransactions] Sample txn userId: "${sample.userId}"`,
      );
      this.logger.debug(
        `[getTransactions] Sample txn userId type: ${typeof sample.userId}`,
      );
    }
    // ========== END DEBUG ==========

    const filter: any = { userId: new Types.ObjectId(userId) };
    if (type) filter.type = type;
    if (category) filter.category = category;
    if (status) filter.status = status;

    const [transactions, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(calculateSkip(page, limit))
        .limit(limit)
        .lean()
        .exec(),
      this.transactionModel.countDocuments(filter),
    ]);

    // ========== DEBUG LOGGING ==========
    this.logger.debug(`[getTransactions] Filtered count: ${total}`);
    // ========== END DEBUG ==========

    return paginate(transactions, total, page, limit);
  }

  /**
   * Find transaction by reference
   */
  async findTransactionByReference(
    reference: string,
  ): Promise<WalletTransactionDocument | null> {
    return this.transactionModel.findOne({ reference }).exec();
  }

  // =====================
  // Paystack Top-up
  // =====================

  /**
   * Initialize Paystack top-up
   */
  async initializeTopup(
    userId: string,
    email: string,
    dto: InitializeTopupDto,
  ): Promise<InitializeTopupResponse> {
    const reference = generateReference("TOPUP");
    const amountInKobo = toKobo(dto.amount);

    // Initialize Paystack transaction
    const paystackResult = await this.paystackService.initializeTransaction({
      email,
      amount: amountInKobo,
      reference,
      callbackUrl: dto.callbackUrl,
      metadata: {
        userId,
        type: "WALLET_TOPUP",
      },
    });

    // Save transaction record to DB so admin can track all topups
    await this.paystackService.createTransactionRecord({
      userId,
      reference: paystackResult.reference,
      amount: amountInKobo,
      authorizationUrl: paystackResult.authorizationUrl,
      accessCode: paystackResult.accessCode,
      metadata: { type: "WALLET_TOPUP" },
    });

    return {
      authorizationUrl: paystackResult.authorizationUrl,
      accessCode: paystackResult.accessCode,
      reference: paystackResult.reference,
    };
  }

  /**
   * Verify Paystack top-up (called after payment)
   */
  async verifyTopup(
    reference: string,
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Check if already processed
    const existingTxn = await this.findTransactionByReference(reference);
    if (existingTxn && existingTxn.status === TransactionStatus.SUCCESS) {
      return { success: true, message: "Payment already processed" };
    }

    // Verify with Paystack
    const verification =
      await this.paystackService.verifyTransaction(reference);

    if (!verification.success) {
      return { success: false, message: "Payment verification failed" };
    }

    // Credit wallet (idempotent - check reference)
    try {
      await this.creditWallet({
        userId,
        amount: verification.amount,
        category: TransactionCategory.TOPUP,
        source: TransactionSource.PAYSTACK_TOPUP,
        narration: `Wallet top-up via Paystack`,
        reference,
        meta: {
          paystackReference: reference,
          channel: verification.channel,
        },
      });

      return { success: true, message: "Wallet topped up successfully" };
    } catch (error) {
      if (error.code === 11000) {
        // Duplicate reference - already processed
        return { success: true, message: "Payment already processed" };
      }
      throw error;
    }
  }

  async updateTransactionStatus(
    transactionId: string,
    status: "PENDING" | "SUCCESS" | "FAILED",
  ): Promise<WalletTransactionDocument> {
    const transaction = await this.transactionModel.findById(transactionId); // ← FIX HERE

    if (!transaction) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }

    transaction.status = status as TransactionStatus;
    await transaction.save();

    this.logger.debug(
      `Transaction ${transactionId} status updated to ${status}`,
    );

    return transaction;
  }

  // ============================================
  // DEDICATED VIRTUAL ACCOUNTS (DVA)
  // ============================================

  /**
   * Get existing virtual account for a user
   */
  async getVirtualAccount(userId: string): Promise<VirtualAccountDocument | null> {
    return this.virtualAccountModel.findOne({
      userId: new Types.ObjectId(userId),
      status: VirtualAccountStatus.ACTIVE,
    });
  }

  /**
   * Get or create a Dedicated Virtual Account for a user.
   * 1. Check if DVA exists → return it
   * 2. Fetch user details
   * 3. Create Paystack customer (or reuse existing)
   * 4. Create DVA via Paystack
   * 5. Save and return
   */
  async getOrCreateVirtualAccount(userId: string): Promise<VirtualAccountDocument> {
    // Check existing
    const existing = await this.virtualAccountModel.findOne({
      userId: new Types.ObjectId(userId),
    });
    if (existing) return existing;

    // Fetch user
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.email) throw new BadRequestException('User must have an email to create a virtual account');

    // Parse name
    const nameParts = (user.fullName || 'Zinkite User').trim().split(' ');
    const firstName = nameParts[0] || 'Zinkite';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    // Create or fetch Paystack customer
    const customer = await this.paystackService.createCustomer({
      email: user.email,
      firstName,
      lastName,
      phone: user.phone,
    });

    this.logger.log(`Paystack customer for DVA: ${customer.customerCode} (user: ${userId})`);

    // Create DVA
    const dva = await this.paystackService.createDedicatedAccount({
      customerCode: customer.customerCode,
    });

    // Save to DB
    const virtualAccount = new this.virtualAccountModel({
      userId: new Types.ObjectId(userId),
      paystackCustomerCode: customer.customerCode,
      accountName: dva.accountName,
      accountNumber: dva.accountNumber,
      bankName: dva.bankName,
      bankCode: dva.bankCode,
      bankSlug: dva.bankSlug,
      status: VirtualAccountStatus.ACTIVE,
      paystackDvaId: dva.dvaId,
      meta: dva.rawResponse,
    });

    const saved = await virtualAccount.save();
    this.logger.log(`DVA created for user ${userId}: ${dva.accountNumber} (${dva.bankName})`);

    return saved;
  }

  /**
   * Handle incoming DVA transfer (from Paystack webhook).
   * Credits user's wallet based on the transfer amount.
   */
  async handleDvaTransfer(webhookData: Record<string, any>): Promise<void> {
    const reference = webhookData.reference;
    const amount = webhookData.amount; // Already in kobo from Paystack
    const customerCode = webhookData.customer?.customer_code;
    const customerEmail = webhookData.customer?.email;

    this.logger.log(`DVA transfer webhook: ref=${reference}, amount=${amount}, customerCode=${customerCode}, email=${customerEmail}`);
    this.logger.log(`DVA webhook full payload: ${JSON.stringify(webhookData)}`);

    if (!reference || !amount) {
      this.logger.warn('DVA transfer webhook missing reference or amount');
      return;
    }

    // Idempotency: check if this reference was already processed
    const existingTxn = await this.findTransactionByReference(reference);
    if (existingTxn) {
      this.logger.log(`DVA transfer already processed: ${reference}`);
      return;
    }

    // Find the virtual account — try multiple lookup strategies (most reliable first)
    let virtualAccount: VirtualAccountDocument | null = null;

    // Strategy 0: by dedicated_account.account_number (most reliable for DVA webhooks)
    const dvaAccountNumber = webhookData.dedicated_account?.account_number;
    if (dvaAccountNumber) {
      virtualAccount = await this.virtualAccountModel.findOne({
        accountNumber: dvaAccountNumber,
      });
      if (virtualAccount) this.logger.log(`DVA lookup matched by dedicated_account.account_number: ${dvaAccountNumber}`);
    }

    // Strategy 1: by customer code
    if (!virtualAccount && customerCode) {
      virtualAccount = await this.virtualAccountModel.findOne({
        paystackCustomerCode: customerCode,
      });
      if (virtualAccount) this.logger.log(`DVA lookup matched by customerCode: ${customerCode}`);
    }

    // Strategy 2: by receiver account number from authorization
    if (!virtualAccount && webhookData.authorization?.receiver_bank_account_number) {
      virtualAccount = await this.virtualAccountModel.findOne({
        accountNumber: webhookData.authorization.receiver_bank_account_number,
      });
      if (virtualAccount) this.logger.log(`DVA lookup matched by authorization.receiver_bank_account_number`);
    }

    // Strategy 3: by Paystack DVA ID
    if (!virtualAccount && webhookData.dedicated_account?.id) {
      virtualAccount = await this.virtualAccountModel.findOne({
        paystackDvaId: webhookData.dedicated_account.id,
      });
      if (virtualAccount) this.logger.log(`DVA lookup matched by dedicated_account.id: ${webhookData.dedicated_account.id}`);
    }

    // Strategy 4: by receiver account number from metadata
    if (!virtualAccount && webhookData.metadata?.receiver_account_number) {
      virtualAccount = await this.virtualAccountModel.findOne({
        accountNumber: webhookData.metadata.receiver_account_number,
      });
      if (virtualAccount) this.logger.log(`DVA lookup matched by metadata.receiver_account_number`);
    }

    // Strategy 5: by customer email → user → virtual account
    if (!virtualAccount && customerEmail) {
      const user = await this.userModel.findOne({ email: customerEmail }).select('_id').lean();
      if (user) {
        virtualAccount = await this.virtualAccountModel.findOne({
          userId: (user as any)._id,
        });
        if (virtualAccount) this.logger.log(`DVA lookup matched by customer email: ${customerEmail}`);
      }
    }

    if (!virtualAccount) {
      this.logger.error(
        `DVA transfer FAILED: No virtual account found. ref=${reference}, amount=${amount}, customerCode=${customerCode}, email=${customerEmail}. ` +
        `Webhook keys: ${JSON.stringify(Object.keys(webhookData))}`,
      );
      return;
    }

    const userId = virtualAccount.userId.toString();

    // Credit the wallet
    await this.creditWallet({
      userId,
      amount,
      category: TransactionCategory.TOPUP,
      source: TransactionSource.DVA_TRANSFER,
      narration: `Wallet top-up via bank transfer`,
      reference,
      meta: {
        paystackReference: reference,
        channel: 'dedicated_nuban',
        customerCode,
        accountNumber: virtualAccount.accountNumber,
        bankName: virtualAccount.bankName,
      },
    });

    this.logger.log(`DVA transfer credited: user=${userId}, amount=₦${toNaira(amount)}, ref=${reference}`);

    // Send notification
    this.notificationsService.sendToUser(
      userId,
      'Wallet Funded',
      `Your wallet has been credited with ₦${toNaira(amount).toLocaleString('en-NG')}.`,
      { type: 'wallet_topup', reference },
      NotificationType.TRANSACTION,
      'wallet_topup',
    ).catch((err) => this.logger.error('Failed to send DVA notification:', err.message));
  }
}
