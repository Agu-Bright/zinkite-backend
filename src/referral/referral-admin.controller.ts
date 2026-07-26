/**
 * Admin endpoints for the standard referral reward system.
 * Campaign/challenge management is intentionally not exposed.
 */
import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../admin/guards/permissions.guard';
import { RequirePermissions } from '../admin/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  AdminReferralEarningsQueryDto,
  UpdateReferralSettingsDto,
} from './dto';
import { ReferralService } from './referral.service';

@ApiTags('Admin Referral')
@Controller('admin/referral')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth('JWT-auth')
export class ReferralAdminController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('settings')
  @RequirePermissions('referrals.view')
  async getSettings() {
    return this.referralService.getReferralSettings();
  }

  @Patch('settings')
  @RequirePermissions('referrals.manage')
  async updateSettings(@Body() dto: UpdateReferralSettingsDto) {
    return this.referralService.updateReferralSettings(dto);
  }

  @Get('earnings')
  @RequirePermissions('referrals.view')
  async getEarnings(@Query() query: AdminReferralEarningsQueryDto) {
    return this.referralService.getAdminReferralEarnings(query);
  }

  @Get('stats')
  @RequirePermissions('referrals.view')
  async getStats() {
    return this.referralService.getAdminStats();
  }
}
