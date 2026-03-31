/**
 * Paystack Module
 * 
 * Integrates with Paystack payment gateway for wallet top-ups.
 */
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaystackService } from './paystack.service';
import {
  PaystackTransaction,
  PaystackTransactionSchema,
} from './schemas/paystack-transaction.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaystackTransaction.name, schema: PaystackTransactionSchema },
    ]),
  ],
  providers: [PaystackService],
  exports: [PaystackService, MongooseModule],
})
export class PaystackModule {}
