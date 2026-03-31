import { IsString, IsNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSettingItemDto {
  @ApiProperty({ description: 'Setting key', example: 'maintenance_mode' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ description: 'New value for the setting' })
  @IsNotEmpty()
  value: any;
}

export class BulkUpdateSettingsDto {
  @ApiProperty({ type: [UpdateSettingItemDto], description: 'Settings to update' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSettingItemDto)
  settings: UpdateSettingItemDto[];
}
