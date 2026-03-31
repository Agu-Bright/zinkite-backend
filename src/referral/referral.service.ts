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
import { Model, Connection, Types } from 'mongoose';
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
} from './dto';
import { paginate, calculateSkip } from '../common/utils/helpers';

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
  ) {}

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
      { $sort: { qualifiedReferrals: -1 } },
      { $limit: challenge.numberOfWinners },
    ]);

    const winners: typeof challenge.winners = [];

    for (const entry of leaderboard) {
      if (entry.qualifiedReferrals <= 0) continue;

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
  ): Promise<ReferralDocument> {
    // Find active challenge at time of signup
    const activeChallenge = await this.getActiveChallenge();

    const referral = new this.referralModel({
      referrerId,
      referredUserId,
      challengeId: activeChallenge?._id || null,
      referralCode,
      status: ReferralStatus.PENDING,
    });

    return referral.save();
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
    const referral = await this.referralModel.findOne({
      referredUserId: new Types.ObjectId(userId),
      status: ReferralStatus.PENDING,
    });

    if (!referral) return; // Not a referred user or already qualified

    // Determine minimum transaction amount
    let minAmount = 50000; // Default ₦500 in kobo
    if (referral.challengeId) {
      const challenge = await this.challengeModel.findById(
        referral.challengeId,
      );
      if (challenge) {
        minAmount = challenge.minTransactionAmountKobo;
      }
    }

    if (transactionAmountKobo < minAmount) return;

    // Qualify the referral
    referral.status = ReferralStatus.QUALIFIED;
    referral.qualifiedAt = new Date();
    referral.qualifyingTransactionId = transactionId || null;
    await referral.save();

    this.logger.log(
      `Referral qualified: user ${userId}, referrer ${referral.referrerId}`,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // USER-FACING QUERIES
  // ═══════════════════════════════════════════════════════════

  /**
   * Get currently active challenge (there should be at most one)
   */
  async getActiveChallenge(): Promise<ReferralChallengeDocument | null> {
    const now = new Date();
    return this.challengeModel
      .findOne({
        status: ChallengeStatus.ACTIVE,
        startsAt: { $lte: now },
        endsAt: { $gte: now },
      })
      .exec();
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
