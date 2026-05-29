/**
 * Gift Card Shop Module
 *
 * Admin-stocked gift card inventory for users to purchase.
 * Separate from the Reloadly-based GiftCardBuyModule.
 */
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { GiftCardShopController } from './giftcard-shop.controller';
import { GiftCardShopAdminController } from './giftcard-shop-admin.controller';
import { GiftCardShopService } from './giftcard-shop.service';

import {
  GiftCardShopProduct,
  GiftCardShopProductSchema,
} from './schemas/giftcard-shop-product.schema';
import {
  GiftCardShopCode,
  GiftCardShopCodeSchema,
} from './schemas/giftcard-shop-code.schema';
import {
  GiftCardShopPurchase,
  GiftCardShopPurchaseSchema,
} from './schemas/giftcard-shop-purchase.schema';

import { WalletModule } from '../wallet/wallet.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GiftCardShopProduct.name, schema: GiftCardShopProductSchema },
      { name: GiftCardShopCode.name, schema: GiftCardShopCodeSchema },
      { name: GiftCardShopPurchase.name, schema: GiftCardShopPurchaseSchema },
    ]),
    forwardRef(() => WalletModule),
    UsersModule,
    NotificationsModule,
  ],
  controllers: [GiftCardShopController, GiftCardShopAdminController],
  providers: [GiftCardShopService],
  exports: [GiftCardShopService],
})
export class GiftCardShopModule {}
