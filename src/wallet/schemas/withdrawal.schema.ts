/**
 * Withdrawal Schema
 *
 * Tracks every withdrawal from initiation through Paystack transfer to completion.
 *
 * Status lifecycle (driven by Paystack Transfer webhooks):
 *   PENDING    → transfer created, waiting for Paystack to process
 *   PROCESSING → Paystack is sending the money (OTP confirmed if applicable)
 *   SUCCESS    → transfer.success webhook received — money landed
 *   FAILED     → transfer.failed webhook received — wallet auto-refunded
 *   REVERSED   → transfer.reversed webhook received — wallet auto-refunded
 */
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { ApiProperty } from "@nestjs/swagger";

export type WithdrawalDocument = Withdrawal & Document;

export enum WithdrawalStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  REVERSED = "REVERSED",
}

@Schema({
  timestamps: true,
  collection: "withdrawals",
  toJSON: {
    virtuals: true,
    transform: (_: any, ret: Record<string, any>) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Withdrawal {
  @ApiProperty()
  @Prop({ type: Types.ObjectId, ref: "User", required: true, index: true })
  userId: Types.ObjectId;

  @ApiProperty()
  @Prop({ type: Types.ObjectId, ref: "Wallet", required: true })
  walletId: Types.ObjectId;

  /** Amount in kobo */
  @ApiProperty({ example: 500000 })
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @ApiProperty({ example: "NGN" })
  @Prop({ type: String, default: "NGN" })
  currency: string;

  /** Our internal unique reference */
  @ApiProperty({ example: "WDR_ABC123_XYZ" })
  @Prop({ type: String, required: true, unique: true, index: true })
  reference: string;

  @ApiProperty({ enum: Object.values(WithdrawalStatus) })
  @Prop({
    type: String,
    enum: Object.values(WithdrawalStatus),
    default: WithdrawalStatus.PENDING,
    index: true,
  })
  status: WithdrawalStatus;

  // ── Bank snapshot at time of withdrawal ──
  @Prop({ type: String, required: true })
  bankName: string;

  @Prop({ type: String, required: true })
  bankCode: string;

  @Prop({ type: String, required: true })
  accountNumber: string;

  @Prop({ type: String, required: true })
  accountName: string;

  // ── Paystack transfer fields ──
  @ApiProperty({ description: "Paystack transfer recipient code" })
  @Prop({ type: String, required: true })
  paystackRecipientCode: string;

  @ApiProperty({ description: "Paystack transfer code returned by /transfer" })
  @Prop({ type: String, default: null })
  paystackTransferCode: string | null;

  @ApiProperty({ description: "Paystack transfer ID (numeric)" })
  @Prop({ type: Number, default: null })
  paystackTransferId: number | null;

  @ApiProperty({ description: "Failure / reversal reason from Paystack" })
  @Prop({ type: String, default: null })
  failureReason: string | null;

  @ApiProperty({ description: "Wallet debit transaction reference" })
  @Prop({ type: String, default: null })
  walletTransactionReference: string | null;

  @ApiProperty({ description: "Raw Paystack webhook event for audit" })
  @Prop({ type: Object, default: null })
  rawWebhookEvent: Record<string, any> | null;

  @ApiProperty({
    description: "When the transfer completed (success/fail/reverse)",
  })
  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const WithdrawalSchema = SchemaFactory.createForClass(Withdrawal);
WithdrawalSchema.index({ userId: 1, createdAt: -1 });
WithdrawalSchema.index({ status: 1, createdAt: -1 });
WithdrawalSchema.index({ reference: 1 }, { unique: true });
WithdrawalSchema.index({ paystackTransferCode: 1 }, { sparse: true });
