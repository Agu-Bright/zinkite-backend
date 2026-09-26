// src/app.module.ts
/**
 * App Module - Root module that imports all feature modules
 */
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { IdentityThrottlerGuard } from './common/guards/identity-throttler.guard';
import { BlockedIpGuard } from './common/guards/blocked-ip.guard';
import { BlockedIp, BlockedIpSchema } from './admin/schemas/blocked-ip.schema';

// Feature Modules
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { GiftCardsModule } from './giftcards/giftcards.module';
import { UploadsModule } from './uploads/uploads.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AdminModule } from './admin/admin.module';
import { EmailModule } from './email/email.module';
import { OtpModule } from './otp/otp.module';
import { PaystackModule } from './paystack/paystack.module';
import { KorapayModule } from './korapay/korapay.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { GiftCardBuyModule } from './giftcard-buy/giftcard-buy.module';
import { PromosModule } from './promos/promos.module';
import { ReferralModule } from './referral/referral.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SupportModule } from './support/support.module';
import { GiftCardShopModule } from './giftcard-shop/giftcard-shop.module';
import { UserTaskModule } from './user-tasks/user-task.module';
import { VtuModule } from './vtu/vtu.module';

// App Controller
import { AppController } from './app.controller';

@Module({
  imports: [
    // Configuration module - loads .env variables
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // MongoDB connection
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
        // MongoDB connection options
        retryAttempts: 5,
        retryDelay: 1000,
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: BlockedIp.name, schema: BlockedIpSchema },
    ]),

    // Schedule module for cron jobs
    ScheduleModule.forRoot(),

    // Global rate limiting — per authenticated session (see
    // IdentityThrottlerGuard). These are GENEROUS on purpose: dashboards and
    // the mobile home screen fan out many parallel requests on load, so tight
    // global caps (the old 3/s · 20/min · 100/hr) produced "Too many requests"
    // during normal use. Real brute-force protection lives on the sensitive
    // auth/PIN routes via their own strict @Throttle() overrides.
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 30, // 30 requests/second — absorbs parallel widget/query bursts
      },
      {
        name: 'medium',
        ttl: 60000, // 1 minute
        limit: 300, // 300 requests/minute
      },
      {
        name: 'long',
        ttl: 3600000, // 1 hour
        limit: 3000,  // 3000 requests/hour per session
      },
    ]),

    // Common utilities (guards, interceptors, etc.)
    CommonModule,

    // Core feature modules
    AuthModule,
    UsersModule,
    WalletModule,
    GiftCardsModule,
    UploadsModule,
    WebhooksModule,
    AdminModule,
    GiftCardBuyModule,
    GiftCardShopModule,
    PromosModule,
    ReferralModule,
    UserTaskModule,
    VtuModule,

    SettingsModule,
    NotificationsModule,
    SupportModule,

    // Supporting modules
    EmailModule,
    OtpModule,
    PaystackModule,
    KorapayModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: BlockedIpGuard,
    },
    // Enforce ThrottlerModule limits on every route globally.
    // Opt out per-route with @SkipThrottle() (e.g. Paystack webhooks).
    // Loosen per-route with @Throttle({ short: { limit: N, ttl: N } }).
    {
      provide: APP_GUARD,
      useClass: IdentityThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
