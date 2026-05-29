// src/otp/otp.service.ts
/**
 * OTP Service
 * 
 * Generates, stores, and validates OTP codes.
 */
import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Otp, OtpDocument, OtpPurpose } from './schemas/otp.schema';
import { generateOtp } from '../common/utils/helpers';

const SALT_ROUNDS = 10;
const MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly otpExpiryMinutes: number;
  private readonly otpLength: number;
  private readonly isDevelopment: boolean;

  constructor(
    @InjectModel(Otp.name) private readonly otpModel: Model<OtpDocument>,
    private readonly configService: ConfigService,
  ) {
    this.otpExpiryMinutes = this.configService.get<number>(
      'OTP_EXPIRY_MINUTES',
      10,
    );
    this.otpLength = this.configService.get<number>('OTP_LENGTH', 6);
    this.isDevelopment = this.configService.get<string>('NODE_ENV') !== 'production';
  }

  /**
   * Generate and store a new OTP
   */
  async generate(
    email: string,
    purpose: OtpPurpose,
    userId?: Types.ObjectId | string,
  ): Promise<string> {
    const normalizedEmail = email.toLowerCase();

    // Invalidate any existing OTPs for this email and purpose
    await this.otpModel.updateMany(
      { email: normalizedEmail, purpose, isUsed: false },
      { isUsed: true },
    );

    // Generate OTP code
    const code = generateOtp(this.otpLength);
    const codeHash = await bcrypt.hash(code, SALT_ROUNDS);

    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.otpExpiryMinutes);

    // Store OTP
    const otp = new this.otpModel({
      userId: userId ? new Types.ObjectId(userId) : undefined,
      email: normalizedEmail,
      codeHash,
      purpose,
      expiresAt,
      isUsed: false,
      attempts: 0,
    });

    await otp.save();
    this.logger.log(`OTP generated for ${normalizedEmail} (${purpose})`);

    // ============================================
    // 🔐 LOG OTP TO CONSOLE (always, for monitoring)
    this.logOtpToConsole(normalizedEmail, code, purpose, expiresAt);

    return code;
  }

  /**
   * Log OTP to console for development/testing
   */
  private logOtpToConsole(
    email: string,
    code: string,
    purpose: OtpPurpose,
    expiresAt: Date,
  ): void {
    const expiresIn = Math.round((expiresAt.getTime() - Date.now()) / 60000);
    
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                  🔐 OTP CODE FOR TESTING                 ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  📧 Email:    ${email.padEnd(42)}║`);
    console.log(`║  🎯 Purpose:  ${purpose.padEnd(42)}║`);
    console.log(`║  🔑 Code:     ${code.padEnd(42)}║`);
    console.log(`║  ⏰ Expires:  ${expiresIn} minutes (${expiresAt.toLocaleTimeString()})`.padEnd(60) + '║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  ⚠️  This is logged because email is not configured      ║');
    console.log('║  ⚠️  Remove in production or configure SMTP properly     ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('\n');

    // Also log a simple version for easy copying
    this.logger.warn(`🔐 DEV OTP: ${code} for ${email} (${purpose})`);
  }

  /**
   * Verify an OTP code
   */
  async verify(
    email: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<boolean> {
    const normalizedEmail = email.toLowerCase();

    // Find the most recent valid OTP
    const otp = await this.otpModel
      .findOne({
        email: normalizedEmail,
        purpose,
        isUsed: false,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .exec();

    if (!otp) {
      this.logger.warn(`OTP verification failed for ${normalizedEmail}: No valid OTP found`);
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Check max attempts
    if (otp.attempts >= MAX_ATTEMPTS) {
      otp.isUsed = true;
      await otp.save();
      this.logger.warn(`OTP verification failed for ${normalizedEmail}: Too many attempts`);
      throw new BadRequestException(
        'Too many failed attempts. Please request a new OTP.',
      );
    }

    // Verify code
    const isValid = await bcrypt.compare(code, otp.codeHash);

    if (!isValid) {
      // Increment attempts
      otp.attempts += 1;
      await otp.save();
      this.logger.warn(`OTP verification failed for ${normalizedEmail}: Invalid code (attempt ${otp.attempts}/${MAX_ATTEMPTS})`);
      throw new BadRequestException('Invalid OTP code');
    }

    // Mark as used
    otp.isUsed = true;
    await otp.save();

    this.logger.log(`✅ OTP verified successfully for ${normalizedEmail} (${purpose})`);
    return true;
  }

  /**
   * Check if a valid OTP exists (without verifying)
   */
  async hasValidOtp(email: string, purpose: OtpPurpose): Promise<boolean> {
    const count = await this.otpModel.countDocuments({
      email: email.toLowerCase(),
      purpose,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    });
    return count > 0;
  }

  /**
   * Get time (ms) since the last OTP was created for rate limiting.
   * Returns null if no active OTP exists.
   */
  async getTimeSinceLastOtp(
    email: string,
    purpose: OtpPurpose,
  ): Promise<number | null> {
    const otp = await this.otpModel
      .findOne({
        email: email.toLowerCase(),
        purpose,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .exec();

    if (!otp) {
      return null;
    }

    return Date.now() - otp.createdAt.getTime();
  }

  /**
   * Get time until OTP expires (for rate limiting)
   */
  async getTimeUntilExpiry(
    email: string,
    purpose: OtpPurpose,
  ): Promise<number | null> {
    const otp = await this.otpModel
      .findOne({
        email: email.toLowerCase(),
        purpose,
        isUsed: false,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .select('expiresAt')
      .exec();

    if (!otp) {
      return null;
    }

    return Math.max(0, otp.expiresAt.getTime() - Date.now());
  }

  /**
   * Clean up expired OTPs (called by cron or manually)
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpired(): Promise<number> {
    const result = await this.otpModel.deleteMany({
      expiresAt: { $lt: new Date() },
    });
    this.logger.log(`Cleaned up ${result.deletedCount} expired OTPs`);
    return result.deletedCount;
  }
}
