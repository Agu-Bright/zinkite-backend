/**
 * Gift Cards Module
 */
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GiftCardsController } from './giftcards.controller';
import { GiftCardsService } from './giftcards.service';
import {
  GiftCardBrand,
  GiftCardBrandSchema,
} from './schemas/gift-card-brand.schema';
import {
  GiftCardCategory,
  GiftCardCategorySchema,
} from './schemas/gift-card-category.schema';
import {
  GiftCardRate,
  GiftCardRateSchema,
} from './schemas/gift-card-rate.schema';
import {
  GiftCardTrade,
  GiftCardTradeSchema,
} from './schemas/gift-card-trade.schema';
import { WalletModule } from '../wallet/wallet.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GiftCardBrand.name, schema: GiftCardBrandSchema },
      { name: GiftCardCategory.name, schema: GiftCardCategorySchema },
      { name: GiftCardRate.name, schema: GiftCardRateSchema },
      { name: GiftCardTrade.name, schema: GiftCardTradeSchema },
    ]),
    forwardRef(() => WalletModule),
    UsersModule, // Import UsersModule for PinGuard
  ],
  controllers: [GiftCardsController],
  providers: [GiftCardsService],
  exports: [GiftCardsService],
})
export class GiftCardsModule {}