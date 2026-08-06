import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WalletModule } from '../wallet/wallet.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VtuTransaction, VtuTransactionSchema } from './schemas/vtu-transaction.schema';
import { VtpassClient } from './vtpass.client';
import { VtuService } from './vtu.service';
import { VtuController } from './vtu.controller';
import { VtuAdminController } from './vtu-admin.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: VtuTransaction.name, schema: VtuTransactionSchema }]), WalletModule, UsersModule, NotificationsModule],
  controllers: [VtuController, VtuAdminController],
  providers: [VtpassClient, VtuService],
  exports: [VtuService],
})
export class VtuModule {}
