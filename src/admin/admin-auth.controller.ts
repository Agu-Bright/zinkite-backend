/**
 * Admin Auth Controller
 * Admin-specific authentication endpoints (separate from user auth)
 */
import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { AdminAuthService } from './admin-auth.service';

class AdminLoginDto {
  @ApiProperty({ example: 'admin@zinkite.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'securepassword' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

class AdminRefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

class Admin2faValidateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tempToken: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  code: string;
}

class Admin2faCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  code: string;
}

@ApiTags('Admin Auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: AdminLoginDto, @Req() req: any) {
    const admin = await this.adminAuthService.validateAdmin(dto.email, dto.password);

    // Update last login IP
    if (req.ip) {
      admin.lastLoginIp = req.ip;
      await admin.save();
    }

    // If 2FA is enabled, return temp token instead of real JWT
    if (admin.twoFactorEnabled) {
      const tempToken = this.adminAuthService.generateTempToken(admin._id.toString());
      return {
        success: true,
        requiresTwoFactor: true,
        tempToken,
      };
    }

    const tokens = await this.adminAuthService.generateAdminTokens(admin);

    return {
      success: true,
      requiresTwoFactor: false,
      data: tokens,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh admin JWT' })
  @ApiResponse({ status: 200, description: 'Token refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() dto: AdminRefreshDto) {
    const tokens = await this.adminAuthService.refreshAdminToken(dto.refreshToken);
    return { success: true, data: tokens };
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get admin profile' })
  @ApiResponse({ status: 200, description: 'Admin profile' })
  async getProfile(@CurrentUser('sub') adminId: string) {
    const profile = await this.adminAuthService.getAdminProfile(adminId);
    return { success: true, data: profile };
  }

  // ─── 2FA Endpoints ────────────────────────────────────────────

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Generate TOTP secret and QR code for 2FA setup' })
  async setup2fa(@CurrentUser('sub') adminId: string) {
    const result = await this.adminAuthService.setup2fa(adminId);
    return { success: true, data: result };
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify TOTP code to enable 2FA' })
  async enable2fa(
    @CurrentUser('sub') adminId: string,
    @Body() dto: Admin2faCodeDto,
  ) {
    await this.adminAuthService.enable2fa(adminId, dto.code);
    return { success: true, message: 'Two-factor authentication enabled' };
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Disable 2FA (requires current TOTP code)' })
  async disable2fa(
    @CurrentUser('sub') adminId: string,
    @Body() dto: Admin2faCodeDto,
  ) {
    await this.adminAuthService.disable2fa(adminId, dto.code);
    return { success: true, message: 'Two-factor authentication disabled' };
  }

  @Post('2fa/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate 2FA code during login (exchanges temp token for real JWT)' })
  async validate2fa(@Body() dto: Admin2faValidateDto) {
    const tokens = await this.adminAuthService.validate2faLogin(dto.tempToken, dto.code);
    return { success: true, data: tokens };
  }
}
