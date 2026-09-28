/**
 * Referral Controller (User-facing)
 *
 * Points-based: view code + points, convert points to wallet, list referrals.
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ReferralService } from './referral.service';
import {
  MyReferralsQueryDto,
  UpdateMyReferralCodeDto,
  ConvertPointsDto,
} from './dto';

@ApiTags('Referral')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'))
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  /** Public reward config (points per referral, ₦ per point). */
  @Get('settings')
  async getSettings() {
    return this.referralService.getReferralSettings();
  }

  /** Everything the referral hub needs: code, points, value, counts. */
  @Get('summary')
  async getSummary(@Req() req: any) {
    const userId = req.user.userId || req.user.sub;
    return this.referralService.getMySummary(userId);
  }

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

  @Get('my-referrals')
  async getMyReferrals(@Req() req: any, @Query() query: MyReferralsQueryDto) {
    const userId = req.user.userId || req.user.sub;
    return this.referralService.getMyReferrals(userId, query);
  }

  @Get('stats')
  async getMyStats(@Req() req: any) {
    const userId = req.user.userId || req.user.sub;
    return this.referralService.getMyStats(userId);
  }

  @Post('convert')
  @ApiOperation({ summary: 'Convert referral points into wallet Naira' })
  async convert(@Req() req: any, @Body() dto: ConvertPointsDto) {
    const userId = req.user.userId || req.user.sub;
    return this.referralService.convertPoints(userId, dto.points);
  }
}
