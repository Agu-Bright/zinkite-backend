/**
 * Common Module - Shared utilities, guards, filters, interceptors
 */
import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_ACCESS_SECRET');
        if (!secret || secret.includes('your-super-secret')) {
          // ── Startup diagnostic (no secret leakage) ──
          // Reveals what the runtime environment is actually providing so we can
          // tell "var missing on Railway" apart from "var present but rejected".
          /* eslint-disable no-console */
          console.error('[JWT DIAG] JWT_ACCESS_SECRET validation failed.');
          console.error('[JWT DIAG] via ConfigService present:', !!secret, 'len:', secret ? secret.length : 0);
          console.error('[JWT DIAG] via process.env present:', !!process.env.JWT_ACCESS_SECRET, 'len:', process.env.JWT_ACCESS_SECRET ? process.env.JWT_ACCESS_SECRET.length : 0);
          console.error('[JWT DIAG] includes placeholder:', secret ? secret.includes('your-super-secret') : 'n/a');
          console.error('[JWT DIAG] NODE_ENV:', process.env.NODE_ENV);
          console.error('[JWT DIAG] total env vars visible:', Object.keys(process.env).length);
          console.error('[JWT DIAG] sample known vars present →',
            'MONGO_URI:', !!process.env.MONGO_URI,
            'PAYSTACK_SECRET_KEY:', !!process.env.PAYSTACK_SECRET_KEY,
            'PAYMENT_PROVIDER:', process.env.PAYMENT_PROVIDER ?? '(unset)',
          );
          console.error('[JWT DIAG] env keys starting with JWT:',
            Object.keys(process.env).filter((k) => k.startsWith('JWT')));
          /* eslint-enable no-console */
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
  ],
  exports: [JwtModule],
})
export class CommonModule {}