/**
 * Referral Schema
 *
 * Tracks individual referral relationships: who referred whom,
 * which challenge it counts toward, and qualification status.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReferralDocument = Referral & Document;

export enum ReferralStatus {
  PENDING = 'PENDING',
  QUALIFIED = 'QUALIFIED',
  EXPIRED = 'EXPIRED',
}

@Schema({ timestamps: true, collection: 'referrals' })
export class Referral {
  /** The user who shared the referral code */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  referrerId: Types.ObjectId;

  /** The new user who signed up with the code */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  referredUserId: Types.ObjectId;

  /** Challenge active at time of signup (null if no active challenge) */
  @Prop({ type: Types.ObjectId, ref: 'ReferralChallenge', default: null })
  challengeId: Types.ObjectId | null;

  /** The referral code that was used */
  @Prop({ required: true })
  referralCode: string;

  @Prop({
    type: String,
    enum: Object.values(ReferralStatus),
    default: ReferralStatus.PENDING,
    index: true,
  })
  status: ReferralStatus;

  /** When the referred user met the min transaction requirement */
  @Prop({ type: Date, default: null })
  qualifiedAt: Date | null;

  /** The transaction that qualified this referral */
  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction', default: null })
  qualifyingTransactionId: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);

ReferralSchema.index({ referredUserId: 1 }, { unique: true });
ReferralSchema.index({ referrerId: 1, challengeId: 1 });
ReferralSchema.index({ referralCode: 1 });
ReferralSchema.index({ status: 1 });
