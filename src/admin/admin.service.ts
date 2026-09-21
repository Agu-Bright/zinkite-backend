/**
 * Admin Service
 * Handles admin-specific business logic
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Connection, Types } from "mongoose";
import { User, UserDocument, UserStatus } from "../users/schemas/user.schema";
import { Wallet, WalletDocument } from "../wallet/schemas/wallet.schema";
import {
  WalletTransaction,
  WalletTransactionDocument,
  TransactionCategory,
  TransactionSource,
} from "../wallet/schemas/wallet-transaction.schema";
import {
  GiftCardTrade,
  GiftCardTradeDocument,
  TradeStatus,
  TradeType,
} from "../giftcards/schemas/gift-card-trade.schema";
import {
  PaystackTransaction,
  PaystackTransactionDocument,
} from "../paystack/schemas/paystack-transaction.schema";
import {
  KorapayTransaction,
  KorapayTransactionDocument,
} from "../korapay/schemas/korapay-transaction.schema";
import { Withdrawal, WithdrawalDocument } from "../wallet/schemas/withdrawal.schema";
import { BankAccount, BankAccountDocument } from "../wallet/schemas/bank-account.schema";
import {
  WalletCreditRequest,
  WalletCreditRequestDocument,
  CreditRequestStatus,
} from "./schemas/wallet-credit-request.schema";
import { WalletService } from "../wallet/wallet.service";
import { WithdrawalService } from "../wallet/withdrawal.service";
import { WithdrawalStatus } from "../wallet/schemas/withdrawal.schema";
import { GiftCardsService } from "../giftcards/giftcards.service";
import {
  ManualWalletAdjustmentDto,
  AdjustmentType,
  UsersQueryDto,
  UserStatusFilter,
  UpdateUserStatusDto,
  PaystackQueryDto,
  WithdrawalsQueryDto,
  CreditRequestsQueryDto,
  CreateCreditRequestDto,
  DenyCreditRequestDto,
  SendNotificationDto,
  NotificationRecipients,
  NotificationsQueryDto,
  DeleteTransactionDto,
} from "./dto";
import { NotificationLog, NotificationLogDocument } from "./schemas/notification-log.schema";
import { BlockedIp, BlockedIpDocument } from "./schemas/blocked-ip.schema";
import {
  VtuTransaction,
  VtuTransactionDocument,
  VtuProductType,
} from "../vtu/schemas/vtu-transaction.schema";
import {
  GiftCardBuyOrder,
  GiftCardBuyOrderDocument,
} from "../giftcard-buy/schemas/giftcard-buy-order.schema";
import {
  GiftCardShopPurchase,
  GiftCardShopPurchaseDocument,
} from "../giftcard-shop/schemas/giftcard-shop-purchase.schema";
import { normalizeIpAddress } from "../common/utils/client-ip";
import { EmailService } from "../email/email.service";
import { TransactionsQueryDto } from "../wallet/dto";
import {
  generateReference,
  paginate,
  calculateSkip,
  toKobo,
  toNaira,
} from "../common/utils/helpers";
import { PaginatedResult } from "../common/dto/pagination.dto";
import { ReviewTradeDto, TradeQueryDto, MakeOfferDto } from "../giftcards/dto";
import { NotificationsService } from "../notifications/notifications.service";
import { AuditService } from "../audit/audit.service";
import {
  AuditAction,
  AuditResource,
} from "../audit/schemas/audit-log.schema";

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(WalletTransaction.name)
    private readonly walletTransactionModel: Model<WalletTransactionDocument>,
    @InjectModel(GiftCardTrade.name)
    private readonly tradeModel: Model<GiftCardTradeDocument>,
    @InjectModel(PaystackTransaction.name)
    private readonly paystackModel: Model<PaystackTransactionDocument>,
    @InjectModel(KorapayTransaction.name)
    private readonly korapayModel: Model<KorapayTransactionDocument>,
    @InjectModel(Withdrawal.name)
    private readonly withdrawalModel: Model<WithdrawalDocument>,
    @InjectModel(BankAccount.name)
    private readonly bankAccountModel: Model<BankAccountDocument>,
    @InjectModel(WalletCreditRequest.name)
    private readonly creditRequestModel: Model<WalletCreditRequestDocument>,
    @InjectModel(NotificationLog.name)
    private readonly notificationLogModel: Model<NotificationLogDocument>,
    @InjectModel(BlockedIp.name)
    private readonly blockedIpModel: Model<BlockedIpDocument>,
    @InjectModel(VtuTransaction.name)
    private readonly vtuTransactionModel: Model<VtuTransactionDocument>,
    @InjectModel(GiftCardBuyOrder.name)
    private readonly giftCardBuyOrderModel: Model<GiftCardBuyOrderDocument>,
    @InjectModel(GiftCardShopPurchase.name)
    private readonly giftCardShopPurchaseModel: Model<GiftCardShopPurchaseDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly walletService: WalletService,
    private readonly withdrawalService: WithdrawalService,
    private readonly giftCardsService: GiftCardsService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Approve a PENDING withdrawal — thin delegate so the notification/wallet
   * atomicity stays in WithdrawalService.
   */
  async approveWithdrawal(
    withdrawalId: string,
    adminUserId: string,
    note?: string,
  ) {
    const w = await this.withdrawalService.approveWithdrawal(
      withdrawalId,
      adminUserId,
      note,
    );
    return w.toJSON();
  }

  /**
   * Reject a PENDING withdrawal — note is required.
   */
  async rejectWithdrawal(
    withdrawalId: string,
    adminUserId: string,
    note: string,
  ) {
    const w = await this.withdrawalService.rejectWithdrawal(
      withdrawalId,
      adminUserId,
      note,
    );
    return w.toJSON();
  }

  /**
   * @deprecated Kept for the older PATCH /withdrawals/:id/status route.
   * New callers should use approveWithdrawal / rejectWithdrawal.
   */
  async markWithdrawal(
    withdrawalId: string,
    adminUserId: string,
    status: "SUCCESS" | "FAILED",
    note?: string,
  ) {
    if (status !== "SUCCESS" && status !== "FAILED") {
      throw new BadRequestException("status must be SUCCESS or FAILED");
    }
    const w = await this.withdrawalService.markWithdrawal(
      withdrawalId,
      adminUserId,
      status === "SUCCESS"
        ? WithdrawalStatus.SUCCESS
        : WithdrawalStatus.FAILED,
      note,
    );
    return w.toJSON();
  }

  // ============================================
  // DASHBOARD & STATS
  // ============================================

  /**
   * Get admin dashboard statistics
   */
  async getDashboardStats(): Promise<any> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // User stats
    const totalUsers = await this.userModel.countDocuments({
      isDeleted: false,
    });
    const activeUsers = await this.userModel.countDocuments({
      isDeleted: false,
      status: UserStatus.ACTIVE,
    });
    const newUsersToday = await this.userModel.countDocuments({
      createdAt: { $gte: today },
    });

    // Wallet stats
    const walletAgg = await this.walletModel.aggregate([
      { $group: { _id: null, totalBalance: { $sum: "$balance" } } },
    ]);
    const totalWalletBalance = walletAgg[0]?.totalBalance || 0;

    // Trade stats
    const totalTrades = await this.tradeModel.countDocuments();
    const pendingTrades = await this.tradeModel.countDocuments({
      status: TradeStatus.PENDING,
    });
    const tradesToday = await this.tradeModel.countDocuments({
      createdAt: { $gte: today },
    });
    const tradeBreakdownRows = await this.tradeModel.aggregate([
      {
        $addFields: {
          normalizedTradeType: { $ifNull: ["$tradeType", TradeType.STANDARD] },
        },
      },
      {
        $group: {
          _id: "$normalizedTradeType",
          total: { $sum: 1 },
          pending: {
            $sum: {
              $cond: [{ $eq: ["$status", TradeStatus.PENDING] }, 1, 0],
            },
          },
          successful: {
            $sum: {
              $cond: [{ $eq: ["$status", TradeStatus.APPROVED] }, 1, 0],
            },
          },
          successfulToday: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", TradeStatus.APPROVED] },
                    { $gte: ["$reviewedAt", today] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          successfulValueKobo: {
            $sum: {
              $cond: [
                { $eq: ["$status", TradeStatus.APPROVED] },
                { $ifNull: ["$amountNgn", 0] },
                0,
              ],
            },
          },
        },
      },
    ]);
    const tradeStats = (type: TradeType) => {
      const row = tradeBreakdownRows.find((item) => item._id === type);
      return {
        total: row?.total || 0,
        pending: row?.pending || 0,
        successful: row?.successful || 0,
        successfulToday: row?.successfulToday || 0,
        successfulValueNaira: toNaira(row?.successfulValueKobo || 0),
      };
    };

    // Paystack topups
    const totalTopups = await this.paystackModel.countDocuments({
      status: "SUCCESS",
    });

    // Revenue (approved trades)
    const tradeRevenueAgg = await this.tradeModel.aggregate([
      {
        $match: {
          status: TradeStatus.APPROVED,
          reviewedAt: { $gte: today },
        },
      },
      { $group: { _id: null, total: { $sum: "$amountNgn" } } },
    ]);

    // ── Withdrawal stats ──────────────────────────────────
    // Anything still awaiting the admin to actually send the money.
    // PROCESSING is the current flow (debit-on-submit). PENDING is legacy
    // from the earlier admin-approved flow — kept in the "awaiting" bucket
    // so old records are surfaced too.
    const [
      pendingWithdrawalsCount,
      pendingWithdrawalsSumAgg,
      withdrawalsToday,
      totalWithdrawals,
    ] = await Promise.all([
      this.withdrawalModel.countDocuments({
        status: {
          $in: [WithdrawalStatus.PROCESSING, WithdrawalStatus.PENDING],
        },
      }),
      this.withdrawalModel.aggregate([
        {
          $match: {
            status: {
              $in: [WithdrawalStatus.PROCESSING, WithdrawalStatus.PENDING],
            },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      this.withdrawalModel.countDocuments({ createdAt: { $gte: today } }),
      this.withdrawalModel.countDocuments(),
    ]);
    const pendingWithdrawalsAmountKobo: number =
      pendingWithdrawalsSumAgg[0]?.total ?? 0;

    return {
      totalUsers,
      activeUsers,
      newUsersToday,
      totalWalletBalance: toNaira(totalWalletBalance),
      totalTrades,
      pendingTrades,
      tradesToday,
      totalTopups,
      revenueToday: toNaira(tradeRevenueAgg[0]?.total || 0),
      tradeBreakdown: {
        standard: tradeStats(TradeType.STANDARD),
        lostDigits: tradeStats(TradeType.LOST_DIGITS),
      },
      withdrawals: {
        pending: pendingWithdrawalsCount,
        pendingAmountNaira: toNaira(pendingWithdrawalsAmountKobo),
        today: withdrawalsToday,
        total: totalWithdrawals,
      },
    };
  }

  /**
   * Get recent activity for dashboard
   */
  async getDashboardRecent(): Promise<any> {
    const [recentTrades, recentTransactions] = await Promise.all([
      this.tradeModel
        .find()
        .populate("userId", "email phone fullName")
        .populate("brandId", "name logo")
        .populate("categoryId", "name currency")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      this.walletTransactionModel
        .find({ isDeleted: { $ne: true } })
        .populate("userId", "email phone fullName")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    return {
      recentTrades: recentTrades.map((trade) => ({
        ...trade,
        amountNaira: toNaira(trade.amountNgn || 0),
      })),
      recentTransactions: recentTransactions.map((txn) => ({
        ...txn,
        amountNaira: toNaira(txn.amount || 0),
      })),
    };
  }

  // ============================================
  // USER MANAGEMENT
  // ============================================

  /**
   * Get all users with filters
   */
  async getUsers(query: UsersQueryDto): Promise<PaginatedResult<User>> {
    const filter: any = {
      isDeleted: query.status === UserStatusFilter.DELETED,
    };

    if (query.status && query.status !== UserStatusFilter.DELETED) {
      filter.status = query.status;
    }

    if (query.isEmailVerified !== undefined) {
      filter.isEmailVerified = query.isEmailVerified;
    }

    if (query.hasPinSet !== undefined) {
      if (query.hasPinSet) {
        filter.transactionPinHash = { $ne: null };
      } else {
        filter.transactionPinHash = null;
      }
    }

    if (query.hasWalletFunds) {
      const fundedUserIds = await this.walletModel.distinct('userId', {
        balance: { $gt: 0 },
      });
      filter._id = { $in: fundedUserIds };
    }

    if (query.search) {
      filter.$or = [
        { email: { $regex: query.search, $options: "i" } },
        { phone: { $regex: query.search, $options: "i" } },
        { fullName: { $regex: query.search, $options: "i" } },
      ];
    }

    const total = await this.userModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const users = await this.userModel
      .find(filter)
      .select("-passwordHash -transactionPinHash")
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit)
      .lean();

    // Batch-fetch wallets for every user on this page so the admin table can
    // show balance alongside each row without an N+1 lookup.
    const userIds = users.map((u) => u._id);
    const wallets = await this.walletModel
      .find({ userId: { $in: userIds } })
      .select("userId balance")
      .lean();
    const balanceByUser = new Map<string, number>();
    for (const w of wallets) {
      balanceByUser.set(String(w.userId), toNaira(w.balance));
    }

    const enriched = users.map((u) => ({
      ...u,
      walletBalanceNaira: balanceByUser.get(String(u._id)) ?? 0,
    }));

    return paginate(enriched as any, total, page, limit);
  }

  private getUnverifiedCleanupFilter(olderThanDays?: number) {
    const cutoff = olderThanDays === undefined
      ? null
      : new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    return {
      cutoff,
      filter: {
        isEmailVerified: false,
        isDeleted: false,
        ...(cutoff ? { createdAt: { $lte: cutoff } } : {}),
      },
    };
  }

  private async getUnverifiedPurgeCandidates(olderThanDays?: number) {
    const { filter, cutoff } = this.getUnverifiedCleanupFilter(olderThanDays);
    const candidates = await this.userModel.find(filter).select('_id').lean();
    const candidateIds = candidates.map((user) => user._id);
    if (candidateIds.length === 0) return { cutoff, candidateIds, eligibleIds: [] as Types.ObjectId[] };

    const [fundedWallets, transactions, trades, withdrawals, paystack, korapay, referring, referred] =
      await Promise.all([
        this.walletModel.distinct('userId', { userId: { $in: candidateIds }, balance: { $ne: 0 } }),
        this.walletTransactionModel.distinct('userId', { userId: { $in: candidateIds } }),
        this.tradeModel.distinct('userId', { userId: { $in: candidateIds } }),
        this.withdrawalModel.distinct('userId', { userId: { $in: candidateIds } }),
        this.paystackModel.distinct('userId', { userId: { $in: candidateIds } }),
        this.korapayModel.distinct('userId', { userId: { $in: candidateIds } }),
        this.connection.collection('referrals').distinct('referrerId', { referrerId: { $in: candidateIds } }),
        this.connection.collection('referrals').distinct('referredUserId', { referredUserId: { $in: candidateIds } }),
      ]);

    const protectedIds = new Set(
      [...fundedWallets, ...transactions, ...trades, ...withdrawals, ...paystack, ...korapay, ...referring, ...referred]
        .map((id) => String(id)),
    );
    const eligibleIds = candidateIds.filter((id) => !protectedIds.has(String(id)));
    return { cutoff, candidateIds, eligibleIds };
  }

  async previewUnverifiedAccountCleanup(olderThanDays?: number) {
    const { cutoff, candidateIds, eligibleIds } = await this.getUnverifiedPurgeCandidates(olderThanDays);
    return {
      olderThanDays,
      all: olderThanDays === undefined,
      cutoff,
      eligibleCount: eligibleIds.length,
      protectedCount: candidateIds.length - eligibleIds.length,
    };
  }

  async cleanupUnverifiedAccounts(adminId: string, olderThanDays?: number) {
    const { cutoff, eligibleIds } = await this.getUnverifiedPurgeCandidates(olderThanDays);
    if (eligibleIds.length === 0) {
      return {
        message: 'No eligible unverified accounts found',
        olderThanDays,
        all: olderThanDays === undefined,
        cutoff,
        deletedCount: 0,
      };
    }

    const session = await this.connection.startSession();
    let deletedCount = 0;
    try {
      await session.withTransaction(async () => {
        await Promise.all([
          this.walletModel.deleteMany({ userId: { $in: eligibleIds }, balance: 0 }).session(session),
          this.connection.collection('otps').deleteMany({ userId: { $in: eligibleIds } }, { session }),
          this.connection.collection('auth_provider_accounts').deleteMany({ userId: { $in: eligibleIds } }, { session }),
          this.connection.collection('referrals').deleteMany({ referredUserId: { $in: eligibleIds } }, { session }),
        ]);
        const result = await this.userModel.deleteMany({
          _id: { $in: eligibleIds },
          isEmailVerified: false,
          isDeleted: false,
          ...(cutoff ? { createdAt: { $lte: cutoff } } : {}),
        }).session(session);
        deletedCount = result.deletedCount;
      });
    } finally {
      await session.endSession();
    }

    await this.auditService.logAdminAction(
      adminId,
      AuditAction.ADMIN_UNVERIFIED_USERS_PERMANENTLY_DELETED,
      AuditResource.USER,
      'unverified-user-cleanup',
      olderThanDays === undefined
        ? `Permanently deleted ${deletedCount} eligible unverified account(s) of any age`
        : `Permanently deleted ${deletedCount} unverified account(s) older than ${olderThanDays} day(s)`,
      {
        meta: { olderThanDays, all: olderThanDays === undefined, cutoff, deletedCount },
      },
    );

    return {
      message: `${deletedCount} unverified account(s) permanently deleted`,
      olderThanDays,
      all: olderThanDays === undefined,
      cutoff,
      deletedCount,
    };
  }

  async listBlockedIpAddresses() {
    return this.blockedIpModel.find({ isActive: true }).sort({ createdAt: -1 }).lean();
  }

  async blockIpAddress(adminId: string, rawIpAddress: string, reason: string, adminIpAddress: string) {
    const ipAddress = normalizeIpAddress(rawIpAddress);
    if (!ipAddress) throw new BadRequestException('A valid IPv4 or IPv6 address is required');
    if (ipAddress === normalizeIpAddress(adminIpAddress)) {
      throw new BadRequestException('You cannot block the IP address used by your current admin session');
    }

    const blocked = await this.blockedIpModel.findOneAndUpdate(
      { ipAddress },
      { $set: { reason, blockedBy: new Types.ObjectId(adminId), isActive: true, unblockedAt: null, unblockedBy: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await this.auditService.logAdminAction(
      adminId,
      AuditAction.ADMIN_IP_BLOCKED,
      AuditResource.USER,
      ipAddress,
      `Blocked app access from IP ${ipAddress}`,
      { meta: { ipAddress, reason } },
    );
    return blocked;
  }

  async unblockIpAddress(adminId: string, rawIpAddress: string) {
    const ipAddress = normalizeIpAddress(rawIpAddress);
    if (!ipAddress) throw new BadRequestException('A valid IPv4 or IPv6 address is required');

    const blocked = await this.blockedIpModel.findOneAndUpdate(
      { ipAddress, isActive: true },
      { $set: { isActive: false, unblockedAt: new Date(), unblockedBy: new Types.ObjectId(adminId) } },
      { new: true },
    );
    if (!blocked) throw new NotFoundException('Active IP block not found');

    await this.auditService.logAdminAction(
      adminId,
      AuditAction.ADMIN_IP_UNBLOCKED,
      AuditResource.USER,
      ipAddress,
      `Unblocked app access from IP ${ipAddress}`,
      { meta: { ipAddress } },
    );
    return blocked;
  }

  /**
   * Get user details by ID
   */
  async getUserById(userId: string): Promise<any> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException("Invalid user ID");
    }
    const objectUserId = new Types.ObjectId(userId);
    const user = await this.userModel
      // Explicit isDeleted condition bypasses the schema's normal soft-delete
      // scope for this authorized admin investigation endpoint.
      .findOne({
        _id: objectUserId,
        isDeleted: { $in: [true, false] },
      })
      .select("-passwordHash -transactionPinHash");

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Get wallet info
    const wallet = await this.walletModel.findOne({
      userId: objectUserId,
    });

    // Get recent transactions
    const recentTransactions = await this.walletTransactionModel
      .find({
        userId: objectUserId,
        isDeleted: { $ne: true },
      })
      .sort({ createdAt: -1 })
      .limit(10);

    const summarize = async (
      model: Model<any>,
      match: Record<string, any>,
      amountField: string,
      successStatuses: string[],
      failedStatuses: string[],
    ) => {
      const [summary] = await model.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalAmountKobo: { $sum: { $ifNull: [`$${amountField}`, 0] } },
            successful: { $sum: { $cond: [{ $in: ["$status", successStatuses] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $in: ["$status", failedStatuses] }, 1, 0] } },
            pending: {
              $sum: {
                $cond: [
                  { $not: [{ $in: ["$status", [...successStatuses, ...failedStatuses]] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]);
      const totalAmountKobo = summary?.totalAmountKobo ?? 0;
      return {
        count: summary?.count ?? 0,
        totalAmountKobo,
        totalAmountNaira: toNaira(totalAmountKobo),
        successful: summary?.successful ?? 0,
        failed: summary?.failed ?? 0,
        pending: summary?.pending ?? 0,
      };
    };

    const [
      topups,
      withdrawals,
      airtime,
      data,
      electricity,
      tv,
      giftCardPurchases,
      giftCardShop,
      giftCardTrades,
    ] = await Promise.all([
      summarize(
        this.walletTransactionModel,
        { userId: objectUserId, category: TransactionCategory.TOPUP, isDeleted: { $ne: true } },
        "amount",
        ["SUCCESS"],
        ["FAILED", "REVERSED"],
      ),
      summarize(this.withdrawalModel, { userId: objectUserId }, "amount", ["SUCCESS"], ["FAILED", "REJECTED", "REVERSED"]),
      summarize(this.vtuTransactionModel, { userId: objectUserId, type: VtuProductType.AIRTIME }, "amount", ["SUCCESS"], ["FAILED", "REFUNDED"]),
      summarize(this.vtuTransactionModel, { userId: objectUserId, type: VtuProductType.DATA }, "amount", ["SUCCESS"], ["FAILED", "REFUNDED"]),
      summarize(this.vtuTransactionModel, { userId: objectUserId, type: VtuProductType.ELECTRICITY }, "amount", ["SUCCESS"], ["FAILED", "REFUNDED"]),
      summarize(this.vtuTransactionModel, { userId: objectUserId, type: VtuProductType.TV }, "amount", ["SUCCESS"], ["FAILED", "REFUNDED"]),
      summarize(this.giftCardBuyOrderModel, { userId: objectUserId }, "totalChargedNgn", ["SUCCESS"], ["FAILED", "REFUNDED"]),
      summarize(this.giftCardShopPurchaseModel, { userId: objectUserId }, "amountChargedNgn", ["SUCCESS"], ["FAILED", "REFUNDED"]),
      summarize(this.tradeModel, { userId: objectUserId }, "amountNgn", [TradeStatus.APPROVED], [TradeStatus.REJECTED, TradeStatus.CANCELLED]),
    ]);

    // Bank accounts — surface them here so the admin can look up
    // where a user's withdrawal should go from a single detail view.
    const bankAccounts = await this.bankAccountModel
      .find({ userId: objectUserId })
      .lean();

    return {
      user,
      wallet: wallet
        ? {
            balance: toNaira(wallet.balance),
            status: wallet.status,
            lastTransactionAt: wallet.lastTransactionAt,
          }
        : null,
      bankAccounts,
      recentTransactions: recentTransactions.map((t) => ({
        ...t.toObject(),
        amountNaira: toNaira(t.amount),
      })),
      stats: {
        tradeCount: giftCardTrades.count,
        topupCount: topups.count,
        totalTopupAmount: topups.totalAmountNaira,
      },
      activityMetrics: {
        topups,
        withdrawals,
        airtime,
        data,
        electricity,
        tv,
        giftCardPurchases,
        giftCardShop,
        giftCardTrades,
      },
    };
  }

  async getUserActivity(
    userId: string,
    category: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<any>> {
    if (!Types.ObjectId.isValid(userId)) throw new BadRequestException("Invalid user ID");
    const userObjectId = new Types.ObjectId(userId);
    const skip = calculateSkip(page, limit);

    let model: Model<any>;
    let filter: Record<string, any> = { userId: userObjectId };
    let amountField = "amount";
    let populate: { path: string; select: string }[] = [];

    switch (category) {
      case "transactions":
        model = this.walletTransactionModel;
        filter.isDeleted = { $ne: true };
        break;
      case "topups":
        model = this.walletTransactionModel;
        filter = { ...filter, category: TransactionCategory.TOPUP, isDeleted: { $ne: true } };
        break;
      case "withdrawals":
        model = this.withdrawalModel;
        break;
      case "airtime":
      case "data":
      case "electricity":
      case "tv":
        model = this.vtuTransactionModel;
        filter.type = category.toUpperCase();
        break;
      case "giftcard-purchases":
        model = this.giftCardBuyOrderModel;
        amountField = "totalChargedNgn";
        break;
      case "giftcard-shop":
        model = this.giftCardShopPurchaseModel;
        amountField = "amountChargedNgn";
        break;
      case "giftcard-trades":
        model = this.tradeModel;
        amountField = "amountNgn";
        populate = [
          { path: "brandId", select: "name logoUrl" },
          { path: "categoryId", select: "name currency" },
        ];
        break;
      default:
        throw new BadRequestException("Unsupported activity category");
    }

    const [total, documents] = await Promise.all([
      model.countDocuments(filter),
      model.find(filter).populate(populate).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const data = documents.map((document: Record<string, any>) => ({
      ...document,
      activityCategory: category,
      amountNaira: toNaira(document[amountField] ?? 0),
    }));

    return paginate(data, total, page, limit);
  }

  /**
   * Update user status (suspend/reactivate)
   */
  async updateUserStatus(
    userId: string,
    adminId: string,
    dto: UpdateUserStatusDto,
  ): Promise<User> {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const previousStatus = user.status;
    user.status = dto.status as UserStatus;
    await user.save();

    this.logger.log(
      `User ${userId} status changed to ${dto.status} by admin ${adminId}. Reason: ${dto.reason}`,
    );

    // Notify the user about status change
    const statusLabel = dto.status.toLowerCase();
    this.notificationsService.sendToUser(
      userId,
      'Account Status Updated',
      `Your account has been ${statusLabel}. ${dto.reason ? `Reason: ${dto.reason}` : ''}`.trim(),
      { type: 'account_status', status: dto.status, previousStatus },
      'SECURITY' as any,
      'account_status',
    ).catch((err) => this.logger.error(`Failed to notify user status change: ${err.message}`));

    return user;
  }

  // ============================================
  // WALLET MANAGEMENT
  // ============================================

  /**
   * Get all wallet transactions with filters (admin view - no userId required)
   */
  async getAllWalletTransactions(
    query: TransactionsQueryDto,
  ): Promise<PaginatedResult<WalletTransaction>> {
    const filter: any = { isDeleted: { $ne: true } };

    if (query.type) {
      filter.type = query.type;
    }

    if (query.category) {
      filter.category = query.category;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    if (query.search) {
      filter.$or = [
        { reference: { $regex: query.search, $options: "i" } },
        { narration: { $regex: query.search, $options: "i" } },
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.walletTransactionModel.countDocuments(filter);
    const transactions = await this.walletTransactionModel
      .find(filter)
      .populate("userId", "email phone fullName")
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    // Map transactions with Naira conversions
    const mappedTransactions = transactions.map((t) => ({
      ...t.toObject(),
      amountNaira: toNaira(t.amount),
      balanceBeforeNaira: toNaira(t.balanceBefore ?? 0),
      balanceAfterNaira: toNaira(t.balanceAfter ?? 0),
    }));

    return paginate(mappedTransactions, total, page, limit);
  }
  /**
   * Get wallet transactions for a specific user (admin view)
   */
  async getUserWalletTransactions(
    userId: string,
    query: TransactionsQueryDto,
  ): Promise<PaginatedResult<WalletTransaction>> {
    const filter: any = {
      userId: new Types.ObjectId(userId),
      isDeleted: { $ne: true },
    };

    if (query.type) {
      filter.type = query.type;
    }

    if (query.category) {
      filter.category = query.category;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.walletTransactionModel.countDocuments(filter);
    const transactions = await this.walletTransactionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    const mappedTransactions = transactions.map((t) => ({
      ...t.toObject(),
      amountNaira: toNaira(t.amount),
    }));

    return paginate(mappedTransactions, total, page, limit);
  }

  /**
   * Get single wallet transaction by ID
   */
  async getWalletTransactionById(id: string): Promise<any> {
    const transaction = await this.walletTransactionModel
      .findOne({ _id: id, isDeleted: { $ne: true } })
      .populate("userId", "email phone fullName");

    if (!transaction) {
      throw new NotFoundException("Wallet transaction not found");
    }

    return {
      ...transaction.toObject(),
      amountNaira: toNaira(transaction.amount),
      balanceBeforeNaira: toNaira(transaction.balanceBefore ?? 0),
      balanceAfterNaira: toNaira(transaction.balanceAfter ?? 0),
    };
  }

  /**
   * Remove a transaction from operational histories without mutating the
   * wallet balance or destroying the underlying ledger/audit evidence.
   */
  async deleteWalletTransaction(
    id: string,
    adminId: string,
    dto: DeleteTransactionDto,
  ): Promise<{ deleted: true; id: string }> {
    const transaction = await this.walletTransactionModel.findOne({
      _id: id,
      isDeleted: { $ne: true },
    });

    if (!transaction) {
      throw new NotFoundException("Wallet transaction not found");
    }

    transaction.isDeleted = true;
    transaction.deletedAt = new Date();
    transaction.deletedBy = new Types.ObjectId(adminId);
    transaction.deletionReason = dto.reason.trim();
    await transaction.save();

    await this.auditService.logAdminAction(
      adminId,
      AuditAction.ADMIN_TRANSACTION_DELETED,
      AuditResource.TRANSACTION,
      id,
      `Transaction ${transaction.reference} removed from transaction history`,
      {
        userId: String(transaction.userId),
        previousValues: {
          isDeleted: false,
          reference: transaction.reference,
          amount: transaction.amount,
          type: transaction.type,
          category: transaction.category,
          status: transaction.status,
        },
        newValues: {
          isDeleted: true,
          deletedAt: transaction.deletedAt,
          deletionReason: transaction.deletionReason,
        },
      },
    );

    return { deleted: true, id };
  }

  /**
   * Manual wallet adjustment (credit/debit)
   */
  async manualWalletAdjustment(
    adminId: string,
    dto: ManualWalletAdjustmentDto,
  ): Promise<WalletTransaction> {
    const user = await this.userModel.findById(dto.userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const reference = dto.internalReference || generateReference("ADJ");
    const amountKobo = toKobo(dto.amount);

    let transaction: WalletTransaction;

    if (dto.type === AdjustmentType.CREDIT) {
      transaction = await this.walletService.creditWallet({
        userId: dto.userId,
        amount: amountKobo,
        category: TransactionCategory.MANUAL,
        source: TransactionSource.MANUAL_ADJUSTMENT,
        reference,
        narration: `Admin adjustment: ${dto.reason}`,
        meta: {
          adminId,
          adjustmentType: "CREDIT",
          reason: dto.reason,
        },
      });
    } else {
      transaction = await this.walletService.debitWallet({
        userId: dto.userId,
        amount: amountKobo,
        category: TransactionCategory.MANUAL,
        source: TransactionSource.MANUAL_ADJUSTMENT,
        reference,
        narration: `Admin adjustment: ${dto.reason}`,
        meta: {
          adminId,
          adjustmentType: "DEBIT",
          reason: dto.reason,
        },
      });
    }

    this.logger.log(
      `Admin ${adminId} made ${dto.type} adjustment of NGN ${dto.amount} for user ${dto.userId}. Reason: ${dto.reason}`,
    );

    const amountNaira = dto.amount.toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const isCredit = dto.type === AdjustmentType.CREDIT;
    this.notificationsService
      .sendToUser(
        dto.userId,
        isCredit ? 'Wallet Credited' : 'Wallet Debited',
        isCredit
          ? `Your wallet has been credited with ₦${amountNaira}. Reason: ${dto.reason}`
          : `Your wallet has been debited of ₦${amountNaira}. Reason: ${dto.reason}`,
        { type: 'wallet_adjustment', reference, adjustmentType: dto.type },
        'WALLET' as any,
        isCredit ? 'wallet_credit' : 'wallet_debit',
      )
      .catch((err) =>
        this.logger.error(`Failed to send wallet adjustment notification: ${err.message}`),
      );

    return transaction;
  }

  // ============================================
  // GIFT CARD TRADE MANAGEMENT
  // ============================================

  /**
   * Get all trades (admin view)
   */
  async getTrades(
    query: TradeQueryDto,
  ): Promise<PaginatedResult<GiftCardTrade>> {
    return this.giftCardsService.getAllTrades(query);
  }

  /**
   * Get a single trade by ID
   */
  async getTradeById(tradeId: string): Promise<GiftCardTrade> {
    return this.giftCardsService.getTradeById(tradeId);
  }

  /**
   * Review/approve/reject a trade
   */
  async reviewTrade(
    tradeId: string,
    adminId: string,
    dto: ReviewTradeDto,
  ): Promise<GiftCardTrade> {
    const result = await this.giftCardsService.reviewTrade(tradeId, adminId, dto);

    // Notify the user (in-app + push) for every admin decision, including
    // PROCESSING — previously PROCESSING was skipped, so users got no signal
    // when their trade was picked up for review.
    const userId = result.userId?.toString();
    if (userId) {
      let title: string | null = null;
      let body = '';
      let category = '';

      switch (dto.status) {
        case TradeStatus.APPROVED:
          title = 'Trade Approved';
          body = 'Your gift card trade has been approved. Wallet credited.';
          category = 'trade_approved';
          break;
        case TradeStatus.REJECTED:
          title = 'Trade Rejected';
          body = `Your gift card trade was rejected.${dto.rejectionReason ? ' Reason: ' + dto.rejectionReason : ''}`;
          category = 'trade_rejected';
          break;
        case TradeStatus.PROCESSING:
          title = 'Trade Processing';
          body =
            "Your gift card trade is now being reviewed. We'll notify you as soon as there's an update.";
          category = 'trade_review';
          break;
        // Any other status is not a user-facing decision — no notification.
      }

      if (title) {
        this.notificationsService
          .sendToUser(
            userId,
            title,
            body,
            { type: category, tradeId },
            'TRADE' as any,
            category,
          )
          .catch((err) =>
            this.logger.error('Failed to send trade notification:', err.message),
          );
      }
    }

    return result;
  }

  /**
   * Admin proposes a payout on a LOST_DIGITS trade. Delegates to
   * GiftCardsService.makeOffer and fires a push so the user opens the app.
   */
  async makeOffer(
    tradeId: string,
    adminId: string,
    dto: MakeOfferDto,
  ): Promise<GiftCardTrade> {
    const result = await this.giftCardsService.makeOffer(tradeId, adminId, dto);

    const userId = result.userId?.toString();
    if (userId) {
      const amountNaira = (dto.offerAmount / 100).toLocaleString('en-NG', {
        maximumFractionDigits: 2,
      });
      this.notificationsService
        .sendToUser(
          userId,
          'Offer received',
          `We have an offer of ₦${amountNaira} for your gift card. Open the app to accept or decline.`,
          { type: 'trade_offer', tradeId },
          'TRADE' as any,
          'trade_offer',
        )
        .catch((err) =>
          this.logger.error('Failed to send offer notification:', err.message),
        );
    }

    return result;
  }

  /**
   * Get trade statistics
   */
  async getTradeStats(): Promise<any> {
    return this.giftCardsService.getTradeStats();
  }

  // ============================================
  // PAYSTACK MANAGEMENT
  // ============================================

  /**
   * Get Paystack transactions
   */
  async getPaystackTransactions(
    query: PaystackQueryDto,
  ): Promise<PaginatedResult<PaystackTransaction>> {
    const filter: any = {};

    if (query.userId) {
      filter.userId = new Types.ObjectId(query.userId);
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.search) {
      filter.reference = { $regex: query.search, $options: "i" };
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    const total = await this.paystackModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const transactions = await this.paystackModel
      .find(filter)
      .populate("userId", "email phone fullName")
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    const mappedTransactions = transactions.map((t) => ({
      ...t.toObject(),
      amountNaira: toNaira(t.amount),
    }));

    return paginate(mappedTransactions, total, page, limit);
  }

  /**
   * Get single Paystack transaction
   */
  async getPaystackTransaction(id: string): Promise<any> {
    const transaction = await this.paystackModel
      .findById(id)
      .populate("userId", "email phone fullName");

    if (!transaction) {
      throw new NotFoundException("Paystack transaction not found");
    }

    return {
      ...transaction.toObject(),
      amountNaira: toNaira(transaction.amount),
    };
  }

  // ============================================
  // KORA PAY MANAGEMENT
  // ============================================

  /**
   * Get Kora Pay transactions (collections + payouts).
   * Reuses PaystackQueryDto — same filter shape (userId, status, search, dates).
   */
  async getKorapayTransactions(
    query: PaystackQueryDto,
  ): Promise<PaginatedResult<KorapayTransaction>> {
    const filter: any = {};

    if (query.userId) {
      filter.userId = new Types.ObjectId(query.userId);
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.search) {
      filter.reference = { $regex: query.search, $options: "i" };
    }
    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) filter.createdAt.$gte = new Date(query.startDate);
      if (query.endDate) filter.createdAt.$lte = new Date(query.endDate);
    }

    const total = await this.korapayModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const transactions = await this.korapayModel
      .find(filter)
      .populate("userId", "email phone fullName")
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    const mappedTransactions = transactions.map((t) => ({
      ...t.toObject(),
      amountNaira: toNaira(t.amount),
    }));

    return paginate(mappedTransactions, total, page, limit);
  }

  /**
   * Get single Kora Pay transaction
   */
  async getKorapayTransaction(id: string): Promise<any> {
    const transaction = await this.korapayModel
      .findById(id)
      .populate("userId", "email phone fullName");

    if (!transaction) {
      throw new NotFoundException("Kora transaction not found");
    }

    return {
      ...transaction.toObject(),
      amountNaira: toNaira(transaction.amount),
    };
  }

  // ============================================
  // WITHDRAWALS (ADMIN VIEW)
  // ============================================

  /**
   * List withdrawals with optional status and search filters
   */
  async getWithdrawals(query: WithdrawalsQueryDto): Promise<PaginatedResult<any>> {
    const filter: any = {};

    if (query.status) filter.status = query.status;

    if (query.search) {
      filter.$or = [
        { reference: { $regex: query.search, $options: 'i' } },
        { accountName: { $regex: query.search, $options: 'i' } },
        { accountNumber: { $regex: query.search, $options: 'i' } },
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.withdrawalModel.countDocuments(filter);
    const data = await this.withdrawalModel
      .find(filter)
      .populate('userId', 'email fullName phone')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit)
      .lean();

    return paginate(data, total, page, limit);
  }

  // ============================================
  // WALLET CREDIT REQUESTS
  // ============================================

  /**
   * List credit requests with optional status filter
   */
  async getCreditRequests(query: CreditRequestsQueryDto): Promise<PaginatedResult<any>> {
    const filter: any = {};
    if (query.status) filter.status = query.status;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const total = await this.creditRequestModel.countDocuments(filter);
    const data = await this.creditRequestModel
      .find(filter)
      .populate('requestedBy', 'fullName email')
      .populate('userId', 'fullName email')
      .populate('approvedBy', 'fullName email')
      .populate('deniedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit)
      .lean();

    return paginate(data, total, page, limit);
  }

  /**
   * Create a new credit request (amount in NGN — converted to kobo)
   */
  async createCreditRequest(dto: CreateCreditRequestDto, adminId: string): Promise<any> {
    if (!Types.ObjectId.isValid(dto.userId)) throw new BadRequestException('Invalid user ID');
    const user = await this.userModel.findById(dto.userId);
    if (!user) throw new NotFoundException('User not found');

    const amountKobo = toKobo(dto.amount);

    const req = await this.creditRequestModel.create({
      requestedBy: new Types.ObjectId(adminId),
      userId: new Types.ObjectId(dto.userId),
      amount: amountKobo,
      reason: dto.reason,
    });

    this.logger.log(`Credit request created by ${adminId} for user ${dto.userId} — amount: ${amountKobo} kobo`);

    return this.creditRequestModel
      .findById(req._id)
      .populate('requestedBy', 'fullName email')
      .populate('userId', 'fullName email')
      .lean();
  }

  /**
   * Approve a credit request — credits the user's wallet.
   * Enforces dual-approval: the requesting admin cannot approve their own request.
   */
  async approveCreditRequest(id: string, adminId: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid request ID');

    const req = await this.creditRequestModel.findById(id);
    if (!req) throw new NotFoundException('Credit request not found');
    if (req.status !== CreditRequestStatus.PENDING)
      throw new BadRequestException('Only PENDING requests can be approved');
    if (req.requestedBy.toString() === adminId)
      throw new BadRequestException('You cannot approve your own credit request');

    const txn = await this.walletService.creditWallet({
      userId: req.userId.toString(),
      amount: req.amount,
      category: TransactionCategory.MANUAL,
      source: TransactionSource.MANUAL_ADJUSTMENT,
      reference: generateReference('CREDIT_REQ'),
      narration: `Admin credit request approved: ${req.reason}`,
      meta: { adminId, creditRequestId: id },
    });

    req.status = CreditRequestStatus.APPROVED;
    req.approvedBy = new Types.ObjectId(adminId);
    req.walletTransactionId = (txn as any)._id;
    await req.save();

    this.logger.log(`Credit request ${id} approved by ${adminId}`);

    // Notify user about wallet credit
    this.notificationsService.sendToUser(
      req.userId.toString(),
      'Wallet Credited',
      `Your wallet has been credited with ₦${toNaira(req.amount).toLocaleString('en-NG')}.`,
      { type: 'wallet_credit', creditRequestId: id },
      'TRANSACTION' as any,
      'wallet_credit',
    ).catch((err) => this.logger.error('Failed to send credit notification:', err.message));

    return this.creditRequestModel
      .findById(id)
      .populate('requestedBy', 'fullName email')
      .populate('userId', 'fullName email')
      .populate('approvedBy', 'fullName email')
      .lean();
  }

  /**
   * Deny a credit request
   */
  async denyCreditRequest(id: string, adminId: string, dto: DenyCreditRequestDto): Promise<any> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid request ID');

    const req = await this.creditRequestModel.findById(id);
    if (!req) throw new NotFoundException('Credit request not found');
    if (req.status !== CreditRequestStatus.PENDING)
      throw new BadRequestException('Only PENDING requests can be denied');

    req.status = CreditRequestStatus.DENIED;
    req.deniedBy = new Types.ObjectId(adminId);
    req.deniedReason = dto.deniedReason;
    await req.save();

    this.logger.log(`Credit request ${id} denied by ${adminId}`);

    return this.creditRequestModel
      .findById(id)
      .populate('requestedBy', 'fullName email')
      .populate('userId', 'fullName email')
      .populate('deniedBy', 'fullName email')
      .lean();
  }

  // ============================================
  // NOTIFICATIONS
  // ============================================

  async sendNotification(dto: SendNotificationDto, adminId: string): Promise<{ sentCount: number }> {
    let users: { _id: string; email: string; fullName?: string }[] = [];

    if (dto.recipients === NotificationRecipients.INDIVIDUAL) {
      if (!dto.targetUserId) {
        throw new BadRequestException('targetUserId is required when recipients is individual');
      }
      const user = await this.userModel.findById(dto.targetUserId).select('_id email fullName status').lean();
      if (!user) throw new NotFoundException('User not found');
      users = [{ _id: (user as any)._id.toString(), email: user.email as string, fullName: (user as any).fullName }];
    } else {
      const filter: any = { isDeleted: false };
      if (dto.recipients === NotificationRecipients.ACTIVE) {
        filter.status = 'ACTIVE';
        filter.isEmailVerified = true;
      }
      const allUsers = await this.userModel.find(filter).select('_id email fullName').lean();
      users = allUsers.map((u: any) => ({ _id: u._id.toString(), email: u.email, fullName: u.fullName }));
    }

    let sentCount = 0;

    if (dto.type === 'email') {
      // Send emails in batches of 50 to avoid overwhelming SMTP
      const batchSize = 50;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        await Promise.allSettled(
          batch.map((u) =>
            this.emailService.send({
              to: u.email,
              subject: dto.subject,
              html: `<div style="font-family:sans-serif;max-width:600px;margin:auto">
                <h2 style="color:#003CED">${dto.subject}</h2>
                <p>${dto.body.replace(/\n/g, '<br>')}</p>
                <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
                <p style="color:#999;font-size:12px">Zinkite — Nigeria's trusted fintech platform</p>
              </div>`,
              text: dto.body,
            }).then(() => sentCount++)
              .catch(() => {/* skip failed individual sends */}),
          ),
        );
      }
    } else {
      // Push notification via Expo Push API + in-app persistence
      const userIds = users.map((u) => u._id);
      await this.notificationsService.sendToMultiple(
        userIds,
        dto.subject,
        dto.body,
        {},
        'PROMOTION' as any,
        'admin_broadcast',
      );
      sentCount = users.length;
    }

    // Log the notification
    await this.notificationLogModel.create({
      subject: dto.subject,
      body: dto.body,
      type: dto.type,
      recipients: dto.recipients,
      targetUserId: dto.targetUserId || null,
      sentCount,
      status: 'sent',
      sentBy: adminId,
    });

    return { sentCount };
  }

  async getNotificationHistory(query: NotificationsQueryDto): Promise<any> {
    const { page = 1, limit = 20 } = query;
    const skip = calculateSkip(page, limit);

    const [data, total] = await Promise.all([
      this.notificationLogModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('sentBy', 'fullName email')
        .lean(),
      this.notificationLogModel.countDocuments(),
    ]);

    return paginate(data, total, page, limit);
  }
}
