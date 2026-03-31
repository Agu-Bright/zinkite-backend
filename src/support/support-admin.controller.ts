/**
 * Support Admin Controller
 * Admin endpoints for managing support tickets with role-based filtering
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../admin/guards/permissions.guard';
import {
  RequirePermissions,
  RequireAnyPermission,
} from '../admin/decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { SupportService } from './support.service';
import {
  TicketsQueryDto,
  AdminTicketReplyDto,
  UpdateTicketStatusDto,
  ReassignTicketDto,
} from './dto';

function validateObjectId(id: string, label = 'id'): void {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestException(`Invalid ${label}: must be a valid MongoDB ObjectId`);
  }
}

@ApiTags('Admin - Support')
@Controller('admin/support')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth('JWT-auth')
export class SupportAdminController {
  constructor(private readonly supportService: SupportService) {}

  @Get('tickets')
  @RequireAnyPermission('complaints.view')
  @ApiOperation({ summary: 'List support tickets (role-filtered)' })
  @ApiResponse({ status: 200, description: 'Paginated ticket list' })
  async getTickets(
    @CurrentUser() admin: JwtPayload,
    @Query() query: TicketsQueryDto,
  ) {
    const result = await this.supportService.getAdminTickets(
      admin.roleSlug || '',
      admin.permissions || [],
      query,
    );
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get('tickets/stats')
  @RequireAnyPermission('complaints.view')
  @ApiOperation({ summary: 'Get ticket statistics' })
  @ApiResponse({ status: 200, description: 'Ticket stats by status/priority' })
  async getTicketStats(@CurrentUser() admin: JwtPayload) {
    const stats = await this.supportService.getTicketStats(
      admin.roleSlug || '',
      admin.permissions || [],
    );
    return { success: true, data: stats };
  }

  @Get('tickets/:id')
  @RequireAnyPermission('complaints.view')
  @ApiOperation({ summary: 'Get ticket detail with all messages' })
  @ApiResponse({ status: 200, description: 'Full ticket detail' })
  async getTicketById(@Param('id') id: string) {
    validateObjectId(id, 'ticket ID');
    const ticket = await this.supportService.getAdminTicketById(id);
    return { success: true, data: ticket };
  }

  @Post('tickets/:id/reply')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('complaints.manage')
  @ApiOperation({ summary: 'Reply to a ticket (supports internal notes)' })
  @ApiResponse({ status: 200, description: 'Reply added' })
  async replyToTicket(
    @CurrentUser() admin: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AdminTicketReplyDto,
  ) {
    validateObjectId(id, 'ticket ID');
    const adminName = admin.email || 'Admin';
    const ticket = await this.supportService.addAdminReply(
      id,
      admin.adminId || admin.sub,
      adminName,
      dto,
    );
    return { success: true, data: ticket };
  }

  @Patch('tickets/:id/status')
  @RequirePermissions('complaints.manage')
  @ApiOperation({ summary: 'Update ticket status' })
  @ApiResponse({ status: 200, description: 'Status updated' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    validateObjectId(id, 'ticket ID');
    const ticket = await this.supportService.updateTicketStatus(id, dto);
    return { success: true, data: ticket };
  }

  @Patch('tickets/:id/assign')
  @RequirePermissions('complaints.assign')
  @ApiOperation({ summary: 'Reassign ticket to different role or admin' })
  @ApiResponse({ status: 200, description: 'Ticket reassigned' })
  async reassignTicket(
    @Param('id') id: string,
    @Body() dto: ReassignTicketDto,
  ) {
    validateObjectId(id, 'ticket ID');
    const ticket = await this.supportService.reassignTicket(id, dto);
    return { success: true, data: ticket };
  }
}
