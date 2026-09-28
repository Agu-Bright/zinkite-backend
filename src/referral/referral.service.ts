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
const KEY_POINT_VALUE_KOBO = 'referral_point_value_kobo';
const KEY_MIN_CONVERSION_POINTS = 'referral_min_conversion_points';

// Defaults if an admin has not configured anything yet
const DEFAULT_POINTS_PER_REFERRAL = 10;
const DEFAULT_POINT_VALUE_KOBO = 5000; // ₦50 per point
const DEFAULT_MIN_CONVERSION_POINTS = 0;

export interface ReferralSettings {
  pointsPerReferral: number;
  pointValueKobo: number;
  pointValue: number; // Naira, convenience for clients
  minConversionPoints: number;
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
    const [pointsPerReferral, pointValueKobo, minConversionPoints] =
      await Promise.all([
        this.settingsService.getValue<number>(
          KEY_POINTS_PER_REFERRAL,
          DEFAULT_POINTS_PER_REFERRAL,
        ),
        this.settingsService.getValue<number>(
          KEY_POINT_VALUE_KOBO,
          DEFAULT_POINT_VALUE_KOBO,
        ),
        this.settingsService.getValue<number>(
          KEY_MIN_CONVERSION_POINTS,
          DEFAULT_MIN_CONVERSION_POINTS,
        ),
      ]);

    const kobo = Math.max(0, Math.round(Number(pointValueKobo) || 0));
    return {
      pointsPerReferral: Math.max(0, Math.round(Number(pointsPerReferral) || 0)),
      pointValueKobo: kobo,
      pointValue: toNaira(kobo),
      minConversionPoints: Math.max(0, Math.round(Number(minConversionPoints) || 0)),
    };
  }

  async updateReferralSettings(
    dto: UpdateReferralSettingsDto,
  ): Promise<ReferralSettings> {
    await this.settingsService.bulkUpdate({
      settings: [
        {
          key: KEY_POINTS_PER_REFERRAL,
          value: Math.max(0, Math.round(dto.pointsPerReferral)),
        },
        {
          key: KEY_POINT_VALUE_KOBO,
          value: toKobo(dto.pointValue),
        },
        {
          key: KEY_MIN_CONVERSION_POINTS,
          value: Math.max(0, Math.round(dto.minConversionPoints ?? 0)),
        },
      ],
    });

    return this.getReferralSettings();
  }

  // ═══════════════════════════════════════════════════════════
  // EARNING (on signup)
  // ═══════════════════════════════════════════════════════════

  /**
   * Called from the registration flow when a new user signs up with a code.
   * Awards the configured points to the referrer immediately.
   */
  async createReferral(
    referrerId: Types.ObjectId,
    referredUserId: Types.ObjectId,
    referralCode: string,
    session?: ClientSession,
  ): Promise<ReferralDocument> {
    // Guard against self-referral (defensive; a new signup can't be an
    // existing user, but never award a user for referring themselves).
    if (referrerId.toString() === referredUserId.toString()) {
      throw new BadRequestException('You cannot refer yourself');
    }

    const settings = await this.getReferralSettings();
    const points = settings.pointsPerReferral;

    const referral = new this.referralModel({
      referrerId,
      referredUserId,
      referralCode: referralCode.trim().toUpperCase(),
      status: ReferralStatus.EARNED,
      pointsAwarded: points,
    });
    const saved = await referral.save(session ? { session } : undefined);

    if (points > 0) {
      await this.userModel.updateOne(
        { _id: referrerId },
        { $inc: { referralPoints: points, referralPointsEarned: points } },
        session ? { session } : {},
      );

      // Notify the referrer (fire-and-forget; uses its own connection).
      void this.notificationsService.sendToUser(
        referrerId.toString(),
        'You earned referral points!',
        `You earned ${points} point${points === 1 ? '' : 's'} because someone signed up with your referral code.`,
        { type: 'referral_points' },
        NotificationType.TRANSACTION,
        'referral_points',
      );
    }

    this.logger.log(
      `Referral recorded: referrer ${referrerId} earned ${points} pts (referred ${referredUserId})`,
    );
    return saved;
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

    const totalReferrals = await this.referralModel.countDocuments({
      referrerId: new Types.ObjectId(userId),
      status: ReferralStatus.EARNED,
    });

    const points = user?.referralPoints || 0;
    return {
      referralCode,
      points,
      pointsEarnedLifetime: user?.referralPointsEarned || 0,
      totalReferrals,
      pointValueKobo: settings.pointValueKobo,
      pointValue: settings.pointValue,
      pointsPerReferral: settings.pointsPerReferral,
      minConversionPoints: settings.minConversionPoints,
      convertibleAmountKobo: points * settings.pointValueKobo,
      convertibleAmountNaira: toNaira(points * settings.pointValueKobo),
    };
  }

  async getMyStats(userId: string) {
    const user = await this.usersService.findById(userId);
    const settings = await this.getReferralSettings();
    const totalReferrals = await this.referralModel.countDocuments({
      referrerId: new Types.ObjectId(userId),
      status: ReferralStatus.EARNED,
    });
    const points = user?.referralPoints || 0;
    return {
      totalReferrals,
      points,
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
    const [totalReferrals, pointsAgg, walletAgg] = await Promise.all([
      this.referralModel.countDocuments({ status: ReferralStatus.EARNED }),
      this.userModel.aggregate([
        {
          $group: {
            _id: null,
            outstandingPoints: { $sum: '$referralPoints' },
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

    return {
      totalReferrals,
      outstandingPoints,
      lifetimePointsAwarded: pointsAgg[0]?.lifetimePoints || 0,
      outstandingLiabilityKobo: outstandingPoints * settings.pointValueKobo,
      totalConvertedKobo: walletAgg[0]?.totalKobo || 0,
      settings,
    };
  }

  async getAdminReferralEarnings(query: AdminReferralEarningsQueryDto) {
    const { page = 1, limit = 20, search } = query;

    const pipeline: any[] = [
      { $match: { status: ReferralStatus.EARNED } },
      {
        $group: {
          _id: '$referrerId',
          totalReferrals: { $sum: 1 },
          pointsFromReferrals: { $sum: '$pointsAwarded' },
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
