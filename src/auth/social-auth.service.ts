/**
 * Social Auth Service
 * 
 * Handles Google and Apple Sign-In token verification.
 */
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import * as jose from 'jose';

export interface GoogleUserInfo {
  sub: string;         // Google user ID
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export interface AppleUserInfo {
  sub: string;         // Apple user ID
  email?: string;      // May be null if user hid email
  emailVerified: boolean;
  isPrivateEmail?: boolean;
}

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);
  private readonly googleClient: OAuth2Client;
  private readonly googleClientId: string;
  private readonly appleClientId: string;

  // Apple's JWKS endpoint
  private readonly APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
  private readonly APPLE_ISSUER = 'https://appleid.apple.com';

  constructor(private readonly configService: ConfigService) {
    this.googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID', '');
    this.appleClientId = this.configService.get<string>('APPLE_CLIENT_ID', '');

    // Initialize Google OAuth client
    this.googleClient = new OAuth2Client(this.googleClientId);
  }

  // =====================
  // Google Sign-In
  // =====================

  /**
   * Verify Google ID token and extract user info
   */
  async verifyGoogleToken(idToken: string): Promise<GoogleUserInfo> {
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.googleClientId,
      });

      const payload = ticket.getPayload();

      if (!payload) {
        throw new UnauthorizedException('Invalid Google token: no payload');
      }

      // Verify essential claims
      if (!payload.sub) {
        throw new UnauthorizedException('Invalid Google token: missing sub');
      }

      if (!payload.email) {
        throw new UnauthorizedException('Invalid Google token: missing email');
      }

      this.logger.log(`Google token verified for: ${payload.email}`);

      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified ?? false,
        name: payload.name,
        picture: payload.picture,
      };
    } catch (error) {
      this.logger.error(`Google token verification failed: ${error.message}`);
      
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      
      throw new UnauthorizedException('Invalid or expired Google token');
    }
  }

  // =====================
  // Apple Sign-In
  // =====================

  /**
   * Verify Apple identity token and extract user info
   */
  async verifyAppleToken(
    identityToken: string,
    expectedNonce?: string,
  ): Promise<AppleUserInfo> {
    try {
      // Fetch Apple's public keys (JWKS)
      const JWKS = jose.createRemoteJWKSet(new URL(this.APPLE_JWKS_URL));

      // Verify the token
      const { payload } = await jose.jwtVerify(identityToken, JWKS, {
        issuer: this.APPLE_ISSUER,
        audience: this.appleClientId,
      });

      // Verify nonce if provided
      if (expectedNonce && payload.nonce !== expectedNonce) {
        throw new UnauthorizedException('Invalid nonce');
      }

      // Verify essential claims
      if (!payload.sub) {
        throw new UnauthorizedException('Invalid Apple token: missing sub');
      }

      const userInfo: AppleUserInfo = {
        sub: payload.sub as string,
        email: payload.email as string | undefined,
        emailVerified: (payload.email_verified === 'true' || payload.email_verified === true),
        isPrivateEmail: payload.is_private_email === 'true' || payload.is_private_email === true,
      };

      this.logger.log(
        `Apple token verified for sub: ${payload.sub}${userInfo.email ? `, email: ${userInfo.email}` : ' (hidden email)'}`,
      );

      return userInfo;
    } catch (error) {
      this.logger.error(`Apple token verification failed: ${error.message}`);
      
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (error.code === 'ERR_JWT_EXPIRED') {
        throw new UnauthorizedException('Apple token has expired');
      }

      if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
        throw new UnauthorizedException('Apple token validation failed');
      }

      throw new UnauthorizedException('Invalid or expired Apple token');
    }
  }

  /**
   * Check if email is an Apple private relay email
   */
  isApplePrivateRelayEmail(email: string): boolean {
    return email.endsWith('@privaterelay.appleid.com');
  }
}
