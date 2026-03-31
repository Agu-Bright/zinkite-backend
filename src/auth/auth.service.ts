/**
 * Auth Service
 *
 * Handles authentication logic including:
 * - Email registration and verification
 * - Login and JWT token management
 * - Transaction PIN management
 * - Social authentication (Google/Apple)
 */
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection, Types } from "mongoose";
import { UsersService } from "../users/users.service";
import { WalletService } from "../wallet/wallet.service";
import { OtpService } from "../otp/otp.service";
import { EmailService } from "../email/email.service";
import { SocialAuthService } from "./social-auth.service";
import { ReferralService } from "../referral/referral.service";
import { OtpPurpose } from "../otp/schemas/otp.schema";
import { AuthProvider } from "../users/schemas/auth-provider-account.schema";
import { JwtPayload } from "./strategies/jwt.strategy";
import {
  RegisterDto,
  LoginDto,
  VerifyEmailDto,
  SetPinDto,
  ResetPinConfirmDto,
  ForgotPasswordConfirmDto,
  GoogleAuthDto,
  AppleAuthDto,
  CompleteProfileDto,
  ChangePasswordDto,
  RequestAccountDeletionDto,
  ConfirmAccountDeletionDto,
  LoginResponse,
  AuthTokensResponse,
} from "./dto";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTokenExpirySeconds: number;
  private readonly refreshTokenExpirySeconds: number;
  private readonly refreshTokenSecret: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
    private readonly socialAuthService: SocialAuthService,
    private readonly referralService: ReferralService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectConnection() private readonly connection: Connection,
  ) {
    // Parse expiry times to seconds (default: 15m for access, 7d for refresh)
    this.accessTokenExpirySeconds = this.parseExpiryToSecondsInit(
      this.configService.get<string>("JWT_ACCESS_EXPIRES_IN", "15m"),
    );
    this.refreshTokenExpirySeconds = this.parseExpiryToSecondsInit(
      this.configService.get<string>("JWT_REFRESH_EXPIRES_IN", "7d"),
    );
    this.refreshTokenSecret = this.configService.get<string>(
      "JWT_REFRESH_SECRET",
      "",
    );
  }

  /**
   * Parse expiry string to seconds (used in constructor)
   */
  private parseExpiryToSecondsInit(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 900; // Default 15 minutes
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 3600;
      case "d":
        return value * 86400;
      default:
        return 900;
    }
  }

  // =====================
  // Email Registration
  // =====================

  /**
   * Register a new user with email and password
   */
  /**
   * Generate a unique referral code for new users
   */
  private generateReferralCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `PAY-${code}`;
  }

  async register(
    dto: RegisterDto,
  ): Promise<{ message: string; userId: string }> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      // Resolve referrer if referral code provided
      let referredBy: Types.ObjectId | undefined;
      if (dto.referralCode) {
        const referrer = await this.usersService.findByReferralCode(
          dto.referralCode,
        );
        if (referrer) {
          referredBy = referrer._id;
        }
      }

      // Generate unique referral code for new user
      const referralCode = this.generateReferralCode();

      // Create user
      const user = await this.usersService.create(
        {
          email: dto.email,
          phone: dto.phone,
          password: dto.password,
          fullName: dto.fullName,
          isEmailVerified: false,
          referralCode,
          referredBy,
        },
        session,
      );

      // Create wallet for user
      await this.walletService.createWallet(user._id, session);

      // Create referral record if user was referred
      if (referredBy && dto.referralCode) {
        this.referralService
          .createReferral(referredBy, user._id, dto.referralCode)
          .catch((err) => {
            this.logger.error(`Failed to create referral record: ${err.message}`);
          });
      }

      // Generate and send OTP
      const otp = await this.otpService.generate(
        dto.email,
        OtpPurpose.EMAIL_VERIFICATION,
        user._id,
      );

      // Send verification email (don't fail registration if email fails)
      this.emailService.sendVerificationOtp(dto.email, otp).catch((err) => {
        this.logger.error(`Failed to send verification email: ${err.message}`);
      });

      await session.commitTransaction();

      this.logger.log(`User registered: ${user._id}`);

      return {
        message: "Registration successful. Please verify your email.",
        userId: user._id.toString(),
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // =====================
  // Email Verification
  // =====================

  /**
   * Verify email with OTP
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<{ message: string }> {
    // Verify OTP
    await this.otpService.verify(
      dto.email,
      dto.otp,
      OtpPurpose.EMAIL_VERIFICATION,
    );

    // Find user and mark as verified
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException("User not found");
    }

    if (user.isEmailVerified) {
      return { message: "Email already verified" };
    }

    await this.usersService.markEmailVerified(user._id);

    this.logger.log(`Email verified for user: ${user._id}`);

    return { message: "Email verified successfully" };
  }

  /**
   * Resend verification OTP
   */
  async resendOtp(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new BadRequestException("User not found");
    }

    if (user.isEmailVerified) {
      throw new BadRequestException("Email already verified");
    }

    // Check rate limiting — block if OTP was sent less than 60 seconds ago
    const timeSinceLastOtp = await this.otpService.getTimeSinceLastOtp(
      email,
      OtpPurpose.EMAIL_VERIFICATION,
    );
    if (timeSinceLastOtp !== null && timeSinceLastOtp < 60000) {
      throw new BadRequestException("Please wait before requesting a new OTP");
    }

    // Generate and send new OTP
    const otp = await this.otpService.generate(
      email,
      OtpPurpose.EMAIL_VERIFICATION,
      user._id,
    );
    console.log("otp", otp);

    await this.emailService.sendVerificationOtp(email, otp);

    return { message: "Verification code sent" };
  }

  // =====================
  // Login
  // =====================

  /**
   * Login with email and password
   */
  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // Check if user has password (social auth users may not)
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        "This account uses social sign-in. Please use Google or Apple to sign in.",
      );
    }

    // Verify password
    const isPasswordValid = await this.usersService.validatePassword(
      user,
      dto.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // Check email verification
    if (!user.isEmailVerified) {
      throw new UnauthorizedException(
        "Please verify your email before logging in",
      );
    }

    // Check account status
    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException("Account is not active");
    }

    // Generate tokens
    const tokens = await this.generateTokens(
      user._id.toString(),
      user.email,
      user.roles,
    );

    // Check if PIN is set
    const hasPinSet = await this.usersService.hasPinSet(user._id);

    this.logger.log(`User logged in: ${user._id}`);

    return {
      ...tokens,
      userId: user._id.toString(),
      pinSetupRequired: !hasPinSet,
      needsPhone: !user.phone,
      needsEmail: false,
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<AuthTokensResponse> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.refreshTokenSecret,
      });

      const user = await this.usersService.findById(payload.sub);
      if (!user || user.status !== "ACTIVE") {
        throw new UnauthorizedException("User not found or inactive");
      }

      return this.generateTokens(user._id.toString(), user.email, user.roles);
    } catch (error) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
  }

  // =====================
  // Transaction PIN
  // =====================

  /**
   * Set transaction PIN (first time)
   */
  async setPin(userId: string, dto: SetPinDto): Promise<{ message: string }> {
    if (dto.pin !== dto.confirmPin) {
      throw new BadRequestException("PINs do not match");
    }

    const hasPinSet = await this.usersService.hasPinSet(userId);
    if (hasPinSet) {
      throw new BadRequestException(
        "PIN already set. Use reset PIN to change it.",
      );
    }

    await this.usersService.setTransactionPin(userId, dto.pin);

    return { message: "Transaction PIN set successfully" };
  }

  /**
   * Verify transaction PIN
   */
  async verifyPin(userId: string, pin: string): Promise<{ valid: boolean }> {
    const isValid = await this.usersService.verifyTransactionPin(userId, pin);
    return { valid: isValid };
  }

  /**
   * Request PIN reset OTP
   */
  async requestPinReset(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists
      return { message: "If the email exists, a reset code has been sent" };
    }

    const otp = await this.otpService.generate(
      email,
      OtpPurpose.PIN_RESET,
      user._id,
    );

    await this.emailService.sendPinResetOtp(email, otp);

    return { message: "If the email exists, a reset code has been sent" };
  }

  /**
   * Confirm PIN reset with OTP
   */
  async confirmPinReset(dto: ResetPinConfirmDto): Promise<{ message: string }> {
    // Verify OTP
    await this.otpService.verify(dto.email, dto.otp, OtpPurpose.PIN_RESET);

    // Find user and update PIN
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException("User not found");
    }

    await this.usersService.setTransactionPin(user._id, dto.newPin);

    this.logger.log(`PIN reset for user: ${user._id}`);

    return { message: "Transaction PIN reset successfully" };
  }

  // =====================
  // Password Reset (Forgot Password)
  // =====================

  /**
   * Request password reset OTP
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists
      return { message: "If the email exists, a reset code has been sent" };
    }

    const otp = await this.otpService.generate(
      email,
      OtpPurpose.PASSWORD_RESET,
      user._id,
    );

    await this.emailService.sendPasswordResetOtp(email, otp);

    return { message: "If the email exists, a reset code has been sent" };
  }

  /**
   * Confirm password reset with OTP
   */
  async confirmPasswordReset(
    dto: ForgotPasswordConfirmDto,
  ): Promise<{ message: string }> {
    // Verify OTP
    await this.otpService.verify(
      dto.email,
      dto.otp,
      OtpPurpose.PASSWORD_RESET,
    );

    // Find user and update password
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException("User not found");
    }

    await this.usersService.updatePassword(user._id, dto.newPassword);

    this.logger.log(`Password reset for user: ${user._id}`);

    return { message: "Password reset successfully" };
  }

  // =====================
  // Social Authentication
  // =====================

  /**
   * Authenticate with Google
   */
  async googleAuth(dto: GoogleAuthDto): Promise<LoginResponse> {
    // Verify Google token
    const googleUser = await this.socialAuthService.verifyGoogleToken(
      dto.idToken,
    );

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      // Check if provider account exists
      let user = await this.usersService.findByProviderAccount(
        AuthProvider.GOOGLE,
        googleUser.sub,
      );

      if (!user) {
        // Check if email is already registered
        user = await this.usersService.findByEmail(googleUser.email);

        if (user) {
          // Link Google account to existing user
          await this.usersService.linkProviderAccount(
            user._id,
            {
              provider: AuthProvider.GOOGLE,
              providerUserId: googleUser.sub,
              email: googleUser.email,
              profileData: {
                name: googleUser.name,
                picture: googleUser.picture,
              },
            },
            session,
          );
        } else {
          // Create new user
          user = await this.usersService.create(
            {
              email: googleUser.email,
              fullName: googleUser.name,
              avatarUrl: googleUser.picture,
              isEmailVerified: googleUser.emailVerified,
            },
            session,
          );

          // Create provider account
          await this.usersService.createProviderAccount(
            {
              userId: user._id,
              provider: AuthProvider.GOOGLE,
              providerUserId: googleUser.sub,
              email: googleUser.email,
              profileData: {
                name: googleUser.name,
                picture: googleUser.picture,
              },
            },
            session,
          );

          // Create wallet
          await this.walletService.createWallet(user._id, session);
        }
      }

      await session.commitTransaction();

      // Generate tokens
      const tokens = await this.generateTokens(
        user._id.toString(),
        user.email,
        user.roles,
      );

      const hasPinSet = await this.usersService.hasPinSet(user._id);

      this.logger.log(`Google auth successful for user: ${user._id}`);

      return {
        ...tokens,
        userId: user._id.toString(),
        pinSetupRequired: !hasPinSet,
        needsPhone: !user.phone,
        needsEmail: false,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Authenticate with Apple
   */
  async appleAuth(dto: AppleAuthDto): Promise<LoginResponse> {
    // Verify Apple token
    const appleUser = await this.socialAuthService.verifyAppleToken(
      dto.identityToken,
      dto.nonce,
    );

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      // Check if provider account exists
      let user = await this.usersService.findByProviderAccount(
        AuthProvider.APPLE,
        appleUser.sub,
      );

      let needsEmail = false;

      if (!user) {
        // Check if email is available and already registered
        if (appleUser.email) {
          user = await this.usersService.findByEmail(appleUser.email);

          if (user) {
            // Link Apple account to existing user
            await this.usersService.linkProviderAccount(
              user._id,
              {
                provider: AuthProvider.APPLE,
                providerUserId: appleUser.sub,
                email: appleUser.email,
                profileData: {
                  isPrivateEmail: appleUser.isPrivateEmail,
                },
              },
              session,
            );
          }
        }

        if (!user) {
          // Create new user
          if (!appleUser.email) {
            // Apple hid email, user needs to provide one later
            needsEmail = true;
          }

          user = await this.usersService.create(
            {
              email: appleUser.email || undefined,
              fullName: dto.fullName || undefined,
              isEmailVerified: appleUser.emailVerified,
            },
            session,
          );

          // Create provider account
          await this.usersService.createProviderAccount(
            {
              userId: user._id,
              provider: AuthProvider.APPLE,
              providerUserId: appleUser.sub,
              email: appleUser.email,
              profileData: {
                isPrivateEmail: appleUser.isPrivateEmail,
                fullName: dto.fullName,
              },
            },
            session,
          );

          // Create wallet
          await this.walletService.createWallet(user._id, session);
        }
      }

      await session.commitTransaction();

      // Generate tokens
      const tokens = await this.generateTokens(
        user._id.toString(),
        user.email,
        user.roles,
      );

      const hasPinSet = await this.usersService.hasPinSet(user._id);

      this.logger.log(`Apple auth successful for user: ${user._id}`);

      return {
        ...tokens,
        userId: user._id.toString(),
        pinSetupRequired: !hasPinSet,
        needsPhone: !user.phone,
        needsEmail: needsEmail || !user.email,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Complete user profile (for social auth users missing data)
   */
  async completeProfile(
    userId: string,
    dto: CompleteProfileDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException("User not found");
    }

    const updates: any = {};

    // Update phone if provided and missing
    if (dto.phone && !user.phone) {
      // Check if phone is already in use
      const existingPhone = await this.usersService.findByPhone(dto.phone);
      if (existingPhone) {
        throw new ConflictException("Phone number already in use");
      }
      updates.phone = dto.phone;
    }

    // Update email if provided and missing
    if (dto.email && !user.email) {
      // Check if email is already in use
      const existingEmail = await this.usersService.findByEmail(dto.email);
      if (existingEmail) {
        throw new ConflictException("Email already in use");
      }
      updates.email = dto.email;
      updates.isEmailVerified = false; // Require verification for new email
    }

    // Update full name if provided
    if (dto.fullName) {
      updates.fullName = dto.fullName;
    }

    // Update avatar URL if provided
    if (dto.avatarUrl) {
      updates.avatarUrl = dto.avatarUrl;
    }

    if (Object.keys(updates).length > 0) {
      await this.usersService.update(userId, updates);
    }

    return { message: "Profile updated successfully" };
  }

  async getProfile(userId: string) {
    this.logger.log(`Getting profile for user: ${userId}`);

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return {
      _id: user._id,
      id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      isEmailVerified: user.isEmailVerified,
      hasPinSet: !!user.transactionPinHash,
      roles: user.roles,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // =====================
  // Change Password
  // =====================

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException("User not found");
    }

    if (!user.passwordHash) {
      throw new BadRequestException(
        "This account uses social sign-in and has no password to change",
      );
    }

    const isValid = await this.usersService.validatePassword(
      user,
      dto.currentPassword,
    );
    if (!isValid) {
      throw new BadRequestException("Current password is incorrect");
    }

    await this.usersService.updatePassword(userId, dto.newPassword);

    this.logger.log(`Password changed for user: ${userId}`);

    return { message: "Password changed successfully" };
  }

  // =====================
  // Account Deletion
  // =====================

  /**
   * Request account deletion — sends OTP to verify email ownership
   */
  async requestAccountDeletion(
    dto: RequestAccountDeletionDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      // Don't reveal if email exists
      return {
        message:
          "If an account with that email exists, a verification code has been sent.",
      };
    }

    if (user.isDeleted) {
      return {
        message:
          "If an account with that email exists, a verification code has been sent.",
      };
    }

    // Rate limiting — block if OTP was sent less than 60 seconds ago
    const timeSinceLastOtp = await this.otpService.getTimeSinceLastOtp(
      dto.email,
      OtpPurpose.ACCOUNT_DELETION,
    );
    if (timeSinceLastOtp !== null && timeSinceLastOtp < 60000) {
      throw new BadRequestException(
        "Please wait before requesting a new code",
      );
    }

    const otp = await this.otpService.generate(
      dto.email,
      OtpPurpose.ACCOUNT_DELETION,
      user._id,
    );

    await this.emailService.sendAccountDeletionOtp(dto.email, otp);

    this.logger.log(`Account deletion requested for user: ${user._id}`);

    return {
      message:
        "If an account with that email exists, a verification code has been sent.",
    };
  }

  /**
   * Confirm account deletion with OTP — permanently soft-deletes the user
   */
  async confirmAccountDeletion(
    dto: ConfirmAccountDeletionDto,
  ): Promise<{ message: string }> {
    // Verify OTP
    await this.otpService.verify(
      dto.email,
      dto.otp,
      OtpPurpose.ACCOUNT_DELETION,
    );

    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException("User not found");
    }

    if (user.isDeleted) {
      throw new BadRequestException("Account already deleted");
    }

    // Perform soft-delete in a transaction
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      await this.usersService.softDeleteUser(user._id, session);
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

    // Send confirmation email (to original email, before anonymization)
    this.emailService
      .sendAccountDeletionConfirmation(dto.email)
      .catch((err) => {
        this.logger.error(
          `Failed to send deletion confirmation email: ${err.message}`,
        );
      });

    this.logger.log(`Account deleted for user: ${user._id}`);

    return {
      message:
        "Your account and all associated data have been permanently deleted.",
    };
  }

  // =====================
  // Token Generation
  // =====================

  /**
   * Generate access and refresh tokens
   */
  private async generateTokens(
    userId: string,
    email?: string,
    roles: string[] = [],
  ): Promise<AuthTokensResponse> {
    const payload: JwtPayload = {
      sub: userId,
      email,
      roles,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        expiresIn: this.accessTokenExpirySeconds,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.refreshTokenSecret,
        expiresIn: this.refreshTokenExpirySeconds,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.accessTokenExpirySeconds,
    };
  }

  /**
   * Parse expiry string to seconds (kept for backward compatibility)
   */
  private parseExpiryToSeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 900; // Default 15 minutes

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 3600;
      case "d":
        return value * 86400;
      default:
        return 900;
    }
  }
}
