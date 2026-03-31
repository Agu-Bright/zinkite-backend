/**
 * OTP Schema
 * 
 * Stores OTP codes with expiration for various purposes.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OtpDocument = Otp & Document;

export enum OtpPurpose {
  EMAIL_VERIFICATION = 'EMAIL_VERIFICATION',
  PIN_RESET = 'PIN_RESET',
  PASSWORD_RESET = 'PASSWORD_RESET',
  ACCOUNT_DELETION = 'ACCOUNT_DELETION',
}

@Schema({
  timestamps: true,
  collection: 'otps',
})
export class Otp {
  /**
   * User ID (optional, can be null for pre-registration OTPs)
   */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  /**
   * Email associated with OTP
   */
  @Prop({ type: String, required: true, lowercase: true, index: true })
  email: string;

  /**
   * The OTP code (hashed for security)
   */
  @Prop({ type: String, required: true })
  codeHash: string;

  /**
   * Purpose of the OTP
   */
  @Prop({
    type: String,
    enum: Object.values(OtpPurpose),
    required: true,
  })
  purpose: OtpPurpose;

  /**
   * Expiration time
   */
  @Prop({ type: Date, required: true, index: true })
  expiresAt: Date;

  /**
   * Whether the OTP has been used
   */
  @Prop({ type: Boolean, default: false })
  isUsed: boolean;

  /**
   * Number of verification attempts
   */
  @Prop({ type: Number, default: 0 })
  attempts: number;

  /**
   * Timestamps
   */
  createdAt: Date;
  updatedAt: Date;
}

export const OtpSchema = SchemaFactory.createForClass(Otp);

// TTL index - automatically delete expired OTPs
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for lookups
OtpSchema.index({ email: 1, purpose: 1, isUsed: 1 });
