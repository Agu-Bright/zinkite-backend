/**
 * Referral Schema
 *
 * One record per "referrer → referred user" relationship. At signup BOTH the
 * referrer and the referee receive a bonus, held LOCKED. The bonuses unlock
 * for both once the referee's cumulative transactions reach the admin-set
 * threshold (snapshotted here so later setting changes don't affect in-flight
 * referrals).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReferralDocument = Referral & Document;

export enum ReferralStatus {
  /** Bonuses granted but locked — referee hasn't transacted enough yet. */
  LOCKED = 'LOCKED',
  /** Threshold met — bonuses released to both parties. */
  UNLOCKED = 'UNLOCKED',
  /** Reversed (e.g. fraud / referred account deleted). */
  REVERSED = 'REVERSED',
}

@Schema({ timestamps: true, collection: 'referrals' })
export class Referral {
  /** The user who shared the referral code. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  referrerId: Types.ObjectId;

  /** The new user who signed up with the code. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  referredUserId: Types.ObjectId;

  /** The referral code that was used. */
  @Prop({ required: true })
  referralCode: string;

  @Prop({
    type: String,
    enum: Object.values(ReferralStatus),
    default: ReferralStatus.LOCKED,
    index: true,
  })
  status: ReferralStatus;

  /** Points granted to the referrer for this referral. */
  @Prop({ type: Number, default: 0 })
  referrerPoints: number;

  /** Points granted to the referee (the new user). */
  @Prop({ type: Number, default: 0 })
  refereePoints: number;

  /** Cumulative value (kobo) the referee has transacted toward unlocking. */
  @Prop({ type: Number, default: 0 })
  refereeTxnTotalKobo: number;

  /** Threshold (kobo) the referee must transact to unlock both bonuses. */
  @Prop({ type: Number, default: 0 })
  unlockThresholdKobo: number;

  /** When the bonuses unlocked. */
  @Prop({ type: Date, default: null })
  unlockedAt: Date | null;

  /** Whether the referee has seen their "you earned a reward" celebration. */
  @Prop({ type: Boolean, default: false })
  refereeAcknowledged: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);

// A given user can only ever be referred once.
ReferralSchema.index({ referredUserId: 1 }, { unique: true });
ReferralSchema.index({ referrerId: 1, status: 1 });
ReferralSchema.index({ referralCode: 1 });
