/**
 * Gift Card Buy Module
 *
 * Handles purchasing gift cards via Reloadly API.
 * Includes product sync, pricing, purchase flow, and admin management.
 */
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { GiftCardBuyController } from './giftcard-buy.controller';
import { GiftCardBuyAdminController } from './giftcard-buy-admin.controller';
import { GiftCardBuyService } from './giftcard-buy.service';
import { ReloadlyService } from './reloadly.service';

import {
  ReloadlyProduct,
  ReloadlyProductSchema,
} from './schemas/reloadly-product.schema';
import {
  GiftCardBuyOrder,
  GiftCardBuyOrderSchema,
} from './schemas/giftcard-buy-order.schema';
import {
  GiftCardBuyMarkup,
  GiftCardBuyMarkupSchema,
} from './schemas/giftcard-buy-markup.schema';
import {
  GiftCardBuyConfig,
  GiftCardBuyConfigSchema,
} from './schemas/giftcard-buy-config.schema';

import { WalletModule } from '../wallet/wallet.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReloadlyProduct.name, schema: ReloadlyProductSchema },
      { name: GiftCardBuyOrder.name, schema: GiftCardBuyOrderSchema },
      { name: GiftCardBuyMarkup.name, schema: GiftCardBuyMarkupSchema },
      { name: GiftCardBuyConfig.name, schema: GiftCardBuyConfigSchema },
    ]),
    HttpModule,
    ConfigModule,
    forwardRef(() => WalletModule),
    UsersModule,
  ],
  controllers: [GiftCardBuyController, GiftCardBuyAdminController],
  providers: [GiftCardBuyService, ReloadlyService],
  exports: [GiftCardBuyService, ReloadlyService],
})
export class GiftCardBuyModule {}
