import { IsString, IsEnum, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { NotificationType } from '../schemas/user-notification.schema';

export class RegisterTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxx]' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ enum: ['ios', 'android'], example: 'ios' })
  @IsEnum(['ios', 'android'])
  platform: string;
}

export class UnregisterTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxx]' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class NotificationInboxQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by type', enum: NotificationType })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional({ description: 'Filter by read status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isRead?: boolean;
}
