/**
 * Gift Cards Controller
 * Handles public and authenticated user endpoints for gift cards
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiSecurity,
} from '@nestjs/swagger';
import { GiftCardsService } from './giftcards.service';
import {
  BrandQueryDto,
  CategoryQueryDto,
  GetRateDto,
  SubmitTradeDto,
  TradeQueryDto,
  BrandResponse,
  CategoryResponse,
  CalculatedRateResponse,
  TradeResponse,
} from './dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PinGuard } from '../common/guards/pin.guard';
import { CurrentUser, Public, RequirePin } from '../common/decorators';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@ApiTags('Gift Cards')
@Controller('giftcards')
export class GiftCardsController {
  constructor(private readonly giftCardsService: GiftCardsService) {}

  // ============================================
  // PUBLIC ENDPOINTS (No auth required)
  // ============================================

  @Get('brands')
  @Public()
  @ApiOperation({ summary: 'Get all active gift card brands' })
  @ApiResponse({
    status: 200,
    description: 'List of active brands',
    type: [BrandResponse],
  })
  async getBrands() {
    return this.giftCardsService.getActiveBrands();
  }

  @Get('brands/:id')
  @Public()
  @ApiOperation({ summary: 'Get a single brand by ID' })
  @ApiParam({ name: 'id', description: 'Brand ID' })
  @ApiResponse({
    status: 200,
    description: 'Brand details',
    type: BrandResponse,
  })
  @ApiResponse({ status: 404, description: 'Brand not found' })
  async getBrand(@Param('id') id: string) {
    return this.giftCardsService.getBrandById(id);
  }

  @Get('categories')
  @Public()
  @ApiOperation({ summary: 'Get gift card categories (optionally filtered by brand)' })
  @ApiQuery({ name: 'brandId', required: false, description: 'Filter by brand ID' })
  @ApiResponse({
    status: 200,
    description: 'List of categories',
    type: [CategoryResponse],
  })
  async getCategories(@Query() query: CategoryQueryDto) {
    if (query.brandId) {
      return this.giftCardsService.getActiveCategories(query.brandId);
    }
    // Return paginated results for admin or when no brandId filter
    return this.giftCardsService.getCategories({
      ...query,
      status: query.status || 'ACTIVE' as any,
    });
  }

  @Get('categories/:id')
  @Public()
  @ApiOperation({ summary: 'Get a single category by ID' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({
    status: 200,
    description: 'Category details',
    type: CategoryResponse,
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async getCategory(@Param('id') id: string) {
    return this.giftCardsService.getCategoryById(id);
  }

  @Get('rate')
  @Public()
  @ApiOperation({ summary: 'Calculate rate for a gift card' })
  @ApiQuery({ name: 'categoryId', description: 'Category ID' })
  @ApiQuery({ name: 'cardValue', description: 'Card value in USD' })
  @ApiResponse({
    status: 200,
    description: 'Calculated rate and amount',
    type: CalculatedRateResponse,
  })
  @ApiResponse({ status: 400, description: 'Invalid card value' })
  @ApiResponse({ status: 404, description: 'Category or rate not found' })
  async getRate(@Query() query: GetRateDto) {
    return this.giftCardsService.getApplicableRate(query.categoryId, query.cardValue);
  }

  // ============================================
  // AUTHENTICATED USER ENDPOINTS
  // ============================================

  @Post('trades')
  @UseGuards(JwtAuthGuard, PinGuard)
  @RequirePin()
  @ApiBearerAuth('JWT-auth')
  @ApiSecurity('PIN-auth')
  @ApiOperation({ summary: 'Submit a new gift card trade' })
  @ApiResponse({
    status: 201,
    description: 'Trade submitted successfully',
    type: TradeResponse,
  })
  @ApiResponse({ status: 400, description: 'Invalid request data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Category or rate not found' })
  async submitTrade(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SubmitTradeDto,
  ) {
    return this.giftCardsService.submitTrade(user.sub, dto);
  }

  @Get('trades/my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user\'s trades' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of user\'s trades',
  })
  async getMyTrades(
    @CurrentUser() user: JwtPayload,
    @Query() query: TradeQueryDto,
  ) {
    return this.giftCardsService.getUserTrades(user.sub, query);
  }

  @Get('trades/my/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get a specific trade by ID' })
  @ApiParam({ name: 'id', description: 'Trade ID' })
  @ApiResponse({
    status: 200,
    description: 'Trade details',
    type: TradeResponse,
  })
  @ApiResponse({ status: 404, description: 'Trade not found' })
  async getMyTrade(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.giftCardsService.getTradeById(id, user.sub);
  }

  @Delete('trades/my/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Cancel a pending trade' })
  @ApiParam({ name: 'id', description: 'Trade ID' })
  @ApiResponse({
    status: 200,
    description: 'Trade cancelled successfully',
    type: TradeResponse,
  })
  @ApiResponse({ status: 400, description: 'Trade cannot be cancelled' })
  @ApiResponse({ status: 404, description: 'Trade not found' })
  async cancelTrade(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.giftCardsService.cancelTrade(id, user.sub);
  }
}
