// src/app.module.ts
/**
 * App Module - Root module that imports all feature modules
 */
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
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
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { GiftCardBuyModule } from './giftcard-buy/giftcard-buy.module';
import { PromosModule } from './promos/promos.module';
import { ReferralModule } from './referral/referral.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SupportModule } from './support/support.module';

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
    PromosModule,
    ReferralModule,

    SettingsModule,
    NotificationsModule,
    SupportModule,

    // Supporting modules
    EmailModule,
    OtpModule,
    PaystackModule,
    AuditModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}