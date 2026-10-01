/**
 * Referral Service (points-based)
 *
 * Flow:
 *  - Every user has a referral code.
 *  - When a new user signs up with a code, the referrer earns points
 *    immediately (admin-configured points per referral).
 *  - Points can be converted to wallet Naira at an admin-configured rate
 *    (₦ value per point), then spent or withdrawn via the normal wallet.
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types, ClientSession } from 'mongoose';
import {
  Referral,
  ReferralDocument,
  ReferralStatus,
} from './schemas/referral.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { WalletService } from '../wallet/wallet.service';
import {
  TransactionCategory,
  TransactionSource,
} from '../wallet/schemas/wallet-transaction.schema';
import {
  toKobo,
  toNaira,
  generateReference,
  paginate,
  calculateSkip,
} from '../common/utils/helpers';
import {
  MyReferralsQueryDto,
  UpdateReferralSettingsDto,
  AdminReferralEarningsQueryDto,
} from './dto';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/user-notification.schema';
import { UsersService } from '../users/users.service';

// Settings keys
const KEY_POINTS_PER_REFERRAL = 'referral_points_per_referral';
const KEY_REFEREE_POINTS = 'referral_referee_points';
const KEY_POINT_VALUE_KOBO = 'referral_point_value_kobo';
const KEY_MIN_CONVERSION_POINTS = 'referral_min_conversion_points';
const KEY_UNLOCK_THRESHOLD_KOBO = 'referral_unlock_threshold_kobo';

// Defaults if an admin has not configured anything yet
const DEFAULT_POINTS_PER_REFERRAL = 10;
const DEFAULT_REFEREE_POINTS = 5;
const DEFAULT_POINT_VALUE_KOBO = 5000; // ₦50 per point
const DEFAULT_MIN_CONVERSION_POINTS = 0;
const DEFAULT_UNLOCK_THRESHOLD_KOBO = 500000; // ₦5,000 of referee transactions

export interface ReferralSettings {
  pointsPerReferral: number; // referrer's points
  refereePoints: number; // new user's points
  pointValueKobo: number;
  pointValue: number; // Naira, convenience for clients
  minConversionPoints: number;
  unlockThresholdKobo: number;
  unlockThreshold: number; // Naira, convenience for clients
}

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @InjectModel(Referral.name)
    private readonly referralModel: Model<ReferralDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly walletService: WalletService,
    private readonly settingsService: SettingsService,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // REFERRAL CODE
  // ═══════════════════════════════════════════════════════════

  private generateReferralCodeValue(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `PAY-${code}`;
  }

  async getOrCreateUserReferralCode(userId: string): Promise<string> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.referralCode) return user.referralCode;

    for (let attempt = 0; attempt < 10; attempt++) {
      const referralCode = this.generateReferralCodeValue();
      if (await this.usersService.findByReferralCode(referralCode)) continue;

      try {
        const updated = await this.usersService.update(userId, { referralCode });
        return updated.referralCode!;
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
      }
    }

    throw new BadRequestException(
      'Could not generate a referral code. Please try again.',
    );
  }

  async updateUserReferralCode(
    userId: string,
    requestedCode: string,
  ): Promise<string> {
    const referralCode = requestedCode.trim().toUpperCase();
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user.referralCode === referralCode) return referralCode;

    const owner = await this.usersService.findByReferralCode(referralCode);
    if (owner && owner._id.toString() !== userId) {
      throw new ConflictException('This referral code is already taken');
    }

    try {
      const updated = await this.usersService.update(userId, { referralCode });
      return updated.referralCode!;
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('This referral code is already taken');
      }
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SETTINGS (Admin-configurable)
  // ═══════════════════════════════════════════════════════════

  async getReferralSettings(): Promise<ReferralSettings> {
    const [pointsPerReferral, refereePoints, pointValueKobo, minConversionPoints, unlockKobo] =
      await Promise.all([
        this.settingsService.getValue<number>(KEY_POINTS_PER_REFERRAL, DEFAULT_POINTS_PER_REFERRAL),
        this.settingsService.getValue<number>(KEY_REFEREE_POINTS, DEFAULT_REFEREE_POINTS),
        this.settingsService.getValue<number>(KEY_POINT_VALUE_KOBO, DEFAULT_POINT_VALUE_KOBO),
        this.settingsService.getValue<number>(KEY_MIN_CONVERSION_POINTS, DEFAULT_MIN_CONVERSION_POINTS),
        this.settingsService.getValue<number>(KEY_UNLOCK_THRESHOLD_KOBO, DEFAULT_UNLOCK_THRESHOLD_KOBO),
      ]);

    const kobo = Math.max(0, Math.round(Number(pointValueKobo) || 0));
    const unlock = Math.max(0, Math.round(Number(unlockKobo) || 0));
    return {
      pointsPerReferral: Math.max(0, Math.round(Number(pointsPerReferral) || 0)),
      refereePoints: Math.max(0, Math.round(Number(refereePoints) || 0)),
      pointValueKobo: kobo,
      pointValue: toNaira(kobo),
      minConversionPoints: Math.max(0, Math.round(Number(minConversionPoints) || 0)),
      unlockThresholdKobo: unlock,
      unlockThreshold: toNaira(unlock),
    };
  }

  async updateReferralSettings(
    dto: UpdateReferralSettingsDto,
  ): Promise<ReferralSettings> {
    await this.settingsService.bulkUpdate({
      settings: [
        { key: KEY_POINTS_PER_REFERRAL, value: Math.max(0, Math.round(dto.pointsPerReferral)) },
        { key: KEY_REFEREE_POINTS, value: Math.max(0, Math.round(dto.refereePoints)) },
        { key: KEY_POINT_VALUE_KOBO, value: toKobo(dto.pointValue) },
        { key: KEY_MIN_CONVERSION_POINTS, value: Math.max(0, Math.round(dto.minConversionPoints ?? 0)) },
        { key: KEY_UNLOCK_THRESHOLD_KOBO, value: toKobo(dto.unlockThreshold ?? 0) },
      ],
    });

    return this.getReferralSettings();
  }

  // ═══════════════════════════════════════════════════════════
  // EARNING (signup → pending, first transaction → earned)
  // ═══════════════════════════════════════════════════════════

  /**
   * Called from the registration flow when a new user signs up with a code.
   * Grants BOTH the referrer and the referee their bonus points, held LOCKED
   * until the referee transacts up to the threshold (or immediately if the
   * threshold is 0).
   */
  async createReferral(
    referrerId: Types.ObjectId,
    referredUserId: Types.ObjectId,
    referralCode: string,
    session?: ClientSession,
  ): Promise<ReferralDocument> {
    if (referrerId.toString() === referredUserId.toString()) {
      throw new BadRequestException('You cannot refer yourself');
    }

    const settings = await this.getReferralSettings();
    const referrerPts = settings.pointsPerReferral;
    const refereePts = settings.refereePoints;
    const threshold = settings.unlockThresholdKobo;
    const unlockNow = threshold <= 0; // no transaction required

    const referral = new this.referralModel({
      referrerId,
      referredUserId,
      referralCode: referralCode.trim().toUpperCase(),
      status: unlockNow ? ReferralStatus.UNLOCKED : ReferralStatus.LOCKED,
      referrerPoints: referrerPts,
      refereePoints: refereePts,
      refereeTxnTotalKobo: 0,
      unlockThresholdKobo: threshold,
      unlockedAt: unlockNow ? new Date() : null,
      refereeAcknowledged: false,
    });
    const saved = await referral.save(session ? { session } : undefined);

    const opt: any = session ? { session } : {};
    const bucket = unlockNow ? 'referralPoints' : 'referralPointsLocked';

    if (referrerPts > 0) {
      await this.userModel.updateOne(
        { _id: referrerId },
        { $inc: { [bucket]: referrerPts, referralPointsEarned: referrerPts } },
        opt,
      );
    }
    if (refereePts > 0) {
      await this.userModel.updateOne(
        { _id: referredUserId },
        { $inc: { [bucket]: refereePts, referralPointsEarned: refereePts } },
        opt,
      );
    }

    // Notify the referrer.
    if (referrerPts > 0) {
      void this.notificationsService.sendToUser(
        referrerId.toString(),
        'Someone used your referral code!',
        unlockNow
          ? `You earned ${referrerPts} referral point${referrerPts === 1 ? '' : 's'}.`
          : `You earned ${referrerPts} referral point${referrerPts === 1 ? '' : 's'} — they'll unlock once your referral transacts.`,
        { type: 'referral_points' },
        NotificationType.TRANSACTION,
        'referral_points',
      );
    }
    // Notify the referee (the in-app confetti is the main celebration).
    if (refereePts > 0) {
      void this.notificationsService.sendToUser(
        referredUserId.toString(),
        'You earned a referral reward! 🎉',
        unlockNow
          ? `You earned ${refereePts} referral point${refereePts === 1 ? '' : 's'}.`
          : `You earned ${refereePts} referral point${refereePts === 1 ? '' : 's'} — make a transaction to unlock them.`,
        { type: 'referral_points' },
        NotificationType.TRANSACTION,
        'referral_points',
      );
    }

    this.logger.log(
      `Referral created: referrer ${referrerId} (+${referrerPts}) / referee ${referredUserId} (+${refereePts}) — ${unlockNow ? 'UNLOCKED' : 'LOCKED'}`,
    );
    return saved;
  }

  /**
   * Transaction categories that count toward unlocking a referral bonus —
   * real product activity, excluding wallet funding, withdrawals, refunds and
   * reward credits.
   */
  private static readonly QUALIFYING_CATEGORIES = [
    'GIFTCARD',
    'GIFTCARD_BUY',
    'AIRTIME',
    'DATA',
    'ELECTRICITY',
    'TV',
  ];

  /** Sum of a referee's successful qualifying transactions (kobo). */
  private async computeRefereeQualifyingKobo(
    userId: Types.ObjectId,
  ): Promise<number> {
    const agg = await this.connection
      .collection('wallet_transactions')
      .aggregate([
        {
          $match: {
            userId,
            status: 'SUCCESS',
            category: { $in: ReferralService.QUALIFYING_CATEGORIES },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .toArray();
    return agg[0]?.total || 0;
  }

  /**
   * Called after a referred user completes a successful transaction. Recomputes
   * their cumulative qualifying volume from the ledger (self-healing — counts
   * all history, even transactions made before this logic existed) and, once
   * the threshold is reached, UNLOCKS the bonus for BOTH parties. Idempotent.
   */
  async qualifyReferral(
    userId: string,
    _transactionAmountKobo: number,
    _transactionId?: Types.ObjectId,
  ): Promise<void> {
    const refereeId = new Types.ObjectId(userId);
    const ref = await this.referralModel.findOne({
      referredUserId: refereeId,
      status: ReferralStatus.LOCKED,
    });
    if (!ref) return; // not a locked referee

    // Recompute the full qualifying total from the ledger (not just this txn).
    const total = await this.computeRefereeQualifyingKobo(refereeId);
    if (total !== ref.refereeTxnTotalKobo) {
      await this.referralModel.updateOne(
        { _id: ref._id },
        { $set: { refereeTxnTotalKobo: total } },
      );
    }
    if (total < ref.unlockThresholdKobo) return; // not enough yet

    // Claim the unlock atomically.
    const unlocked = await this.referralModel.findOneAndUpdate(
      { _id: ref._id, status: ReferralStatus.LOCKED },
      { $set: { status: ReferralStatus.UNLOCKED, unlockedAt: new Date(), refereeTxnTotalKobo: total } },
      { new: true },
    );
    if (!unlocked) return; // unlocked by a concurrent call

    // Move locked → available for both parties.
    if (unlocked.referrerPoints > 0) {
      await this.userModel.updateOne(
        { _id: unlocked.referrerId },
        { $inc: { referralPoints: unlocked.referrerPoints, referralPointsLocked: -unlocked.referrerPoints } },
      );
      void this.notificationsService.sendToUser(
        unlocked.referrerId.toString(),
        'Referral bonus unlocked! 🎉',
        `Your ${unlocked.referrerPoints} referral point${unlocked.referrerPoints === 1 ? '' : 's'} are now ready to use.`,
        { type: 'referral_points' },
        NotificationType.TRANSACTION,
        'referral_points',
      );
    }
    if (unlocked.refereePoints > 0) {
      await this.userModel.updateOne(
        { _id: unlocked.referredUserId },
        { $inc: { referralPoints: unlocked.refereePoints, referralPointsLocked: -unlocked.refereePoints } },
      );
      void this.notificationsService.sendToUser(
        unlocked.referredUserId.toString(),
        'Referral bonus unlocked! 🎉',
        `Your ${unlocked.refereePoints} referral point${unlocked.refereePoints === 1 ? '' : 's'} are now ready to use.`,
        { type: 'referral_points' },
        NotificationType.TRANSACTION,
        'referral_points',
      );
    }

    this.logger.log(`Referral unlocked: ${unlocked._id} (referee ${userId} hit threshold)`);
  }

  /** The referee marks their celebratory reward popup as seen. */
  async acknowledgeRefereeReward(userId: string): Promise<{ acknowledged: boolean }> {
    await this.referralModel.updateOne(
      { referredUserId: new Types.ObjectId(userId) },
      { $set: { refereeAcknowledged: true } },
    );
    return { acknowledged: true };
  }

  // ═══════════════════════════════════════════════════════════
  // CONVERSION (points → wallet Naira)
  // ═══════════════════════════════════════════════════════════

  async convertPoints(userId: string, points: number) {
    if (!Number.isInteger(points) || points <= 0) {
      throw new BadRequestException('Enter a valid number of points to convert');
    }

    const settings = await this.getReferralSettings();
    if (settings.pointValueKobo <= 0) {
      throw new BadRequestException(
        'Point conversion is currently unavailable. Please try again later.',
      );
    }
    if (settings.minConversionPoints > 0 && points < settings.minConversionPoints) {
      throw new BadRequestException(
        `You need at least ${settings.minConversionPoints} points to convert.`,
      );
    }

    // Atomically deduct points only if the balance is sufficient.
    const updated = await this.userModel.findOneAndUpdate(
      { _id: new Types.ObjectId(userId), referralPoints: { $gte: points } },
      { $inc: { referralPoints: -points } },
      { new: true },
    );
    if (!updated) {
      throw new BadRequestException('You do not have enough points.');
    }

    const amountKobo = points * settings.pointValueKobo;
    const reference = generateReference('REFCONV');

    try {
      const walletTxn = await this.walletService.creditWallet({
        userId,
        amount: amountKobo,
        category: TransactionCategory.REFERRAL_REWARD,
        source: TransactionSource.REFERRAL_REWARD,
        narration: `Converted ${points} referral points to wallet`,
        reference,
        meta: { points, pointValueKobo: settings.pointValueKobo },
      });

      void this.notificationsService.sendToUser(
        userId,
        'Referral points converted',
        `You converted ${points} points into ₦${toNaira(amountKobo).toLocaleString('en-NG')} in your wallet.`,
        { type: 'wallet_credit', reference },
        NotificationType.TRANSACTION,
        'referral_reward',
      );

      return {
        pointsConverted: points,
        amountKobo,
        amountNaira: toNaira(amountKobo),
        newPointsBalance: updated.referralPoints,
        walletTransactionId: (walletTxn as any)._id,
        reference,
      };
    } catch (error: any) {
      // Refund the points if the wallet credit failed.
      await this.userModel.updateOne(
        { _id: new Types.ObjectId(userId) },
        { $inc: { referralPoints: points } },
      );
      this.logger.error(
        `Point conversion failed for user ${userId}, refunded ${points} pts: ${error.message}`,
      );
      throw new BadRequestException(
        'Could not convert your points right now. No points were deducted.',
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // USER-FACING QUERIES
  // ═══════════════════════════════════════════════════════════

  /** Everything the referral hub needs in one call. */
  async getMySummary(userId: string) {
    const referralCode = await this.getOrCreateUserReferralCode(userId);
    const user = await this.usersService.findById(userId);
    const settings = await this.getReferralSettings();

    const referrerId = new Types.ObjectId(userId);
    const [totalReferrals, unlockedReferrals, lockedReferrals, myReferral] =
      await Promise.all([
        this.referralModel.countDocuments({ referrerId }),
        this.referralModel.countDocuments({ referrerId, status: ReferralStatus.UNLOCKED }),
        this.referralModel.countDocuments({ referrerId, status: ReferralStatus.LOCKED }),
        // This user's OWN record as a referee (if they were referred).
        this.referralModel
          .findOne({ referredUserId: referrerId })
          .lean(),
      ]);

    const points = user?.referralPoints || 0; // available/convertible
    const lockedPoints = user?.referralPointsLocked || 0;

    // The referee reward belonging to THIS user (as a referred user).
    const refereeReward = myReferral
      ? {
          points: (myReferral as any).refereePoints || 0,
          locked: (myReferral as any).status === ReferralStatus.LOCKED,
          acknowledged: !!(myReferral as any).refereeAcknowledged,
          unlockThresholdKobo: (myReferral as any).unlockThresholdKobo || 0,
          progressKobo: (myReferral as any).refereeTxnTotalKobo || 0,
        }
      : null;

    return {
      referralCode,
      points,
      lockedPoints,
      pointsEarnedLifetime: user?.referralPointsEarned || 0,
      totalReferrals,
      // "earned" = unlocked (usable), "pending" = still locked
      earnedReferrals: unlockedReferrals,
      pendingReferrals: lockedReferrals,
      pointValueKobo: settings.pointValueKobo,
      pointValue: settings.pointValue,
      pointsPerReferral: settings.pointsPerReferral,
      refereePoints: settings.refereePoints,
      minConversionPoints: settings.minConversionPoints,
      unlockThreshold: settings.unlockThreshold,
      unlockThresholdKobo: settings.unlockThresholdKobo,
      convertibleAmountKobo: points * settings.pointValueKobo,
      convertibleAmountNaira: toNaira(points * settings.pointValueKobo),
      refereeReward,
    };
  }

  async getMyStats(userId: string) {
    const user = await this.usersService.findById(userId);
    const settings = await this.getReferralSettings();
    const referrerId = new Types.ObjectId(userId);
    const [totalReferrals, unlockedReferrals, lockedReferrals] = await Promise.all([
      this.referralModel.countDocuments({ referrerId }),
      this.referralModel.countDocuments({ referrerId, status: ReferralStatus.UNLOCKED }),
      this.referralModel.countDocuments({ referrerId, status: ReferralStatus.LOCKED }),
    ]);
    const points = user?.referralPoints || 0;
    return {
      totalReferrals,
      earnedReferrals: unlockedReferrals,
      pendingReferrals: lockedReferrals,
      points,
      lockedPoints: user?.referralPointsLocked || 0,
      pointsEarnedLifetime: user?.referralPointsEarned || 0,
      pointValueKobo: settings.pointValueKobo,
      convertibleAmountKobo: points * settings.pointValueKobo,
    };
  }

  async getMyReferrals(userId: string, query: MyReferralsQueryDto) {
    const { page = 1, limit = 20 } = query;
    const filter = { referrerId: new Types.ObjectId(userId) };

    const [data, total] = await Promise.all([
      this.referralModel
        .find(filter)
        .populate('referredUserId', 'fullName email createdAt')
        .sort({ createdAt: -1 })
        .skip(calculateSkip(page, limit))
        .limit(limit)
        .lean(),
      this.referralModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN
  // ═══════════════════════════════════════════════════════════

  async getAdminStats() {
    const [totalReferrals, earnedReferrals, pendingReferrals, pointsAgg, walletAgg] = await Promise.all([
      this.referralModel.countDocuments({}),
      this.referralModel.countDocuments({ status: ReferralStatus.UNLOCKED }),
      this.referralModel.countDocuments({ status: ReferralStatus.LOCKED }),
      this.userModel.aggregate([
        {
          $group: {
            _id: null,
            outstandingPoints: { $sum: '$referralPoints' },
            lockedPoints: { $sum: '$referralPointsLocked' },
            lifetimePoints: { $sum: '$referralPointsEarned' },
          },
        },
      ]),
      // Total Naira ever paid out via point conversions
      this.connection
        .collection('wallet_transactions')
        .aggregate([
          { $match: { source: TransactionSource.REFERRAL_REWARD } },
          { $group: { _id: null, totalKobo: { $sum: '$amount' } } },
        ])
        .toArray(),
    ]);

    const settings = await this.getReferralSettings();
    const outstandingPoints = pointsAgg[0]?.outstandingPoints || 0;
    const lockedPoints = pointsAgg[0]?.lockedPoints || 0;

    return {
      totalReferrals,
      earnedReferrals, // unlocked
      pendingReferrals, // locked
      outstandingPoints,
      lockedPoints,
      lifetimePointsAwarded: pointsAgg[0]?.lifetimePoints || 0,
      outstandingLiabilityKobo: (outstandingPoints + lockedPoints) * settings.pointValueKobo,
      totalConvertedKobo: walletAgg[0]?.totalKobo || 0,
      settings,
    };
  }

  async getAdminReferralEarnings(query: AdminReferralEarningsQueryDto) {
    const { page = 1, limit = 20, search } = query;

    const pipeline: any[] = [
      {
        $group: {
          _id: '$referrerId',
          totalReferrals: { $sum: 1 },
          earnedReferrals: {
            $sum: { $cond: [{ $eq: ['$status', ReferralStatus.UNLOCKED] }, 1, 0] },
          },
          pendingReferrals: {
            $sum: { $cond: [{ $eq: ['$status', ReferralStatus.LOCKED] }, 1, 0] },
          },
          pointsFromReferrals: { $sum: '$referrerPoints' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
    ];

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'user.fullName': re },
            { 'user.email': re },
            { 'user.phone': re },
            { 'user.referralCode': re },
          ],
        },
      });
    }

    pipeline.push({
      $project: {
        _id: 0,
        userId: '$_id',
        fullName: '$user.fullName',
        email: '$user.email',
        phone: '$user.phone',
        referralCode: { $ifNull: ['$user.referralCode', ''] },
        totalReferrals: 1,
        earnedReferrals: 1,
        pendingReferrals: 1,
        pointsBalance: { $ifNull: ['$user.referralPoints', 0] },
        pointsEarnedLifetime: { $ifNull: ['$user.referralPointsEarned', 0] },
      },
    });
    pipeline.push({ $sort: { pointsEarnedLifetime: -1 } });

    const countPipeline = [...pipeline, { $count: 'total' }];
    const [rows, countRes] = await Promise.all([
      this.referralModel.aggregate([
        ...pipeline,
        { $skip: calculateSkip(page, limit) },
        { $limit: limit },
      ]),
      this.referralModel.aggregate(countPipeline),
    ]);

    const total = countRes[0]?.total || 0;
    return paginate(rows, total, page, limit);
  }
}
