import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('public')
  @Public()
  @ApiOperation({ summary: 'Get public app settings (no auth required)' })
  @ApiResponse({ status: 200, description: 'Key-value map of public settings' })
  async getPublicSettings() {
    return this.settingsService.getPublicSettings();
  }
}
