// src/app.module.ts
/**
 * App Module - Root module that imports all feature modules
 */
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

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

    // Schedule module for cron jobs
    ScheduleModule.forRoot(),

    // Rate limiting — default: 10 requests per 60 seconds per IP
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 3,  // 3 requests per second
      },
      {
        name: 'medium',
        ttl: 60000, // 1 minute
        limit: 20,  // 20 requests per minute
      },
      {
        name: 'long',
        ttl: 3600000, // 1 hour
        limit: 100,   // 100 requests per hour (for auth endpoints)
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
    // Enforce ThrottlerModule limits on every route globally.
    // Opt out per-route with @SkipThrottle() (e.g. Paystack webhooks).
    // Loosen per-route with @Throttle({ short: { limit: N, ttl: N } }).
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}