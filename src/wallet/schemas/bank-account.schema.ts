/**
 * Bank Account Schema
 *
 * Stores user bank account details for withdrawals.
 * When a bank account is saved/verified, a Paystack Transfer Recipient
 * is created automatically so transfers can be initiated instantly.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type BankAccountDocument = BankAccount & Document;

@Schema({
  timestamps: true,
  collection: 'bank_accounts',
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
export class BankAccount {
  @ApiProperty({ description: 'User ID' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId: Types.ObjectId;

  @ApiProperty({ description: 'Bank name', example: 'Access Bank' })
  @Prop({ type: String, required: true, trim: true })
  bankName: string;

  @ApiProperty({ description: 'Bank code (CBN code for Paystack)', example: '044' })
  @Prop({ type: String, required: true, trim: true })
  bankCode: string;

  @ApiProperty({ description: '10-digit account number', example: '0123456789' })
  @Prop({ type: String, required: true, trim: true })
  accountNumber: string;

  @ApiProperty({ description: 'Account holder name (from Paystack verification)', example: 'JOHN DOE' })
  @Prop({ type: String, required: true, trim: true })
  accountName: string;

  @ApiProperty({ description: 'Paystack transfer recipient code — required for initiating transfers' })
  @Prop({ type: String, default: null })
  paystackRecipientCode: string | null;

  @ApiProperty({ description: 'Whether account name was verified via Paystack Resolve' })
  @Prop({ type: Boolean, default: false })
  isVerified: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);
BankAccountSchema.index({ userId: 1 }, { unique: true });