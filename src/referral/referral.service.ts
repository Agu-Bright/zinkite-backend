/**
 * Referral Service
 *
 * Core business logic for referral challenges:
 * - Challenge CRUD + lifecycle (DRAFT → ACTIVE → PAUSED → ENDED)
 * - Referral tracking and qualification
 * - Winner selection and reward distribution
 * - Leaderboard and stats
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types, ClientSession } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import {
  ReferralChallenge,
  ReferralChallengeDocument,
  ChallengeStatus,
} from './schemas/referral-challenge.schema';
import {
  Referral,
  ReferralDocument,
  ReferralStatus,
  ReferralRewardStatus,
} from './schemas/referral.schema';
import { WalletService } from '../wallet/wallet.service';
import {
  TransactionCategory,
  TransactionSource,
} from '../wallet/schemas/wallet-transaction.schema';
import { toKobo } from '../common/utils/helpers';
import {
  CreateChallengeDto,
  UpdateChallengeDto,
  ChallengesQueryDto,
  MyReferralsQueryDto,
  UpdateReferralSettingsDto,
  AdminReferralEarningsQueryDto,
} from './dto';
import { paginate, calculateSkip } from '../common/utils/helpers';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/user-notification.schema';
import { UsersService } from '../users/users.service';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @InjectModel(ReferralChallenge.name)
    private readonly challengeModel: Model<ReferralChallengeDocument>,
    @InjectModel(Referral.name)
    private readonly referralModel: Model<ReferralDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly walletService: WalletService,
    private readonly settingsService: SettingsService,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

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

  async getReferralSettings() {
    const [rewardAmountKobo, minTransactionAmountKobo] = await Promise.all([
      this.settingsService.getValue<number>('referral_reward_amount_kobo', 0),
      this.settingsService.getValue<number>(
        'referral_min_transaction_amount_kobo',
        50000,
      ),
    ]);

    return {
      rewardAmountKobo: Number(rewardAmountKobo) || 0,
      minTransactionAmountKobo: Number(minTransactionAmountKobo) || 0,
    };
  }

  async updateReferralSettings(dto: UpdateReferralSettingsDto) {
    await this.settingsService.bulkUpdate({
      settings: [
        {
          key: 'referral_reward_amount_kobo',
          value: toKobo(dto.rewardAmount),
        },
        {
          key: 'referral_min_transaction_amount_kobo',
          value: toKobo(dto.minTransactionAmount),
        },
      ],
    });

    return this.getReferralSettings();
  }

  // ═══════════════════════════════════════════════════════════
  // CHALLENGE MANAGEMENT (Admin)
  // ═══════════════════════════════════════════════════════════

  async createChallenge(
    dto: CreateChallengeDto,
    adminId: string,
  ): Promise<ReferralChallengeDocument> {
    const rewardAmountKobo = toKobo(dto.rewardAmount);
    const totalBudgetKobo = rewardAmountKobo * dto.numberOfWinners;

    const challenge = new this.challengeModel({
      title: dto.title,
      description: dto.description || '',
      rewardAmountKobo,
      numberOfWinners: dto.numberOfWinners,
      referralTarget: dto.referralTarget,
      minTransactionAmountKobo: toKobo(dto.minTransactionAmount),
      totalBudgetKobo,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
      status: ChallengeStatus.DRAFT,
      createdBy: new Types.ObjectId(adminId),
      updatedBy: new Types.ObjectId(adminId),
    });

    const saved = await challenge.save();
    this.logger.log(`Challenge created: ${saved._id} by admin ${adminId}`);
    return saved;
  }

  async updateChallenge(
    id: string,
    dto: UpdateChallengeDto,
    adminId: string,
  ): Promise<ReferralChallengeDocument> {
    const challenge = await this.challengeModel.findById(id);
    if (!challenge) throw new NotFoundException('Challenge not found');

    if (challenge.status === ChallengeStatus.ENDED) {
      throw new BadRequestException('Cannot update an ended challenge');
    }

    if (dto.title !== undefined) challenge.title = dto.title;
    if (dto.description !== undefined) challenge.description = dto.description;
    if (dto.referralTarget !== undefined)
      challenge.referralTarget = dto.referralTarget;
    if (dto.startsAt !== undefined) challenge.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined) challenge.endsAt = new Date(dto.endsAt);

    if (dto.rewardAmount !== undefined) {
      challenge.rewardAmountKobo = toKobo(dto.rewardAmount);
    }
    if (dto.numberOfWinners !== undefined) {
      challenge.numberOfWinners = dto.numberOfWinners;
    }
    if (dto.minTransactionAmount !== undefined) {
      challenge.minTransactionAmountKobo = toKobo(dto.minTransactionAmount);
    }

    // Recalculate budget
    challenge.totalBudgetKobo =
      challenge.rewardAmountKobo * challenge.numberOfWinners;
    challenge.updatedBy = new Types.ObjectId(adminId);

    return challenge.save();
  }

  async getChallenges(query: ChallengesQueryDto) {
    const filter: any = {};
    if (query.status) filter.status = query.status;

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = calculateSkip(page, limit);

    const [data, total] = await Promise.all([
      this.challengeModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.challengeModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  async getChallengeById(id: string): Promise<ReferralChallengeDocument> {
    const challenge = await this.challengeModel.findById(id);
    if (!challenge) throw new NotFoundException('Challenge not found');
    return challenge;
  }

  async startChallenge(
    id: string,
    adminId: string,
  ): Promise<ReferralChallengeDocument> {
    const challenge = await this.getChallengeById(id);

    if (
      challenge.status !== ChallengeStatus.DRAFT &&
      challenge.status !== ChallengeStatus.PAUSED
    ) {
      throw new BadRequestException(
        `Cannot start a challenge with status ${challenge.status}`,
      );
    }

    const otherActiveChallenge = await this.getActiveChallenge();
    if (
      otherActiveChallenge &&
      otherActiveChallenge._id.toString() !== challenge._id.toString()
    ) {
      throw new BadRequestException(
        'Another referral challenge is already active. Pause or end it first.',
      );
    }

    challenge.status = ChallengeStatus.ACTIVE;
    challenge.updatedBy = new Types.ObjectId(adminId);
    return challenge.save();
  }

  async pauseChallenge(
    id: string,
    adminId: string,
  ): Promise<ReferralChallengeDocument> {
    const challenge = await this.getChallengeById(id);

    if (challenge.status !== ChallengeStatus.ACTIVE) {
      throw new BadRequestException('Only active challenges can be paused');
    }

    challenge.status = ChallengeStatus.PAUSED;
    challenge.updatedBy = new Types.ObjectId(adminId);
    return challenge.save();
  }

  async endChallengeAndRewardWinners(
    id: string,
    adminId?: string,
  ): Promise<ReferralChallengeDocument> {
    const challenge = await this.getChallengeById(id);

    if (challenge.status === ChallengeStatus.ENDED) {
      throw new BadRequestException('Challenge is already ended');
    }

    // Aggregate top referrers by qualified referral count
    const leaderboard = await this.referralModel.aggregate([
      {
        $match: {
          challengeId: challenge._id,
          status: ReferralStatus.QUALIFIED,
        },
      },
      {
        $group: {
          _id: '$referrerId',
          qualifiedReferrals: { $sum: 1 },
        },
      },
      {
        $match: {
          qualifiedReferrals: { $gte: challenge.referralTarget },
        },
      },
      { $sort: { qualifiedReferrals: -1 } },
      { $limit: challenge.numberOfWinners },
    ]);

    const winners: typeof challenge.winners = [];

    for (const entry of leaderboard) {
      try {
        const walletTxn = await this.walletService.creditWallet({
          userId: entry._id,
          amount: challenge.rewardAmountKobo,
          category: TransactionCategory.MANUAL,
          source: TransactionSource.MANUAL_ADJUSTMENT,
          narration: `Referral Challenge Reward: ${challenge.title}`,
          meta: {
            challengeId: challenge._id.toString(),
            qualifiedReferrals: entry.qualifiedReferrals,
          },
        });

        winners.push({
          userId: entry._id,
          qualifiedReferrals: entry.qualifiedReferrals,
          rewardedAt: new Date(),
          walletTransactionId: (walletTxn as any)._id,
        });

        this.logger.log(
          `Rewarded user ${entry._id} with ${challenge.rewardAmountKobo} kobo for challenge ${id}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to reward user ${entry._id}: ${err.message}`,
        );
      }
    }

    challenge.winners = winners;
    challenge.status = ChallengeStatus.ENDED;
    if (adminId) challenge.updatedBy = new Types.ObjectId(adminId);

    return challenge.save();
  }

  // ═══════════════════════════════════════════════════════════
  // REFERRAL TRACKING
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a referral record when a new user registers via referral code.
   * Called from auth registration flow or externally.
   */
  async createReferral(
    referrerId: Types.ObjectId,
    referredUserId: Types.ObjectId,
    referralCode: string,
    session?: ClientSession,
  ): Promise<ReferralDocument> {
    // Find active challenge at time of signup
    const activeChallenge = await this.getActiveChallenge(session);

    const referral = new this.referralModel({
      referrerId,
      referredUserId,
      challengeId: activeChallenge?._id || null,
      referralCode: referralCode.trim().toUpperCase(),
      status: ReferralStatus.PENDING,
      rewardStatus: ReferralRewardStatus.PENDING,
    });

    return referral.save(session ? { session } : undefined);
  }

  /**
   * Check if a referred user's transaction qualifies them.
   * Called after successful wallet debits (airtime, data, giftcard buy, etc.)
   */
  async checkAndQualifyReferral(
    userId: string,
    transactionAmountKobo: number,
    transactionId?: Types.ObjectId,
  ): Promise<void> {
    const pendingReferral = await this.referralModel.findOne({
      referredUserId: new Types.ObjectId(userId),
      status: ReferralStatus.PENDING,
    });

    if (!pendingReferral) return; // Not a referred user or already qualified

    // Determine minimum transaction amount
    let minAmount = 50000; // Default ₦500 in kobo
    if (pendingReferral.challengeId) {
      const challenge = await this.challengeModel.findById(
        pendingReferral.challengeId,
      );
      if (challenge) {
        minAmount = challenge.minTransactionAmountKobo;
      }
    }

    const baseSettings = await this.getReferralSettings();
    if (!pendingReferral.challengeId) {
      minAmount = baseSettings.minTransactionAmountKobo;
    }

    if (transactionAmountKobo < minAmount) return;

    // Claim qualification atomically so concurrent successful transactions
    // cannot qualify or reward the same referral twice.
    const referral = await this.referralModel.findOneAndUpdate(
      {
        _id: pendingReferral._id,
        status: ReferralStatus.PENDING,
      },
      {
        $set: {
          status: ReferralStatus.QUALIFIED,
          qualifiedAt: new Date(),
          qualifyingTransactionId: transactionId || null,
          rewardAmountKobo: baseSettings.rewardAmountKobo,
          rewardStatus:
            baseSettings.rewardAmountKobo > 0
              ? ReferralRewardStatus.PENDING
              : ReferralRewardStatus.NOT_APPLICABLE,
          rewardFailureReason: null,
        },
      },
      { new: true },
    );

    if (!referral) return;

    this.logger.log(
      `Referral qualified: user ${userId}, referrer ${referral.referrerId}`,
    );

    if (referral.rewardAmountKobo > 0) {
      await this.payBaseReferralReward(referral._id.toString());
    }
  }

  private async payBaseReferralReward(referralId: string): Promise<void> {
    const referral = await this.referralModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(referralId),
        status: ReferralStatus.QUALIFIED,
        rewardStatus: {
          $in: [ReferralRewardStatus.PENDING, ReferralRewardStatus.FAILED],
        },
        rewardAmountKobo: { $gt: 0 },
      },
      {
        $set: {
          rewardStatus: ReferralRewardStatus.PROCESSING,
          rewardFailureReason: null,
        },
      },
      { new: true },
    );

    if (!referral) return;

    const reference = `REFERRAL-${referral._id}`;

    try {
      const walletTxn = await this.walletService.creditWallet({
        userId: referral.referrerId,
        amount: referral.rewardAmountKobo,
        category: TransactionCategory.REFERRAL_REWARD,
        source: TransactionSource.REFERRAL_REWARD,
        narration: 'Referral reward',
        reference,
        relatedId: referral._id,
        meta: {
          referralId: referral._id.toString(),
          referredUserId: referral.referredUserId.toString(),
        },
      });

      await this.referralModel.updateOne(
        { _id: referral._id },
        {
          $set: {
            rewardStatus: ReferralRewardStatus.PAID,
            rewardedAt: new Date(),
            rewardTransactionId: (walletTxn as any)._id,
            rewardFailureReason: null,
          },
        },
      );

      void this.notificationsService.sendToUser(
        referral.referrerId.toString(),
        'Referral reward received',
        `You earned ₦${(referral.rewardAmountKobo / 100).toLocaleString('en-NG')} for a qualified referral.`,
        { type: 'wallet_credit', reference },
        NotificationType.TRANSACTION,
        'referral_reward',
      );
    } catch (error: any) {
      // A deterministic wallet reference makes retries idempotent. If the
      // transaction already exists, the reward was previously credited.
      const existingTxn = await this.connection
        .collection('wallet_transactions')
        .findOne({ reference });

      if (existingTxn) {
        await this.referralModel.updateOne(
          { _id: referral._id },
          {
            $set: {
              rewardStatus: ReferralRewardStatus.PAID,
              rewardedAt: existingTxn.createdAt || new Date(),
              rewardTransactionId: existingTxn._id,
              rewardFailureReason: null,
            },
          },
        );
        return;
      }

      await this.referralModel.updateOne(
        { _id: referral._id },
        {
          $set: {
            rewardStatus: ReferralRewardStatus.FAILED,
            rewardFailureReason: error.message || 'Reward credit failed',
          },
        },
      );
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // USER-FACING QUERIES
  // ═══════════════════════════════════════════════════════════

  /**
   * Get currently active challenge (there should be at most one)
   */
  async getActiveChallenge(session?: ClientSession): Promise<ReferralChallengeDocument | null> {
    const now = new Date();
    const query = this.challengeModel
      .findOne({
        status: ChallengeStatus.ACTIVE,
        startsAt: { $lte: now },
        endsAt: { $gte: now },
      });
    if (session) query.session(session);
    return query.exec();
  }

  @Cron('*/10 * * * *')
  async retryFailedBaseRewards() {
    const referrals = await this.referralModel
      .find({
        status: ReferralStatus.QUALIFIED,
        rewardStatus: ReferralRewardStatus.FAILED,
        rewardAmountKobo: { $gt: 0 },
      })
      .select('_id')
      .limit(100)
      .lean();

    for (const referral of referrals) {
      await this.payBaseReferralReward(referral._id.toString()).catch((error) =>
        this.logger.warn(`Referral reward retry failed: ${error.message}`),
      );
    }
  }

  /**
   * Get active challenges visible to users
   */
  async getActiveChallengesForUser(userId: string) {
    const now = new Date();
    const challenges = await this.challengeModel
      .find({
        status: ChallengeStatus.ACTIVE,
        startsAt: { $lte: now },
        endsAt: { $gte: now },
      })
      .lean()
      .exec();

    // Attach user's progress to each challenge
    const result = await Promise.all(
      challenges.map(async (challenge) => {
        const [qualifiedCount, totalReferred] = await Promise.all([
          this.referralModel.countDocuments({
            referrerId: new Types.ObjectId(userId),
            challengeId: challenge._id,
            status: ReferralStatus.QUALIFIED,
          }),
          this.referralModel.countDocuments({
            referrerId: new Types.ObjectId(userId),
            challengeId: challenge._id,
          }),
        ]);

        return {
          ...challenge,
          myProgress: { qualifiedCount, totalReferred },
        };
      }),
    );

    return result;
  }

  /**
   * Get challenge detail with user's progress
   */
  async getChallengeForUser(challengeId: string, userId: string) {
    const challenge = await this.challengeModel.findById(challengeId).lean();
    if (!challenge) throw new NotFoundException('Challenge not found');

    const [qualifiedCount, totalReferred] = await Promise.all([
      this.referralModel.countDocuments({
        referrerId: new Types.ObjectId(userId),
        challengeId: challenge._id,
        status: ReferralStatus.QUALIFIED,
      }),
      this.referralModel.countDocuments({
        referrerId: new Types.ObjectId(userId),
        challengeId: challenge._id,
      }),
    ]);

    return {
      ...challenge,
      myProgress: { qualifiedCount, totalReferred },
    };
  }

  /**
   * Get leaderboard for a challenge
   */
  async getLeaderboard(challengeId: string, userId?: string, limit = 20) {
    const leaderboard = await this.referralModel.aggregate([
      {
        $match: {
          challengeId: new Types.ObjectId(challengeId),
          status: ReferralStatus.QUALIFIED,
        },
      },
      {
        $group: {
          _id: '$referrerId',
          qualifiedReferrals: { $sum: 1 },
        },
      },
      { $sort: { qualifiedReferrals: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $project: {
          userId: '$_id',
          qualifiedReferrals: 1,
          fullName: '$user.fullName',
        },
      },
    ]);

    return leaderboard.map((entry, index) => {
      const isMe = userId
        ? entry.userId.toString() === userId
        : false;

      // Mask name for privacy: "John D***"
      let displayName = 'User';
      if (entry.fullName) {
        const parts = entry.fullName.split(' ');
        displayName =
          parts[0] + (parts[1] ? ` ${parts[1][0]}***` : '');
      }

      return {
        rank: index + 1,
        userId: entry.userId,
        displayName: isMe ? entry.fullName || 'You' : displayName,
        qualifiedReferrals: entry.qualifiedReferrals,
        isMe,
      };
    });
  }

  /**
   * Get user's referral list
   */
  async getMyReferrals(userId: string, query: MyReferralsQueryDto) {
    const filter: any = { referrerId: new Types.ObjectId(userId) };
    if (query.challengeId) {
      filter.challengeId = new Types.ObjectId(query.challengeId);
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = calculateSkip(page, limit);

    const [data, total] = await Promise.all([
      this.referralModel
        .find(filter)
        .populate('referredUserId', 'fullName createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.referralModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  /**
   * Get user's referral stats
   */
  async getMyStats(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    const [totalReferred, qualifiedCount, pendingCount] = await Promise.all([
      this.referralModel.countDocuments({ referrerId: userObjectId }),
      this.referralModel.countDocuments({
        referrerId: userObjectId,
        status: ReferralStatus.QUALIFIED,
      }),
      this.referralModel.countDocuments({
        referrerId: userObjectId,
        status: ReferralStatus.PENDING,
      }),
    ]);

    return { totalReferred, qualifiedCount, pendingCount };
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN STATS
  // ═══════════════════════════════════════════════════════════

  async getAdminReferralEarnings(query: AdminReferralEarningsQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = calculateSkip(page, limit);
    const search = query.search?.trim();

    const userSearchStage = search
      ? [{
          $match: {
            $or: [
              { 'user.fullName': { $regex: search, $options: 'i' } },
              { 'user.email': { $regex: search, $options: 'i' } },
              { 'user.phone': { $regex: search, $options: 'i' } },
              { 'user.referralCode': { $regex: search, $options: 'i' } },
            ],
          },
        }]
      : [];

    const [earningsResult, summaryRows] = await Promise.all([
      this.referralModel.aggregate([
        {
          $group: {
            _id: '$referrerId',
            totalReferrals: { $sum: 1 },
            qualifiedReferrals: {
              $sum: {
                $cond: [{ $eq: ['$status', ReferralStatus.QUALIFIED] }, 1, 0],
              },
            },
            pendingReferrals: {
              $sum: {
                $cond: [{ $eq: ['$status', ReferralStatus.PENDING] }, 1, 0],
              },
            },
            paidEarningsKobo: {
              $sum: {
                $cond: [
                  { $eq: ['$rewardStatus', ReferralRewardStatus.PAID] },
                  '$rewardAmountKobo',
                  0,
                ],
              },
            },
            pendingEarningsKobo: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      '$rewardStatus',
                      [
                        ReferralRewardStatus.PENDING,
                        ReferralRewardStatus.PROCESSING,
                      ],
                    ],
                  },
                  '$rewardAmountKobo',
                  0,
                ],
              },
            },
            failedEarningsKobo: {
              $sum: {
                $cond: [
                  { $eq: ['$rewardStatus', ReferralRewardStatus.FAILED] },
                  '$rewardAmountKobo',
                  0,
                ],
              },
            },
            lastReferralAt: { $max: '$createdAt' },
            lastRewardAt: { $max: '$rewardedAt' },
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
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        ...userSearchStage,
        { $sort: { paidEarningsKobo: -1, qualifiedReferrals: -1 } },
        {
          $facet: {
            data: [
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  _id: 0,
                  userId: '$_id',
                  fullName: { $ifNull: ['$user.fullName', 'Unknown user'] },
                  email: { $ifNull: ['$user.email', ''] },
                  phone: { $ifNull: ['$user.phone', ''] },
                  referralCode: { $ifNull: ['$user.referralCode', ''] },
                  totalReferrals: 1,
                  qualifiedReferrals: 1,
                  pendingReferrals: 1,
                  paidEarningsKobo: 1,
                  pendingEarningsKobo: 1,
                  failedEarningsKobo: 1,
                  lastReferralAt: 1,
                  lastRewardAt: 1,
                },
              },
            ],
            count: [{ $count: 'total' }],
          },
        },
      ]),
      this.referralModel.aggregate([
        {
          $group: {
            _id: null,
            totalReferrals: { $sum: 1 },
            qualifiedReferrals: {
              $sum: {
                $cond: [{ $eq: ['$status', ReferralStatus.QUALIFIED] }, 1, 0],
              },
            },
            paidRewards: {
              $sum: {
                $cond: [
                  { $eq: ['$rewardStatus', ReferralRewardStatus.PAID] },
                  1,
                  0,
                ],
              },
            },
            totalPaidKobo: {
              $sum: {
                $cond: [
                  { $eq: ['$rewardStatus', ReferralRewardStatus.PAID] },
                  '$rewardAmountKobo',
                  0,
                ],
              },
            },
            totalPendingKobo: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      '$rewardStatus',
                      [
                        ReferralRewardStatus.PENDING,
                        ReferralRewardStatus.PROCESSING,
                      ],
                    ],
                  },
                  '$rewardAmountKobo',
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const result = earningsResult[0] || { data: [], count: [] };
    const total = result.count[0]?.total || 0;
    const summary = summaryRows[0] || {
      totalReferrals: 0,
      qualifiedReferrals: 0,
      paidRewards: 0,
      totalPaidKobo: 0,
      totalPendingKobo: 0,
    };

    return {
      summary,
      ...paginate(result.data, total, page, limit),
    };
  }

  async getAdminStats() {
    const [
      totalChallenges,
      activeChallenges,
      totalReferrals,
      qualifiedReferrals,
    ] = await Promise.all([
      this.challengeModel.countDocuments(),
      this.challengeModel.countDocuments({ status: ChallengeStatus.ACTIVE }),
      this.referralModel.countDocuments(),
      this.referralModel.countDocuments({ status: ReferralStatus.QUALIFIED }),
    ]);

    return {
      totalChallenges,
      activeChallenges,
      totalReferrals,
      qualifiedReferrals,
      conversionRate:
        totalReferrals > 0
          ? Math.round((qualifiedReferrals / totalReferrals) * 10000) / 100
          : 0,
    };
  }

  /**
   * Get challenge detail with aggregated stats for admin
   */
  async getChallengeWithStats(id: string) {
    const challenge = await this.getChallengeById(id);
    const challengeObj = challenge.toJSON();

    const [totalReferrals, qualifiedReferrals, topReferrers] =
      await Promise.all([
        this.referralModel.countDocuments({ challengeId: challenge._id }),
        this.referralModel.countDocuments({
          challengeId: challenge._id,
          status: ReferralStatus.QUALIFIED,
        }),
        this.referralModel.aggregate([
          {
            $match: {
              challengeId: challenge._id,
              status: ReferralStatus.QUALIFIED,
            },
          },
          {
            $group: {
              _id: '$referrerId',
              qualifiedReferrals: { $sum: 1 },
            },
          },
          { $sort: { qualifiedReferrals: -1 } },
          { $limit: 1 },
          {
            $lookup: {
              from: 'users',
              localField: '_id',
              foreignField: '_id',
              as: 'user',
            },
          },
          { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        ]),
      ]);

    return {
      ...challengeObj,
      stats: {
        totalReferrals,
        qualifiedReferrals,
        topReferrer: topReferrers[0]
          ? {
              userId: topReferrers[0]._id,
              fullName: topReferrers[0].user?.fullName || 'Unknown',
              email: topReferrers[0].user?.email || '',
              qualifiedReferrals: topReferrers[0].qualifiedReferrals,
            }
          : null,
      },
    };
  }

  /**
   * Get full admin leaderboard with user details
   */
  async getAdminLeaderboard(
    challengeId: string,
    limit = 50,
  ) {
    return this.referralModel.aggregate([
      {
        $match: {
          challengeId: new Types.ObjectId(challengeId),
          status: ReferralStatus.QUALIFIED,
        },
      },
      {
        $group: {
          _id: '$referrerId',
          qualifiedReferrals: { $sum: 1 },
        },
      },
      { $sort: { qualifiedReferrals: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'referrals',
          let: { referrerId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$referrerId', '$$referrerId'] },
                    {
                      $eq: [
                        '$challengeId',
                        new Types.ObjectId(challengeId),
                      ],
                    },
                  ],
                },
              },
            },
            { $count: 'total' },
          ],
          as: 'totalReferrals',
        },
      },
      {
        $project: {
          rank: { $literal: 0 }, // will be set in JS
          userId: '$_id',
          fullName: '$user.fullName',
          email: '$user.email',
          qualifiedReferrals: 1,
          totalReferred: {
            $ifNull: [{ $arrayElemAt: ['$totalReferrals.total', 0] }, 0],
          },
        },
      },
    ]).then((results) =>
      results.map((r, i) => ({ ...r, rank: i + 1 })),
    );
  }

  // ═══════════════════════════════════════════════════════════
  // CRON: Auto-end expired challenges
  // ═══════════════════════════════════════════════════════════

  @Cron('0 * * * *') // Every hour
  async autoEndExpiredChallenges() {
    const now = new Date();
    const expired = await this.challengeModel.find({
      status: ChallengeStatus.ACTIVE,
      endsAt: { $lt: now },
    });

    for (const challenge of expired) {
      try {
        await this.endChallengeAndRewardWinners(
          challenge._id.toString(),
        );
        this.logger.log(
          `Auto-ended expired challenge: ${challenge._id} "${challenge.title}"`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to auto-end challenge ${challenge._id}: ${err.message}`,
        );
      }
    }
  }
}
