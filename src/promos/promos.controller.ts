/**
 * Promo Banner Controllers
 *
 * Public endpoint for mobile + Admin CRUD endpoints.
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
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
import { PromosService } from './promos.service';
import { CreatePromoBannerDto, UpdatePromoBannerDto, PromoBannerQueryDto } from './dto';
import { Public, Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

/**
 * Public controller — no auth required.
 */
@ApiTags('Promos')
@Controller('promos')
export class PromosController {
  constructor(private readonly promosService: PromosService) {}

  @Public()
  @Get('banners')
  @ApiOperation({ summary: 'Get active promo banners (public)' })
  @ApiResponse({ status: 200, description: 'List of active banners' })
  async getActiveBanners() {
    const banners = await this.promosService.getActiveBanners();
    return { success: true, data: banners };
  }
}

/**
 * Admin controller — requires admin JWT + permissions.
 */
@ApiTags('Admin - Promos')
@ApiBearerAuth('JWT-auth')
@Controller('admin/promos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminPromosController {
  constructor(private readonly promosService: PromosService) {}

  @Get('banners')
  @ApiOperation({ summary: 'List all promo banners (admin)' })
  async getBanners(@Query() query: PromoBannerQueryDto) {
    return this.promosService.getBanners(query);
  }

  @Post('banners')
  @ApiOperation({ summary: 'Create a promo banner' })
  async createBanner(@Body() dto: CreatePromoBannerDto) {
    const banner = await this.promosService.createBanner(dto);
    return { success: true, data: banner };
  }

  @Put('banners/:id')
  @ApiOperation({ summary: 'Update a promo banner' })
  @ApiParam({ name: 'id' })
  async updateBanner(
    @Param('id') id: string,
    @Body() dto: UpdatePromoBannerDto,
  ) {
    const banner = await this.promosService.updateBanner(id, dto);
    return { success: true, data: banner };
  }

  @Delete('banners/:id')
  @ApiOperation({ summary: 'Delete a promo banner' })
  @ApiParam({ name: 'id' })
  async deleteBanner(@Param('id') id: string) {
    await this.promosService.deleteBanner(id);
    return { success: true, message: 'Banner deleted' };
  }
}
