/**
 * Referral Schema
 *
 * One record per "referrer → referred user" relationship.
 * A referral starts PENDING at signup and becomes EARNED (points awarded to
 * the referrer) once the referred user completes a successful transaction.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReferralDocument = Referral & Document;

export enum ReferralStatus {
  /** Referred user signed up but has not transacted yet. No points awarded. */
  PENDING = 'PENDING',
  /** Referred user transacted; points have been awarded to the referrer. */
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
    default: ReferralStatus.PENDING,
    index: true,
  })
  status: ReferralStatus;

  /** Points awarded to the referrer when this referral qualified (0 until then). */
  @Prop({ type: Number, default: 0 })
  pointsAwarded: number;

  /** When the referred user completed the qualifying transaction. */
  @Prop({ type: Date, default: null })
  qualifiedAt: Date | null;

  /** The transaction that qualified this referral. */
  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction', default: null })
  qualifyingTransactionId: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);

// A given user can only ever be referred once.
ReferralSchema.index({ referredUserId: 1 }, { unique: true });
ReferralSchema.index({ referrerId: 1, status: 1 });
ReferralSchema.index({ referralCode: 1 });
