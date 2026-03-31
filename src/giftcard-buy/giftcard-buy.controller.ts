/**
 * Gift Card Buy Controller (User-facing)
 *
 * Endpoints:
 * - GET  /giftcard-buy/countries        — List supported countries
 * - GET  /giftcard-buy/products         — List enabled products
 * - GET  /giftcard-buy/products/:id     — Product detail
 * - GET  /giftcard-buy/price            — Calculate price preview
 * - POST /giftcard-buy/purchase         — Purchase gift card (PIN required)
 * - GET  /giftcard-buy/orders           — User's orders
 * - GET  /giftcard-buy/orders/:id       — Order detail with redeem codes
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PinGuard } from '../common/guards/pin.guard';
import { GiftCardBuyService } from './giftcard-buy.service';
import {
  PurchaseGiftCardDto,
  PricePreviewQueryDto,
  ProductsQueryDto,
  UserOrdersQueryDto,
} from './dto';

@ApiTags('Gift Card Buy')
@Controller('giftcard-buy')
export class GiftCardBuyController {
  constructor(private readonly giftCardBuyService: GiftCardBuyService) {}

  /**
   * GET /giftcard-buy/countries
   */
  @Get('countries')
  @ApiOperation({ summary: 'List supported countries for gift card buying' })
  getCountries() {
    return this.giftCardBuyService.getCountries();
  }

  /**
   * GET /giftcard-buy/exchange-rate
   */
  @Get('exchange-rate')
  @ApiOperation({ summary: 'Get current USD to NGN exchange rate' })
  async getExchangeRate() {
    const rate = await this.giftCardBuyService.getExchangeRate();
    return { rate, currency: 'NGN' };
  }

  /**
   * GET /giftcard-buy/products
   */
  @Get('products')
  @ApiOperation({ summary: 'List available gift card products' })
  async getProducts(@Query() query: ProductsQueryDto) {
    return this.giftCardBuyService.getEnabledProducts(query);
  }

  /**
   * GET /giftcard-buy/products/:id
   */
  @Get('products/:id')
  @ApiOperation({ summary: 'Get gift card product detail' })
  async getProductById(@Param('id') id: string) {
    return this.giftCardBuyService.getProductById(id);
  }

  /**
   * GET /giftcard-buy/price
   */
  @Get('price')
  @ApiOperation({ summary: 'Calculate price preview for a gift card' })
  async getPrice(@Query() query: PricePreviewQueryDto) {
    return this.giftCardBuyService.calculatePrice(query.productId, query.unitPrice);
  }

  /**
   * POST /giftcard-buy/purchase
   */
  @Post('purchase')
  @UseGuards(JwtAuthGuard, PinGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiSecurity('PIN-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Purchase a gift card' })
  @ApiResponse({ status: 200, description: 'Gift card purchased successfully' })
  @ApiResponse({ status: 400, description: 'Invalid product or insufficient balance' })
  async purchase(@Req() req: any, @Body() dto: PurchaseGiftCardDto) {
    const userId = req.user.userId || req.user.sub;
    return this.giftCardBuyService.purchaseGiftCard(userId, dto);
  }

  /**
   * GET /giftcard-buy/orders
   */
  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "Get user's gift card buy orders" })
  async getOrders(@Req() req: any, @Query() query: UserOrdersQueryDto) {
    const userId = req.user.userId || req.user.sub;
    return this.giftCardBuyService.getUserOrders(userId, query);
  }

  /**
   * GET /giftcard-buy/orders/:id
   */
  @Get('orders/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get order detail with redeem codes' })
  async getOrderById(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.userId || req.user.sub;
    return this.giftCardBuyService.getUserOrderById(id, userId);
  }

  /**
   * POST /giftcard-buy/orders/:id/retry-codes
   */
  @Post('orders/:id/retry-codes')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry fetching redeem codes for a completed order' })
  async retryRedeemCodes(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.userId || req.user.sub;
    return this.giftCardBuyService.retryRedeemCodes(id, userId);
  }
}
