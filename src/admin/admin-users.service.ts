/**
 * Admin Users Service
 * CRUD operations for admin user management
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AdminUser, AdminUserDocument, AdminUserStatus } from './schemas/admin-user.schema';
import { AdminRole, AdminRoleDocument } from './schemas/admin-role.schema';
import { paginate, calculateSkip } from '../common/utils/helpers';
import { PaginatedResult } from '../common/dto/pagination.dto';

export interface CreateAdminUserDto {
  email: string;
  fullName: string;
  roleId: string;
}

export interface UpdateAdminUserDto {
  fullName?: string;
  roleId?: string;
  status?: AdminUserStatus;
}

export interface AdminUsersQueryDto {
  page?: number;
  limit?: number;
  roleId?: string;
  status?: AdminUserStatus;
  search?: string;
}

function generateSecurePassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '@#$!%*?&';
  const all = upper + lower + digits + special;

  // Ensure at least one of each required character class
  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
  const base = [pick(upper), pick(lower), pick(digits), pick(special)];

  // Fill remaining 8 characters from the full set
  for (let i = 0; i < 8; i++) {
    base.push(pick(all));
  }

  // Shuffle
  return base.sort(() => Math.random() - 0.5).join('');
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @InjectModel(AdminUser.name)
    private readonly adminUserModel: Model<AdminUserDocument>,
    @InjectModel(AdminRole.name)
    private readonly adminRoleModel: Model<AdminRoleDocument>,
  ) {}

  /**
   * List admin users with filters
   */
  async findAll(query: AdminUsersQueryDto): Promise<PaginatedResult<any>> {
    const { page = 1, limit = 20, roleId, status, search } = query;
    const filter: any = {};

    if (roleId) filter.roleId = new Types.ObjectId(roleId);
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { email: { $regex: search, $options: 'i' } },
        { fullName: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await this.adminUserModel.countDocuments(filter);
    const data = await this.adminUserModel
      .find(filter)
      .select('-passwordHash -twoFactorSecret')
      .populate('roleId', 'name slug description permissions')
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit)
      .lean();

    return paginate(data, total, page, limit);
  }

  /**
   * Get admin user by ID
   */
  async findById(id: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid admin user ID');
    }

    const admin = await this.adminUserModel
      .findById(id)
      .select('-passwordHash -twoFactorSecret')
      .populate('roleId', 'name slug description permissions')
      .populate('createdBy', 'fullName email')
      .lean();

    if (!admin) {
      throw new NotFoundException('Admin user not found');
    }

    return admin;
  }

  /**
   * Create new admin user — password is auto-generated
   */
  async create(
    dto: CreateAdminUserDto,
    createdBy: string,
  ): Promise<{ admin: any; temporaryPassword: string }> {
    // Check email uniqueness
    const existing = await this.adminUserModel.findOne({
      email: dto.email.toLowerCase().trim(),
    });
    if (existing) {
      throw new ConflictException('An admin with this email already exists');
    }

    // Validate role exists
    const role = await this.adminRoleModel.findById(dto.roleId);
    if (!role) {
      throw new BadRequestException('Invalid role ID');
    }

    const temporaryPassword = generateSecurePassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    const admin = await this.adminUserModel.create({
      email: dto.email.toLowerCase().trim(),
      fullName: dto.fullName.trim(),
      passwordHash,
      roleId: new Types.ObjectId(dto.roleId),
      createdBy: createdBy ? new Types.ObjectId(createdBy) : null,
    });

    this.logger.log(`Admin user created: ${admin.email} by ${createdBy}`);

    const populated = await this.findById(admin._id.toString());
    return { admin: populated, temporaryPassword };
  }

  /**
   * Update admin user
   */
  async update(id: string, dto: UpdateAdminUserDto): Promise<any> {
    const admin = await this.adminUserModel.findById(id);
    if (!admin) {
      throw new NotFoundException('Admin user not found');
    }

    if (dto.roleId) {
      if (!Types.ObjectId.isValid(dto.roleId)) {
        throw new BadRequestException('Invalid role ID');
      }
      const role = await this.adminRoleModel.findById(dto.roleId);
      if (!role) {
        throw new BadRequestException('Role not found');
      }
      admin.roleId = new Types.ObjectId(dto.roleId);
    }

    if (dto.fullName) admin.fullName = dto.fullName.trim();
    if (dto.status) {
      if (!Object.values(AdminUserStatus).includes(dto.status)) {
        throw new BadRequestException(`Invalid status. Must be one of: ${Object.values(AdminUserStatus).join(', ')}`);
      }
      admin.status = dto.status;
    }

    await admin.save();
    this.logger.log(`Admin user updated: ${admin.email}`);

    return this.findById(id);
  }

  /**
   * Reset admin user password — generates a new password and returns it
   */
  async resetPassword(id: string): Promise<{ temporaryPassword: string }> {
    const admin = await this.adminUserModel.findById(id);
    if (!admin) {
      throw new NotFoundException('Admin user not found');
    }

    const temporaryPassword = generateSecurePassword();
    admin.passwordHash = await bcrypt.hash(temporaryPassword, 12);
    await admin.save();

    this.logger.log(`Password reset for admin: ${admin.email}`);
    return { temporaryPassword };
  }

  /**
   * Deactivate admin user
   */
  async deactivate(id: string): Promise<any> {
    const admin = await this.adminUserModel.findById(id);
    if (!admin) {
      throw new NotFoundException('Admin user not found');
    }

    admin.status = AdminUserStatus.DEACTIVATED;
    await admin.save();

    this.logger.log(`Admin user deactivated: ${admin.email}`);
    return this.findById(id);
  }
}
