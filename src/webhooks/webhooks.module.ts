/**
 * Webhooks Module
 * 
 * Handles incoming webhooks from external services.
 */
import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { PaystackModule } from '../paystack/paystack.module';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PaystackModule, WalletModule, NotificationsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
