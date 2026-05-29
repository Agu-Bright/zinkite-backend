/**
 * Virtual Account Schema
 * Stores Paystack Dedicated Virtual Account (DVA) per user
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type VirtualAccountDocument = VirtualAccount & Document;

export enum VirtualAccountStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Schema({
  timestamps: true,
  collection: 'virtual_accounts',
  toJSON: {
    virtuals: true,
    transform: (_, ret: Record<string, any>) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class VirtualAccount {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  // Which provider issued this account ('paystack' | 'korapay')
  @Prop({ type: String, default: 'paystack' })
  provider: string;

  // ── Paystack-specific (legacy / fallback) ──
  @Prop({ type: String, default: null })
  paystackCustomerCode: string | null;

  @Prop({ type: Number, default: null })
  paystackDvaId: number | null;

  // ── Kora-specific ──
  @Prop({ type: String, default: null })
  korapayAccountReference: string | null;

  @Prop({ type: String, required: true })
  accountName: string;

  @Prop({ type: String, required: true, unique: true })
  accountNumber: string;

  @Prop({ type: String, required: true })
  bankName: string;

  @Prop({ type: String, default: null })
  bankCode: string | null;

  @Prop({ type: String, default: null })
  bankSlug: string | null;

  @Prop({
    type: String,
    enum: VirtualAccountStatus,
    default: VirtualAccountStatus.ACTIVE,
  })
  status: VirtualAccountStatus;

  @Prop({ type: Object, default: {} })
  meta: Record<string, any>;

  createdAt: Date;
  updatedAt: Date;
}

export const VirtualAccountSchema = SchemaFactory.createForClass(VirtualAccount);

VirtualAccountSchema.index({ userId: 1 }, { unique: true });
VirtualAccountSchema.index({ accountNumber: 1 }, { unique: true });
VirtualAccountSchema.index({ paystackCustomerCode: 1 });
VirtualAccountSchema.index({ korapayAccountReference: 1 });
