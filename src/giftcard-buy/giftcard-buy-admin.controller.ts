/**
 * Gift Card Buy Admin Controller
 *
 * Admin endpoints for managing gift card buying:
 * - Product management (list, toggle enabled, sync)
 * - Markup management (CRUD)
 * - Order management (list, detail, refund)
 * - Stats
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../admin/guards/permissions.guard';
import { RequirePermissions } from '../admin/decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators';
import { GiftCardBuyService } from './giftcard-buy.service';
import {
  AdminProductsQueryDto,
  ToggleProductDto,
  UpsertMarkupDto,
  AdminOrdersQueryDto,
  RefundOrderDto,
  UpdateExchangeRateDto,
} from './dto';

@ApiTags('Admin - Gift Card Buy')
@Controller('admin/giftcard-buy')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth('JWT-auth')
export class GiftCardBuyAdminController {
  constructor(private readonly giftCardBuyService: GiftCardBuyService) {}

  // ─── Products ─────────────────────────────────────────────

  @Get('products')
  @RequirePermissions('giftcard-buy.view')
  @ApiOperation({ summary: 'List all gift card buy products (admin)' })
  async getProducts(@Query() query: AdminProductsQueryDto) {
    return this.giftCardBuyService.getAdminProducts(query);
  }

  @Patch('products/:id/toggle')
  @RequirePermissions('giftcard-buy.manage')
  @ApiOperation({ summary: 'Enable or disable a product' })
  async toggleProduct(
    @Param('id') id: string,
    @Body() dto: ToggleProductDto,
  ) {
    return this.giftCardBuyService.toggleProduct(id, dto.isEnabled);
  }

  @Post('sync')
  @RequirePermissions('giftcard-buy.sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger manual product sync (all countries)' })
  async syncAll() {
    const result = await this.giftCardBuyService.syncAllProducts();
    return { success: true, message: 'Sync complete', ...result };
  }

  @Post('sync/:countryCode')
  @RequirePermissions('giftcard-buy.sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync products for a specific country' })
  async syncCountry(@Param('countryCode') countryCode: string) {
    const result = await this.giftCardBuyService.syncProductsByCountry(countryCode);
    return { success: true, message: `Sync complete for ${countryCode}`, ...result };
  }

  // ─── Markups ──────────────────────────────────────────────

  @Get('markups')
  @RequirePermissions('giftcard-buy.manage')
  @ApiOperation({ summary: 'List all markup configurations' })
  async getMarkups() {
    return this.giftCardBuyService.getMarkups();
  }

  @Post('markups')
  @RequirePermissions('giftcard-buy.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update a markup' })
  async upsertMarkup(
    @Body() dto: UpsertMarkupDto,
    @CurrentUser('sub') adminId: string,
  ) {
    return this.giftCardBuyService.upsertMarkup(dto, adminId);
  }

  @Delete('markups/:id')
  @RequirePermissions('giftcard-buy.manage')
  @ApiOperation({ summary: 'Delete a markup' })
  async deleteMarkup(@Param('id') id: string) {
    await this.giftCardBuyService.deleteMarkup(id);
    return { success: true, message: 'Markup deleted' };
  }

  // ─── Orders ───────────────────────────────────────────────

  @Get('orders')
  @RequirePermissions('giftcard-buy.view')
  @ApiOperation({ summary: 'List all gift card buy orders' })
  async getOrders(@Query() query: AdminOrdersQueryDto) {
    return this.giftCardBuyService.getAdminOrders(query);
  }

  @Get('orders/:id')
  @RequirePermissions('giftcard-buy.view')
  @ApiOperation({ summary: 'Get order detail' })
  async getOrderById(@Param('id') id: string) {
    return this.giftCardBuyService.getAdminOrderById(id);
  }

  @Post('orders/:id/retry-codes')
  @RequirePermissions('giftcard-buy.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry fetching redeem codes from Reloadly' })
  async retryRedeemCodes(@Param('id') id: string) {
    return this.giftCardBuyService.retryRedeemCodes(id);
  }

  @Post('orders/:id/refund')
  @RequirePermissions('giftcard-buy.refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refund an order' })
  async refundOrder(
    @Param('id') id: string,
    @Body() dto: RefundOrderDto,
    @CurrentUser('sub') adminId: string,
  ) {
    const order = await this.giftCardBuyService.refundOrder(id, adminId, dto.reason);
    return { success: true, message: 'Order refunded', data: order };
  }

  // ─── Stats ────────────────────────────────────────────────

  @Get('stats')
  @RequirePermissions('giftcard-buy.stats')
  @ApiOperation({ summary: 'Get gift card buy stats' })
  async getStats() {
    return this.giftCardBuyService.getStats();
  }

  // ─── Config ─────────────────────────────────────────────

  @Get('config')
  @RequirePermissions('giftcard-buy.manage')
  @ApiOperation({ summary: 'Get gift card buy configuration' })
  async getConfig() {
    const config = await this.giftCardBuyService.getConfig();
    const exchangeRate = await this.giftCardBuyService.getExchangeRate();
    return { config, exchangeRate };
  }

  @Put('config/exchange-rate')
  @RequirePermissions('giftcard-buy.manage')
  @ApiOperation({ summary: 'Update USD to NGN exchange rate' })
  async updateExchangeRate(
    @Body() dto: UpdateExchangeRateDto,
    @CurrentUser('sub') adminId: string,
  ) {
    const result = await this.giftCardBuyService.updateExchangeRate(dto.rate, adminId);
    return { success: true, message: 'Exchange rate updated', data: result };
  }
}
