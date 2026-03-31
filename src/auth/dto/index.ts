/**
 * Auth DTOs
 * 
 * Data Transfer Objects for authentication endpoints.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
  IsOptional,
  IsPhoneNumber,
} from 'class-validator';

// =====================
// Registration
// =====================

export class RegisterDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'User email address',
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '+2348012345678',
    description: 'User phone number (international format)',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    example: 'SecureP@ss123',
    description: 'Password (min 8 chars, must include uppercase, lowercase, number)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&#^()_+\-=\[\]{};':"\\|,.<>\/~`]{8,}$/,
    { message: 'Password must include uppercase, lowercase, and number' },
  )
  password: string;

  @ApiPropertyOptional({
    example: 'John Doe',
    description: 'User full name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({
    example: 'PAY-A1B2C3',
    description: 'Referral code from an existing user',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  referralCode?: string;
}

// =====================
// Email Verification
// =====================

export class VerifyEmailDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email to verify',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit OTP code',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit number' })
  otp: string;
}

export class ResendOtpDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email to send OTP to',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

// =====================
// Login
// =====================

export class LoginDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'SecureP@ss123',
    description: 'Password',
  })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

// =====================
// Transaction PIN
// =====================

export class SetPinDto {
  @ApiProperty({
    example: '1234',
    description: '4-digit transaction PIN',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}$/, { message: 'PIN must be a 4-digit number' })
  pin: string;

  @ApiProperty({
    example: '1234',
    description: 'Confirm PIN (must match)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}$/, { message: 'PIN must be a 4-digit number' })
  confirmPin: string;
}

export class VerifyPinDto {
  @ApiProperty({
    example: '1234',
    description: '4-digit transaction PIN',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}$/, { message: 'PIN must be a 4-digit number' })
  pin: string;
}

export class ResetPinRequestDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email to send reset OTP to',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class ResetPinConfirmDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '123456',
    description: 'OTP code from email',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit number' })
  otp: string;

  @ApiProperty({
    example: '1234',
    description: 'New 4-digit PIN',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}$/, { message: 'PIN must be a 4-digit number' })
  newPin: string;
}

// =====================
// Forgot Password (Password Reset)
// =====================

export class ForgotPasswordRequestDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email to send password reset OTP to',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class ForgotPasswordConfirmDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '123456',
    description: 'OTP code from email',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit number' })
  otp: string;

  @ApiProperty({
    example: 'NewP@ss456',
    description: 'New password (min 8 chars, must include uppercase, lowercase, number)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&#^()_+\-=\[\]{};':"\\|,.<>\/~`]{8,}$/,
    { message: 'Password must include uppercase, lowercase, and number' },
  )
  newPassword: string;
}

// =====================
// Social Auth
// =====================

export class GoogleAuthDto {
  @ApiProperty({
    description: 'Google ID token from mobile SDK',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}

export class AppleAuthDto {
  @ApiProperty({
    description: 'Apple identity token from mobile SDK',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  identityToken: string;

  @ApiPropertyOptional({
    description: 'User full name (only available on first sign-in)',
    example: 'John Doe',
  })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({
    description: 'Nonce for replay attack prevention',
  })
  @IsOptional()
  @IsString()
  nonce?: string;
}

export class CompleteProfileDto {
  @ApiPropertyOptional({
    example: '+2348012345678',
    description: 'Phone number (required if missing)',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: 'user@example.com',
    description: 'Email address (required if Apple hid email)',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'John Doe',
    description: 'Full name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/xxx/image/upload/avatar.jpg',
    description: 'Profile avatar URL',
  })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

// =====================
// Account Deletion
// =====================

export class RequestAccountDeletionDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email of the account to delete',
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({
    example: 'I no longer use the service',
    description: 'Optional reason for deletion',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ConfirmAccountDeletionDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email of the account to delete',
  })
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit OTP code sent to email',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'OTP must be a 6-digit number' })
  otp: string;
}

// =====================
// Change Password
// =====================

export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldP@ss123',
    description: 'Current password',
  })
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword: string;

  @ApiProperty({
    example: 'NewP@ss456',
    description: 'New password (min 8 chars, must include uppercase, lowercase, number)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&#^()_+\-=\[\]{};':"\\|,.<>\/~`]{8,}$/,
    { message: 'Password must include uppercase, lowercase, and number' },
  )
  newPassword: string;
}

// =====================
// Response Types
// =====================

export class AuthTokensResponse {
  @ApiProperty({ description: 'JWT access token' })
  accessToken: string;

  @ApiProperty({ description: 'JWT refresh token' })
  refreshToken: string;

  @ApiProperty({ description: 'Token type', example: 'Bearer' })
  tokenType: string;

  @ApiProperty({ description: 'Access token expiry in seconds' })
  expiresIn: number;
}

export class LoginResponse extends AuthTokensResponse {
  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'Whether PIN setup is required' })
  pinSetupRequired: boolean;

  @ApiProperty({ description: 'Whether phone is missing' })
  needsPhone: boolean;

  @ApiProperty({ description: 'Whether email is missing (Apple)' })
  needsEmail: boolean;
}
