/**
 * Admin Roles Controller
 * CRUD endpoints for managing admin roles
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { AdminRolesService, CreateAdminRoleDto, UpdateAdminRoleDto } from './admin-roles.service';

@ApiTags('Admin - Roles')
@Controller('admin/roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth('JWT-auth')
export class AdminRolesController {
  constructor(private readonly adminRolesService: AdminRolesService) {}

  @Get()
  @RequirePermissions('admin.roles.view')
  @ApiOperation({ summary: 'List all roles' })
  @ApiResponse({ status: 200, description: 'Roles list' })
  async findAll() {
    const roles = await this.adminRolesService.findAll();
    return { success: true, data: roles };
  }

  @Get('permissions')
  @RequirePermissions('admin.roles.view')
  @ApiOperation({ summary: 'Get all available permissions' })
  @ApiResponse({ status: 200, description: 'Available permissions' })
  async getPermissions() {
    const permissions = this.adminRolesService.getAvailablePermissions();
    return { success: true, data: permissions };
  }

  @Post()
  @RequirePermissions('admin.roles.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create custom role' })
  @ApiResponse({ status: 201, description: 'Role created' })
  async create(@Body() dto: CreateAdminRoleDto) {
    const role = await this.adminRolesService.create(dto);
    return { success: true, data: role };
  }

  @Get(':id')
  @RequirePermissions('admin.roles.view')
  @ApiOperation({ summary: 'Get role detail' })
  @ApiResponse({ status: 200, description: 'Role detail' })
  async findById(@Param('id') id: string) {
    const role = await this.adminRolesService.findById(id);
    return { success: true, data: role };
  }

  @Patch(':id')
  @RequirePermissions('admin.roles.manage')
  @ApiOperation({ summary: 'Update role' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  async update(@Param('id') id: string, @Body() dto: UpdateAdminRoleDto) {
    const role = await this.adminRolesService.update(id, dto);
    return { success: true, data: role };
  }

  @Delete(':id')
  @RequirePermissions('admin.roles.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete custom role' })
  @ApiResponse({ status: 200, description: 'Role deleted' })
  async delete(@Param('id') id: string) {
    await this.adminRolesService.delete(id);
    return { success: true, message: 'Role deleted' };
  }
}
