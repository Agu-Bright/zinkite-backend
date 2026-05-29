/**
 * User Task DTOs
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsDateString,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { UserTaskStatus } from '../schemas/user-task.schema';

// -- Admin: Create Task --

export class CreateUserTaskDto {
  @ApiProperty({ example: 'Complete your profile' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Reward amount in kobo', example: 10000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  rewardAmountKobo?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  displayOrder?: number;

  @ApiPropertyOptional({ example: 'checkmark-circle' })
  @IsOptional()
  @IsString()
  iconName?: string;

  @ApiPropertyOptional({ example: '/(modals)/some-route' })
  @IsOptional()
  @IsString()
  actionRoute?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

// -- Admin: Update Task --

export class UpdateUserTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Reward amount in kobo' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  rewardAmountKobo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  iconName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actionRoute?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

// -- Admin: Query Tasks --

export class UserTaskQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: UserTaskStatus })
  @IsOptional()
  @IsEnum(UserTaskStatus)
  status?: UserTaskStatus;
}
