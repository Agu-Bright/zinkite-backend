/**
 * Kora Pay Module
 *
 * Integrates with Kora (Korapay) for wallet top-ups (collections)
 * and withdrawals (payouts).
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KorapayService } from './korapay.service';
import {
  KorapayTransaction,
  KorapayTransactionSchema,
} from './schemas/korapay-transaction.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KorapayTransaction.name, schema: KorapayTransactionSchema },
    ]),
  ],
  providers: [KorapayService],
  exports: [KorapayService, MongooseModule],
})
export class KorapayModule {}
