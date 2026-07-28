/**
 * Gift Card Shop Admin Controller
 *
 * Admin-only endpoints for managing the gift card shop inventory.
 */
import {
  Controller,
  Get,
  Post,
  Put,
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
} from '@nestjs/swagger';
import { GiftCardShopService } from './giftcard-shop.service';
import {
  CreateShopProductDto,
  UpdateShopProductDto,
  ShopProductQueryDto,
  AddCodesDto,
  ShopPurchaseQueryDto,
  RefundShopPurchaseDto,
} from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, Roles } from '../common/decorators';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PermissionsGuard } from '../admin/guards/permissions.guard';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../admin/decorators/require-permissions.decorator';

@ApiTags('Admin - Gift Card Shop')
@Controller('admin/giftcard-shop')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN')
@ApiBearerAuth('JWT-auth')
export class GiftCardShopAdminController {
  constructor(private readonly shopService: GiftCardShopService) {}

  // ============================================
  // PRODUCTS
  // ============================================

  @Get('products')
  @RequirePermissions('giftcard-buy.view')
  @ApiOperation({ summary: 'List all shop products (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated product list' })
  async getProducts(@Query() query: ShopProductQueryDto) {
    return this.shopService.getProducts(query);
  }

  @Post('products')
  @RequirePermissions('giftcard-buy.manage')
  @ApiOperation({ summary: 'Create a new shop product' })
  @ApiResponse({ status: 201, description: 'Product created' })
  async createProduct(@Body() dto: CreateShopProductDto) {
    return this.shopService.createProduct(dto);
  }

  @Get('products/:id')
  @RequirePermissions('giftcard-buy.view')
  @ApiOperation({ summary: 'Get shop product details (admin)' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Product details' })
  async getProduct(@Param('id') id: string) {
    return this.shopService.getProductById(id);
  }

  @Put('products/:id')
  @RequirePermissions('giftcard-buy.manage')
  @ApiOperation({ summary: 'Update a shop product' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  async updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdateShopProductDto,
  ) {
    return this.shopService.updateProduct(id, dto);
  }

  @Post('products/:id/codes')
  @RequirePermissions('giftcard-buy.manage')
  @ApiOperation({ summary: 'Add gift card codes to a product' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 201, description: 'Codes added' })
  async addCodes(
    @Param('id') id: string,
    @Body() dto: AddCodesDto,
  ) {
    return this.shopService.addCodes(id, dto);
  }

  // ============================================
  // PURCHASES
  // ============================================

  @Get('purchases')
  @RequirePermissions('giftcard-buy.view')
  @ApiOperation({ summary: 'List all shop purchases (admin)' })
  @ApiResponse({ status: 200, description: 'Paginated purchase list' })
  async getPurchases(@Query() query: ShopPurchaseQueryDto) {
    return this.shopService.getPurchases(query);
  }

  @Get('purchases/:id')
  @RequirePermissions('giftcard-buy.view')
  @ApiOperation({ summary: 'Get shop purchase details (admin)' })
  @ApiParam({ name: 'id', description: 'Purchase ID' })
  @ApiResponse({ status: 200, description: 'Purchase details' })
  async getPurchase(@Param('id') id: string) {
    return this.shopService.getPurchaseById(id);
  }

  @Post('purchases/:id/refund')
  @RequirePermissions('giftcard-buy.refund')
  @ApiOperation({ summary: 'Refund a shop purchase' })
  @ApiParam({ name: 'id', description: 'Purchase ID' })
  @ApiResponse({ status: 200, description: 'Purchase refunded' })
  async refundPurchase(
    @Param('id') id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: RefundShopPurchaseDto,
  ) {
    return this.shopService.refundPurchase(id, admin.sub, dto);
  }

  // ============================================
  // STATS
  // ============================================

  @Get('stats')
  @RequireAnyPermission('giftcard-buy.stats', 'giftcard-buy.view')
  @ApiOperation({ summary: 'Get shop sales statistics' })
  @ApiResponse({ status: 200, description: 'Shop statistics' })
  async getStats() {
    return this.shopService.getStats();
  }
}
