/**
 * Admin Roles Service
 * CRUD operations for admin role management
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AdminRole, AdminRoleDocument } from './schemas/admin-role.schema';
import { AdminUser, AdminUserDocument } from './schemas/admin-user.schema';
import { ALL_PERMISSIONS } from './decorators/require-permissions.decorator';

export interface CreateAdminRoleDto {
  name: string;
  description?: string;
  permissions: string[];
}

export interface UpdateAdminRoleDto {
  name?: string;
  description?: string;
  permissions?: string[];
  isActive?: boolean;
}

@Injectable()
export class AdminRolesService {
  private readonly logger = new Logger(AdminRolesService.name);

  constructor(
    @InjectModel(AdminRole.name)
    private readonly adminRoleModel: Model<AdminRoleDocument>,
    @InjectModel(AdminUser.name)
    private readonly adminUserModel: Model<AdminUserDocument>,
  ) {}

  /**
   * List all roles
   */
  async findAll(): Promise<AdminRoleDocument[]> {
    return this.adminRoleModel.find().sort({ isSystem: -1, name: 1 });
  }

  /**
   * Get role by ID
   */
  async findById(id: string): Promise<AdminRoleDocument> {
    const role = await this.adminRoleModel.findById(id);
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  /**
   * Create custom role
   */
  async create(dto: CreateAdminRoleDto): Promise<AdminRoleDocument> {
    // Validate permissions
    const invalidPerms = dto.permissions.filter(
      (p) => !ALL_PERMISSIONS.includes(p as any),
    );
    if (invalidPerms.length > 0) {
      throw new BadRequestException(
        `Invalid permissions: ${invalidPerms.join(', ')}`,
      );
    }

    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check uniqueness
    const existing = await this.adminRoleModel.findOne({
      $or: [{ name: dto.name }, { slug }],
    });
    if (existing) {
      throw new ConflictException('A role with this name already exists');
    }

    const role = await this.adminRoleModel.create({
      name: dto.name,
      slug,
      description: dto.description || '',
      permissions: dto.permissions,
      isSystem: false,
    });

    this.logger.log(`Custom role created: ${role.name}`);
    return role;
  }

  /**
   * Update role (cannot edit system roles)
   */
  async update(id: string, dto: UpdateAdminRoleDto): Promise<AdminRoleDocument> {
    const role = await this.adminRoleModel.findById(id);
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (role.isSystem) {
      throw new BadRequestException('Cannot edit system roles');
    }

    if (dto.permissions) {
      const invalidPerms = dto.permissions.filter(
        (p) => !ALL_PERMISSIONS.includes(p as any),
      );
      if (invalidPerms.length > 0) {
        throw new BadRequestException(
          `Invalid permissions: ${invalidPerms.join(', ')}`,
        );
      }
      role.permissions = dto.permissions;
    }

    if (dto.name) {
      role.name = dto.name;
      role.slug = dto.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    if (dto.description !== undefined) role.description = dto.description;
    if (dto.isActive !== undefined) role.isActive = dto.isActive;

    await role.save();
    this.logger.log(`Role updated: ${role.name}`);
    return role;
  }

  /**
   * Delete custom role (cannot delete system roles)
   */
  async delete(id: string): Promise<void> {
    const role = await this.adminRoleModel.findById(id);
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (role.isSystem) {
      throw new BadRequestException('Cannot delete system roles');
    }

    // Check if any admins are assigned
    const assignedCount = await this.adminUserModel.countDocuments({ roleId: role._id });
    if (assignedCount > 0) {
      throw new BadRequestException(
        `Cannot delete role: ${assignedCount} admin(s) are still assigned to this role`,
      );
    }

    await this.adminRoleModel.findByIdAndDelete(id);
    this.logger.log(`Role deleted: ${role.name}`);
  }

  /**
   * Get all available permissions (for UI)
   */
  getAvailablePermissions(): string[] {
    return [...ALL_PERMISSIONS];
  }
}
