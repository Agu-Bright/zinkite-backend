/**
 * Referral Schema
 *
 * One record per "referrer → referred user" relationship. Points are awarded
 * to the referrer immediately when the referred user signs up with their code.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReferralDocument = Referral & Document;

export enum ReferralStatus {
  /** Points have been awarded to the referrer. */
  EARNED = 'EARNED',
  /** Reversed (e.g. fraud / referred account deleted). */
  REVERSED = 'REVERSED',
}

@Schema({ timestamps: true, collection: 'referrals' })
export class Referral {
  /** The user who shared the referral code (receives the points). */
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
    default: ReferralStatus.EARNED,
    index: true,
  })
  status: ReferralStatus;

  /** Points awarded to the referrer for this referral (snapshot at signup). */
  @Prop({ type: Number, default: 0 })
  pointsAwarded: number;

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);

// A given user can only ever be referred once.
ReferralSchema.index({ referredUserId: 1 }, { unique: true });
ReferralSchema.index({ referrerId: 1, createdAt: -1 });
ReferralSchema.index({ referralCode: 1 });
