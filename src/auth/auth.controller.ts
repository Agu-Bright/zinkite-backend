// src/auth/auth.controller.ts
/**
 * Auth Controller
 *
 * Handles authentication endpoints:
 * - Registration and email verification
 * - Login and token refresh
 * - Transaction PIN management
 * - Social authentication (Google/Apple)
 * - User profile
 */
import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { ThrottlerGuard, Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser, Public } from "../common/decorators";
import {
  RegisterDto,
  VerifyEmailDto,
  ResendOtpDto,
  LoginDto,
  RefreshTokenDto,
  SetPinDto,
  VerifyPinDto,
  ResetPinRequestDto,
  ResetPinConfirmDto,
  ForgotPasswordRequestDto,
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

@ApiTags("Auth")
@Controller("auth")
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // =====================
  // Email Registration
  // =====================

  @Public()
  @Post("register")
  @ApiOperation({ summary: "Register a new user with email" })
  @ApiResponse({
    status: 201,
    description: "User registered successfully",
    schema: {
      properties: {
        message: { type: "string" },
        userId: { type: "string" },
      },
    },
  })
  @ApiResponse({ status: 409, description: "Email or phone already exists" })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Verify email with OTP" })
  @ApiResponse({ status: 200, description: "Email verified" })
  @ApiResponse({ status: 400, description: "Invalid or expired OTP" })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Public()
  @Post("resend-otp")
  @Throttle({ short: { limit: 3, ttl: 60000 } }) // 3 resends per minute
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Resend verification OTP" })
  @ApiResponse({ status: 200, description: "OTP sent" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.email);
  }

  // =====================
  // Login
  // =====================

  @Public()
  @Post("login")
  @Throttle({ short: { limit: 5, ttl: 60000 } }) // 5 login attempts per minute
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login with email and password" })
  @ApiResponse({
    status: 200,
    description: "Login successful",
    type: LoginResponse,
  })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Refresh access token" })
  @ApiResponse({
    status: 200,
    description: "New tokens generated",
    type: AuthTokensResponse,
  })
  @ApiResponse({ status: 401, description: "Invalid refresh token" })
  async refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokensResponse> {
    return this.authService.refreshToken(dto.refreshToken);
  }

  // =====================
  // User Profile
  // =====================

  @Get("profile")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get current user profile" })
  @ApiResponse({
    status: 200,
    description: "User profile retrieved",
    schema: {
      properties: {
        _id: { type: "string" },
        id: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        fullName: { type: "string" },
        avatarUrl: { type: "string" },
        isEmailVerified: { type: "boolean" },
        hasPinSet: { type: "boolean" },
        roles: { type: "array", items: { type: "string" } },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getProfile(@CurrentUser("sub") userId: string) {
    return this.authService.getProfile(userId);
  }

  // =====================
  // Change Password
  // =====================

  @UseGuards(JwtAuthGuard)
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Change account password" })
  @ApiResponse({ status: 200, description: "Password changed successfully" })
  @ApiResponse({ status: 400, description: "Current password is incorrect" })
  async changePassword(
    @CurrentUser("sub") userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }

  // =====================
  // Transaction PIN
  // =====================

  @UseGuards(JwtAuthGuard)
  @Post("set-pin")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Set 4-digit transaction PIN (first time)" })
  @ApiResponse({ status: 200, description: "PIN set successfully" })
  @ApiResponse({ status: 400, description: "PIN already set or invalid" })
  async setPin(@CurrentUser("sub") userId: string, @Body() dto: SetPinDto) {
    return this.authService.setPin(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post("verify-pin")
  @Throttle({ short: { limit: 5, ttl: 60000 } }) // 5 PIN attempts per minute
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Verify transaction PIN" })
  @ApiResponse({
    status: 200,
    description: "PIN verification result",
    schema: {
      properties: {
        valid: { type: "boolean" },
      },
    },
  })
  async verifyPin(
    @CurrentUser("sub") userId: string,
    @Body() dto: VerifyPinDto,
  ) {
    return this.authService.verifyPin(userId, dto.pin);
  }

  @Public()
  @Post("reset-pin/request")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Request PIN reset OTP" })
  @ApiResponse({ status: 200, description: "OTP sent if email exists" })
  async requestPinReset(@Body() dto: ResetPinRequestDto) {
    return this.authService.requestPinReset(dto.email);
  }

  @Public()
  @Post("reset-pin/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset PIN with OTP" })
  @ApiResponse({ status: 200, description: "PIN reset successfully" })
  @ApiResponse({ status: 400, description: "Invalid OTP or user" })
  async confirmPinReset(@Body() dto: ResetPinConfirmDto) {
    return this.authService.confirmPinReset(dto);
  }

  // =====================
  // Password Reset (Forgot Password)
  // =====================

  @Public()
  @Post("forgot-password/request")
  @Throttle({ short: { limit: 3, ttl: 60000 } }) // 3 requests per minute
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Request password reset OTP" })
  @ApiResponse({ status: 200, description: "OTP sent if email exists" })
  async requestPasswordReset(@Body() dto: ForgotPasswordRequestDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Public()
  @Post("forgot-password/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset password with OTP" })
  @ApiResponse({ status: 200, description: "Password reset successfully" })
  @ApiResponse({ status: 400, description: "Invalid OTP or user" })
  async confirmPasswordReset(@Body() dto: ForgotPasswordConfirmDto) {
    return this.authService.confirmPasswordReset(dto);
  }

  // =====================
  // Social Authentication
  // =====================

  @Public()
  @Post("google")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Sign in with Google",
    description: "Authenticate with Google ID token from mobile SDK",
  })
  @ApiResponse({
    status: 200,
    description: "Authentication successful",
    type: LoginResponse,
  })
  @ApiResponse({ status: 401, description: "Invalid Google token" })
  async googleAuth(@Body() dto: GoogleAuthDto): Promise<LoginResponse> {
    return this.authService.googleAuth(dto);
  }

  @Public()
  @Post("apple")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Sign in with Apple",
    description: "Authenticate with Apple identity token from mobile SDK",
  })
  @ApiResponse({
    status: 200,
    description: "Authentication successful",
    type: LoginResponse,
  })
  @ApiResponse({ status: 401, description: "Invalid Apple token" })
  async appleAuth(@Body() dto: AppleAuthDto): Promise<LoginResponse> {
    return this.authService.appleAuth(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post("complete-profile")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Complete profile (social auth users)",
    description: "Add missing phone/email for social auth users",
  })
  @ApiResponse({ status: 200, description: "Profile updated" })
  @ApiResponse({ status: 409, description: "Phone/email already in use" })
  async completeProfile(
    @CurrentUser("sub") userId: string,
    @Body() dto: CompleteProfileDto,
  ) {
    return this.authService.completeProfile(userId, dto);
  }

  // =====================
  // Account Deletion
  // =====================

  @Public()
  @Post("request-account-deletion")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Request account deletion",
    description:
      "Sends a verification OTP to the user's email to confirm account deletion. No authentication required.",
  })
  @ApiResponse({
    status: 200,
    description: "Verification code sent if email exists",
  })
  async requestAccountDeletion(@Body() dto: RequestAccountDeletionDto) {
    return this.authService.requestAccountDeletion(dto);
  }

  @Public()
  @Post("confirm-account-deletion")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Confirm account deletion with OTP",
    description:
      "Permanently deletes the user account and all associated data after OTP verification.",
  })
  @ApiResponse({ status: 200, description: "Account deleted successfully" })
  @ApiResponse({ status: 400, description: "Invalid or expired OTP" })
  async confirmAccountDeletion(@Body() dto: ConfirmAccountDeletionDto) {
    return this.authService.confirmAccountDeletion(dto);
  }

  // =====================
  // Logout
  // =====================

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Logout user" })
  @ApiResponse({ status: 200, description: "Logout successful" })
  async logout(@CurrentUser("sub") userId: string) {
    // Optional: Invalidate refresh token on server side if needed
    return { message: "Logout successful" };
  }
}