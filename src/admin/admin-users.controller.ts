/**
 * Admin Users Controller
 * CRUD endpoints for managing admin users
 */
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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators';
import { AdminUsersService, CreateAdminUserDto, UpdateAdminUserDto, AdminUsersQueryDto } from './admin-users.service';

@ApiTags('Admin - Admin Users')
@Controller('admin/users/admins')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth('JWT-auth')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @RequirePermissions('admin.users.view')
  @ApiOperation({ summary: 'List admin users' })
  @ApiResponse({ status: 200, description: 'Admin users list' })
  async findAll(@Query() query: AdminUsersQueryDto) {
    const result = await this.adminUsersService.findAll(query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Post()
  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create admin user — password is auto-generated and returned once' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'fullName', 'roleId'],
      properties: {
        email: { type: 'string', example: 'jane@zinkite.com' },
        fullName: { type: 'string', example: 'Jane Doe' },
        roleId: { type: 'string', example: '64a1b2c3d4e5f6a7b8c9d0e1' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Admin user created. temporaryPassword is shown only once.',
  })
  async create(
    @Body() dto: CreateAdminUserDto,
    @CurrentUser('sub') createdBy: string,
  ) {
    const { admin, temporaryPassword } = await this.adminUsersService.create(dto, createdBy);
    return {
      success: true,
      message: 'Admin user created. Share the temporaryPassword with the user — it will not be shown again.',
      data: admin,
      temporaryPassword,
    };
  }

  @Get(':id')
  @RequirePermissions('admin.users.view')
  @ApiOperation({ summary: 'Get admin user detail' })
  @ApiParam({ name: 'id', description: 'Admin User ID' })
  @ApiResponse({ status: 200, description: 'Admin user detail' })
  @ApiResponse({ status: 404, description: 'Admin user not found' })
  async findById(@Param('id') id: string) {
    const admin = await this.adminUsersService.findById(id);
    return { success: true, data: admin };
  }

  @Patch(':id')
  @RequirePermissions('admin.users.manage')
  @ApiOperation({ summary: 'Update admin user (fullName, roleId, status)' })
  @ApiParam({ name: 'id', description: 'Admin User ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        fullName: { type: 'string', example: 'Jane Doe' },
        roleId: { type: 'string', example: '64a1b2c3d4e5f6a7b8c9d0e1' },
        status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Admin user updated' })
  @ApiResponse({ status: 404, description: 'Admin user not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    const admin = await this.adminUsersService.update(id, dto);
    return { success: true, data: admin };
  }

  @Post(':id/reset-password')
  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset admin user password — generates and returns a new temporary password' })
  @ApiParam({ name: 'id', description: 'Admin User ID' })
  @ApiResponse({
    status: 200,
    description: 'Password reset. New temporaryPassword is shown only once.',
  })
  @ApiResponse({ status: 404, description: 'Admin user not found' })
  async resetPassword(@Param('id') id: string) {
    const { temporaryPassword } = await this.adminUsersService.resetPassword(id);
    return {
      success: true,
      message: 'Password reset successfully. Share the temporaryPassword with the user — it will not be shown again.',
      temporaryPassword,
    };
  }

  @Delete(':id')
  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate admin user' })
  @ApiParam({ name: 'id', description: 'Admin User ID' })
  @ApiResponse({ status: 200, description: 'Admin user deactivated' })
  @ApiResponse({ status: 404, description: 'Admin user not found' })
  async deactivate(@Param('id') id: string) {
    const admin = await this.adminUsersService.deactivate(id);
    return { success: true, data: admin };
  }
}
