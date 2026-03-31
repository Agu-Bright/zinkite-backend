/**
 * Wallet Schema
 * 
 * User wallet for storing balance.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WalletDocument = Wallet & Document;

export enum WalletStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
  CLOSED = 'CLOSED',
}

@Schema({
  timestamps: true,
  collection: 'wallets',
})
export class Wallet {
  /**
   * User ID (one wallet per user)
   */
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId: Types.ObjectId;

  /**
   * Current balance (in smallest unit, e.g., kobo)
   */
  @Prop({ type: Number, default: 0, min: 0 })
  balance: number;

  /**
   * Currency code
   */
  @Prop({ type: String, default: 'NGN' })
  currency: string;

  /**
   * Wallet status
   */
  @Prop({
    type: String,
    enum: Object.values(WalletStatus),
    default: WalletStatus.ACTIVE,
  })
  status: WalletStatus;

  /**
   * Last transaction timestamp
   */
  @Prop({ type: Date })
  lastTransactionAt?: Date;

  /**
   * Timestamps
   */
  createdAt: Date;
  updatedAt: Date;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);

// Ensure one wallet per user
WalletSchema.index({ userId: 1 }, { unique: true });
