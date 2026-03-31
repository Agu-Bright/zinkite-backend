/**
 * Referral Module
 *
 * Referral challenge system with user tracking,
 * qualification logic, and winner rewards.
 */
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ReferralChallenge,
  ReferralChallengeSchema,
} from './schemas/referral-challenge.schema';
import { Referral, ReferralSchema } from './schemas/referral.schema';
import { ReferralService } from './referral.service';
import { ReferralController } from './referral.controller';
import { ReferralAdminController } from './referral-admin.controller';
import { WalletModule } from '../wallet/wallet.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReferralChallenge.name, schema: ReferralChallengeSchema },
      { name: Referral.name, schema: ReferralSchema },
    ]),
    forwardRef(() => WalletModule),
    UsersModule,
  ],
  controllers: [ReferralController, ReferralAdminController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
