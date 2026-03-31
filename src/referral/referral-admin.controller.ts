/**
 * Referral Admin Controller
 *
 * Admin endpoints for managing referral challenges.
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../admin/guards/permissions.guard';
import { ReferralService } from './referral.service';
import {
  CreateChallengeDto,
  UpdateChallengeDto,
  ChallengesQueryDto,
} from './dto';
import { RequirePermissions } from '../admin/decorators/require-permissions.decorator';

@ApiTags('Admin Referral')
@Controller('admin/referral')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth('JWT-auth')
export class ReferralAdminController {
  constructor(private readonly referralService: ReferralService) {}

  /**
   * Create a new referral challenge
   */
  @Post('challenges')
  @RequirePermissions('referrals.manage')
  async createChallenge(@Req() req: any, @Body() dto: CreateChallengeDto) {
    const adminId = req.user.adminId || req.user.sub;
    return this.referralService.createChallenge(dto, adminId);
  }

  /**
   * List all challenges (paginated, filterable)
   */
  @Get('challenges')
  @RequirePermissions('referrals.view')
  async getChallenges(@Query() query: ChallengesQueryDto) {
    return this.referralService.getChallenges(query);
  }

  /**
   * Get challenge detail with stats
   */
  @Get('challenges/:id')
  @RequirePermissions('referrals.view')
  async getChallengeDetail(@Param('id') id: string) {
    return this.referralService.getChallengeWithStats(id);
  }

  /**
   * Update challenge settings
   */
  @Patch('challenges/:id')
  @RequirePermissions('referrals.manage')
  async updateChallenge(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateChallengeDto,
  ) {
    const adminId = req.user.adminId || req.user.sub;
    return this.referralService.updateChallenge(id, dto, adminId);
  }

  /**
   * Start a challenge (DRAFT/PAUSED → ACTIVE)
   */
  @Post('challenges/:id/start')
  @RequirePermissions('referrals.manage')
  @HttpCode(HttpStatus.OK)
  async startChallenge(@Req() req: any, @Param('id') id: string) {
    const adminId = req.user.adminId || req.user.sub;
    return this.referralService.startChallenge(id, adminId);
  }

  /**
   * Pause an active challenge
   */
  @Post('challenges/:id/pause')
  @RequirePermissions('referrals.manage')
  @HttpCode(HttpStatus.OK)
  async pauseChallenge(@Req() req: any, @Param('id') id: string) {
    const adminId = req.user.adminId || req.user.sub;
    return this.referralService.pauseChallenge(id, adminId);
  }

  /**
   * End challenge and reward winners
   */
  @Post('challenges/:id/end')
  @RequirePermissions('referrals.manage')
  @HttpCode(HttpStatus.OK)
  async endChallenge(@Req() req: any, @Param('id') id: string) {
    const adminId = req.user.adminId || req.user.sub;
    return this.referralService.endChallengeAndRewardWinners(id, adminId);
  }

  /**
   * Get full leaderboard for a challenge
   */
  @Get('challenges/:id/leaderboard')
  @RequirePermissions('referrals.view')
  async getLeaderboard(@Param('id') id: string) {
    return this.referralService.getAdminLeaderboard(id);
  }

  /**
   * Get global referral stats
   */
  @Get('stats')
  @RequirePermissions('referrals.view')
  async getStats() {
    return this.referralService.getAdminStats();
  }
}
