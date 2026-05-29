/**
 * Gift Card Shop Controller (User-facing)
 *
 * Public: browse products
 * Authenticated: purchase cards, view purchase history
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiSecurity,
} from '@nestjs/swagger';
import { GiftCardShopService } from './giftcard-shop.service';
import {
  ShopProductQueryDto,
  PurchaseShopCardDto,
  UserShopPurchaseQueryDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PinGuard } from '../common/guards/pin.guard';
import { CurrentUser, Public, RequirePin } from '../common/decorators';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@ApiTags('Gift Card Shop')
@Controller('giftcard-shop')
export class GiftCardShopController {
  constructor(private readonly shopService: GiftCardShopService) {}

  // ============================================
  // PUBLIC ENDPOINTS
  // ============================================

  @Get('products')
  @Public()
  @ApiOperation({ summary: 'Browse available gift cards in the shop' })
  @ApiResponse({ status: 200, description: 'Paginated list of available products' })
  async getProducts(@Query() query: ShopProductQueryDto) {
    return this.shopService.getAvailableProducts(query);
  }

  @Get('products/:id')
  @Public()
  @ApiOperation({ summary: 'Get gift card product details' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Product details' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async getProduct(@Param('id') id: string) {
    return this.shopService.getProductDetail(id);
  }

  // ============================================
  // AUTHENTICATED ENDPOINTS
  // ============================================

  @Post('purchase')
  @UseGuards(JwtAuthGuard, PinGuard)
  @RequirePin()
  @ApiBearerAuth('JWT-auth')
  @ApiSecurity('PIN-auth')
  @ApiOperation({ summary: 'Purchase a gift card from the shop' })
  @ApiResponse({ status: 201, description: 'Purchase successful — card code returned' })
  @ApiResponse({ status: 400, description: 'Out of stock or insufficient balance' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async purchase(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PurchaseShopCardDto,
  ) {
    return this.shopService.purchaseCard(user.sub, dto);
  }

  @Get('purchases/my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get your gift card purchase history' })
  @ApiResponse({ status: 200, description: 'Paginated list of purchases' })
  async getMyPurchases(
    @CurrentUser() user: JwtPayload,
    @Query() query: UserShopPurchaseQueryDto,
  ) {
    return this.shopService.getUserPurchases(user.sub, query);
  }

  @Get('purchases/my/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get a specific purchase with card code' })
  @ApiParam({ name: 'id', description: 'Purchase ID' })
  @ApiResponse({ status: 200, description: 'Purchase details with card code' })
  @ApiResponse({ status: 404, description: 'Purchase not found' })
  async getMyPurchase(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.shopService.getUserPurchaseById(user.sub, id);
  }
}
