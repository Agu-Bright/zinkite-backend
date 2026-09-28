/**
 * Referral Module
 *
 * Points-based referral system: earn points on signup, convert points to
 * wallet Naira at an admin-configured rate.
 */
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Referral, ReferralSchema } from './schemas/referral.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';
import { ReferralAdminController } from './referral-admin.controller';
import { WalletModule } from '../wallet/wallet.module';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Referral.name, schema: ReferralSchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => WalletModule),
    UsersModule,
    SettingsModule,
    NotificationsModule,
  ],
  controllers: [ReferralController, ReferralAdminController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
