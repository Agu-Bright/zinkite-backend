/**
 * Support Controller (User-facing)
 * Endpoints for users to create, view, and reply to support tickets
 */
import {
  Controller,
  Get,
  Post,
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
import { CurrentUser } from '../common/decorators';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { SupportService } from './support.service';
import { CreateTicketDto, TicketReplyDto, MyTicketsQueryDto } from './dto';

function validateObjectId(id: string, label = 'id'): void {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestException(`Invalid ${label}: must be a valid MongoDB ObjectId`);
  }
}

@ApiTags('Support')
@Controller('support/tickets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  @ApiOperation({ summary: 'Create a support ticket' })
  @ApiResponse({ status: 201, description: 'Ticket created' })
  async createTicket(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTicketDto,
  ) {
    const userName = user.email || 'User';
    const ticket = await this.supportService.createTicket(user.sub, userName, dto);
    return { success: true, data: ticket };
  }

  @Get('my')
  @ApiOperation({ summary: 'List my support tickets' })
  @ApiResponse({ status: 200, description: 'User tickets' })
  async getMyTickets(
    @CurrentUser('sub') userId: string,
    @Query() query: MyTicketsQueryDto,
  ) {
    const result = await this.supportService.getMyTickets(userId, query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ticket detail' })
  @ApiResponse({ status: 200, description: 'Ticket detail with messages' })
  async getTicketById(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    validateObjectId(id, 'ticket ID');
    const ticket = await this.supportService.getTicketById(id, userId);
    return { success: true, data: ticket };
  }

  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reply to a ticket' })
  @ApiResponse({ status: 200, description: 'Reply added' })
  async replyToTicket(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: TicketReplyDto,
  ) {
    validateObjectId(id, 'ticket ID');
    const userName = user.email || 'User';
    const ticket = await this.supportService.addUserReply(id, user.sub, userName, dto);
    return { success: true, data: ticket };
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a ticket' })
  @ApiResponse({ status: 200, description: 'Ticket closed' })
  async closeTicket(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    validateObjectId(id, 'ticket ID');
    const ticket = await this.supportService.closeTicket(id, userId);
    return { success: true, data: ticket };
  }
}
