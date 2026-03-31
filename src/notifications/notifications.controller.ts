import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { NotificationsService } from './notifications.service';
import {
  RegisterTokenDto,
  UnregisterTokenDto,
  NotificationInboxQueryDto,
} from './dto';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ============================================
  // TOKEN MANAGEMENT
  // ============================================

  @Post('register-token')
  @ApiOperation({ summary: 'Register push notification token' })
  async registerToken(
    @CurrentUser('sub') userId: string,
    @Body() dto: RegisterTokenDto,
  ) {
    await this.notificationsService.registerToken(
      userId,
      dto.token,
      dto.platform,
    );
    return { message: 'Token registered successfully' };
  }

  @Delete('unregister-token')
  @ApiOperation({ summary: 'Unregister push notification token' })
  async unregisterToken(
    @CurrentUser('sub') userId: string,
    @Body() dto: UnregisterTokenDto,
  ) {
    await this.notificationsService.unregisterToken(userId, dto.token);
    return { message: 'Token unregistered successfully' };
  }

  // ============================================
  // NOTIFICATION INBOX
  // ============================================

  @Get()
  @ApiOperation({ summary: 'Get notification inbox (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated notifications' })
  async getNotifications(
    @CurrentUser('sub') userId: string,
    @Query() query: NotificationInboxQueryDto,
  ) {
    return this.notificationsService.getUserNotifications(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiResponse({ status: 200, description: 'Unread count' })
  async getUnreadCount(@CurrentUser('sub') userId: string) {
    const count = await this.notificationsService.getUnreadCount(userId);
    return { count };
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllAsRead(@CurrentUser('sub') userId: string) {
    await this.notificationsService.markAllAsRead(userId);
    return { message: 'All notifications marked as read' };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notification as read' })
  async markAsRead(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    await this.notificationsService.markAsRead(userId, id);
    return { message: 'Notification marked as read' };
  }
}
