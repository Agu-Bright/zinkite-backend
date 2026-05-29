/**
 * Webhooks Module
 * 
 * Handles incoming webhooks from external services.
 */
import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { PaystackModule } from '../paystack/paystack.module';
import { KorapayModule } from '../korapay/korapay.module';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserTaskModule } from '../user-tasks/user-task.module';

@Module({
  imports: [PaystackModule, KorapayModule, WalletModule, NotificationsModule, UserTaskModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
