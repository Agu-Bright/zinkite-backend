/**
 * Auth Module
 * 
 * Provides authentication functionality including:
 * - Email registration and verification
 * - JWT-based authentication
 * - Social authentication (Google/Apple)
 * - Transaction PIN management
 */
import { Module, forwardRef } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SocialAuthService } from './social-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { ReferralModule } from '../referral/referral.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_ACCESS_SECRET');
        if (!secret || secret.includes('your-super-secret')) {
          throw new Error('JWT_ACCESS_SECRET must be set to a secure random value in .env');
        }
        return {
          secret,
          signOptions: {
            expiresIn: 900, // 15 minutes in seconds
          },
        };
      },
      inject: [ConfigService],
    }),
    UsersModule,
    forwardRef(() => WalletModule),
    forwardRef(() => ReferralModule),
  ],
  controllers: [AuthController],
  providers: [AuthService, SocialAuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule {}