/**
 * Referral Controller (User-facing)
 *
 * Endpoints for users to view challenges, leaderboard,
 * their referrals, and their referral code.
 */
import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ReferralService } from './referral.service';
import { MyReferralsQueryDto, UpdateMyReferralCodeDto } from './dto';

@ApiTags('Referral')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'))
@Controller('referral')
export class ReferralController {
  constructor(
    private readonly referralService: ReferralService,
  ) {}

  @Get('settings')
  async getSettings() {
    return this.referralService.getReferralSettings();
  }

  /**
   * Get active challenges with user's progress
   */
  @Get('challenges/active')
  async getActiveChallenges(@Req() req: any) {
    const userId = req.user.userId || req.user.sub;
    return this.referralService.getActiveChallengesForUser(userId);
  }

  /**
   * Get challenge detail with user's progress
   */
  @Get('challenges/:id')
  async getChallengeDetail(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.userId || req.user.sub;
    return this.referralService.getChallengeForUser(id, userId);
  }

  /**
   * Get leaderboard for a challenge
   */
  @Get('challenges/:id/leaderboard')
  async getLeaderboard(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    const userId = req.user.userId || req.user.sub;
    return this.referralService.getLeaderboard(id, userId);
  }

  /**
   * Get user's referral list
   */
  @Get('my-referrals')
  async getMyReferrals(
    @Req() req: any,
    @Query() query: MyReferralsQueryDto,
  ) {
    const userId = req.user.userId || req.user.sub;
    return this.referralService.getMyReferrals(userId, query);
  }

  /**
   * Get user's referral code
   */
  @Get('my-code')
  async getMyCode(@Req() req: any) {
    const userId = req.user.userId || req.user.sub;
    const referralCode =
      await this.referralService.getOrCreateUserReferralCode(userId);
    return { referralCode };
  }

  @Patch('my-code')
  @ApiOperation({ summary: "Update the current user's unique referral code" })
  async updateMyCode(@Req() req: any, @Body() dto: UpdateMyReferralCodeDto) {
    const userId = req.user.userId || req.user.sub;
    const referralCode = await this.referralService.updateUserReferralCode(
      userId,
      dto.referralCode,
    );
    return { referralCode };
  }

  /**
   * Get user's referral stats
   */
  @Get('stats')
  async getMyStats(@Req() req: any) {
    const userId = req.user.userId || req.user.sub;
    return this.referralService.getMyStats(userId);
  }
}
