/**
 * Referral Challenge Schema
 *
 * Admin-created referral challenges with time limits,
 * reward amounts, and winner tracking.
 * All monetary amounts stored in kobo (1 NGN = 100 kobo).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReferralChallengeDocument = ReferralChallenge & Document;

export enum ChallengeStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ENDED = 'ENDED',
}

@Schema({ timestamps: true, collection: 'referral_challenges' })
export class ReferralChallenge {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ type: String, default: '' })
  description: string;

  /** Reward per winner in kobo */
  @Prop({ required: true })
  rewardAmountKobo: number;

  /** Number of winners to reward */
  @Prop({ required: true })
  numberOfWinners: number;

  /** How many qualified referrals a user needs */
  @Prop({ required: true })
  referralTarget: number;

  /** Minimum transaction amount (kobo) for a referral to qualify */
  @Prop({ required: true })
  minTransactionAmountKobo: number;

  /** Total budget = rewardAmountKobo × numberOfWinners */
  @Prop({ required: true })
  totalBudgetKobo: number;

  @Prop({ required: true })
  startsAt: Date;

  @Prop({ required: true })
  endsAt: Date;

  @Prop({
    type: String,
    enum: Object.values(ChallengeStatus),
    default: ChallengeStatus.DRAFT,
    index: true,
  })
  status: ChallengeStatus;

  @Prop({
    type: [
      {
        userId: { type: Types.ObjectId, ref: 'User' },
        qualifiedReferrals: Number,
        rewardedAt: Date,
        walletTransactionId: { type: Types.ObjectId, ref: 'WalletTransaction' },
      },
    ],
    default: [],
  })
  winners: {
    userId: Types.ObjectId;
    qualifiedReferrals: number;
    rewardedAt: Date;
    walletTransactionId: Types.ObjectId;
  }[];

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser' })
  updatedBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralChallengeSchema =
  SchemaFactory.createForClass(ReferralChallenge);

ReferralChallengeSchema.index({ status: 1, startsAt: 1, endsAt: 1 });
ReferralChallengeSchema.index({ createdAt: -1 });
