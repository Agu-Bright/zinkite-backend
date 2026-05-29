/**
 * Seed Script — Predefined Admin Roles & Initial Super Admin
 *
 * Run: npx ts-node -r tsconfig-paths/register src/admin/seeds/seed-roles.ts
 * Or import seedAdminRoles() from the admin module's onModuleInit()
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AdminRole, AdminRoleDocument } from '../schemas/admin-role.schema';
import { AdminUser, AdminUserDocument } from '../schemas/admin-user.schema';
import { ALL_PERMISSIONS } from '../decorators/require-permissions.decorator';

/**
 * Predefined system roles
 */
const SYSTEM_ROLES = [
  {
    name: 'Super Admin',
    slug: 'super-admin',
    description: 'Full access to all platform features',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    name: 'Finance Admin',
    slug: 'finance-admin',
    description: 'Financial operations and reporting',
    permissions: [
      'dashboard.view', 'dashboard.analytics',
      'users.view',
      'wallet.view', 'wallet.credit', 'wallet.debit', 'wallet.freeze', 'wallet.limits',
      'transactions.view', 'transactions.refund', 'transactions.retry', 'transactions.resolve', 'transactions.export',
      'withdrawals.view', 'topups.view',
      'reports.view', 'reports.generate', 'reports.export',
      'audit.view',
      'reconciliation.view', 'reconciliation.manage',
      'giftcard-buy.view', 'giftcard-buy.stats',
      'complaints.view', 'complaints.manage',
    ],
  },
  {
    name: 'Gift Card Admin',
    slug: 'gift-card-admin',
    description: 'Gift card trading management',
    permissions: [
      'dashboard.view',
      'users.view',
      'giftcards.trades.view', 'giftcards.trades.approve', 'giftcards.trades.reject', 'giftcards.trades.escalate',
      'giftcards.brands.view', 'giftcards.brands.manage',
      'giftcards.rates.view', 'giftcards.rates.manage',
      'giftcard-buy.view', 'giftcard-buy.manage', 'giftcard-buy.sync', 'giftcard-buy.refund', 'giftcard-buy.stats',
      'reports.view',
      'complaints.view', 'complaints.manage',
    ],
  },
  {
    name: 'Support Agent',
    slug: 'support-agent',
    description: 'Customer support and complaint handling',
    permissions: [
      'dashboard.view',
      'users.view', 'users.edit',
      'transactions.view',
      'complaints.view', 'complaints.manage', 'complaints.assign',
      'withdrawals.view',
      'topups.view',
      'giftcard-buy.view',
      'referrals.view',
    ],
  },
  {
    name: 'Auditor',
    slug: 'auditor',
    description: 'Read-only access for auditing and compliance',
    permissions: [
      'dashboard.view', 'dashboard.analytics',
      'users.view',
      'wallet.view',
      'transactions.view',
      'giftcards.trades.view', 'giftcards.brands.view', 'giftcards.rates.view',
      'crypto.trades.view', 'crypto.rates.view', 'crypto.supported.view',
      'vtu.view',
      'electricity.view',
      'withdrawals.view',
      'topups.view',
      'settings.view',
      'admin.users.view',
      'admin.roles.view',
      'audit.view',
      'reports.view', 'reports.generate', 'reports.export',
      'complaints.view',
      'notifications.view',
      'provider-health.view',
      'reconciliation.view',
      'giftcard-buy.view', 'giftcard-buy.stats',
      'referrals.view',
    ],
  },
];

@Injectable()
export class AdminSeedService implements OnModuleInit {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    @InjectModel(AdminRole.name)
    private readonly adminRoleModel: Model<AdminRoleDocument>,
    @InjectModel(AdminUser.name)
    private readonly adminUserModel: Model<AdminUserDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.seedRoles();
    await this.seedSuperAdmin();
  }

  /**
   * Seed predefined system roles (upsert — won't duplicate)
   */
  async seedRoles(): Promise<void> {
    for (const roleDef of SYSTEM_ROLES) {
      const existing = await this.adminRoleModel.findOne({
        $or: [{ slug: roleDef.slug }, { name: roleDef.name }],
      });

      if (existing) {
        // Update permissions on existing system roles to pick up new permissions
        existing.slug = roleDef.slug;
        existing.permissions = roleDef.permissions;
        existing.description = roleDef.description;
        await existing.save();
        this.logger.log(`Updated system role: ${roleDef.name}`);
      } else {
        await this.adminRoleModel.create({
          ...roleDef,
          isSystem: true,
          isActive: true,
        });
        this.logger.log(`Created system role: ${roleDef.name}`);
      }
    }
  }

  /**
   * Seed initial Super Admin user from env vars
   */
  async seedSuperAdmin(): Promise<void> {
    const email = this.configService.get<string>('ADMIN_EMAIL');
    const password = this.configService.get<string>('ADMIN_PASSWORD');

    if (!email || !password) {
      this.logger.warn(
        'ADMIN_EMAIL and ADMIN_PASSWORD env vars not set — skipping Super Admin seed',
      );
      return;
    }

    // Check if already exists
    const existing = await this.adminUserModel.findOne({
      email: email.toLowerCase().trim(),
    });
    if (existing) {
      // Ensure existing admin has super-admin role
      const superRole = await this.adminRoleModel.findOne({ slug: 'super-admin' });
      if (superRole && String(existing.roleId) !== String(superRole._id)) {
        existing.roleId = superRole._id;
        await existing.save();
        this.logger.log(`Updated ${email} to Super Admin role`);
      } else {
        this.logger.log(`Super Admin already exists: ${email}`);
      }
      return;
    }

    // Get super-admin role
    const superAdminRole = await this.adminRoleModel.findOne({ slug: 'super-admin' });
    if (!superAdminRole) {
      this.logger.error('Super Admin role not found — run seedRoles first');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await this.adminUserModel.create({
      email: email.toLowerCase().trim(),
      fullName: 'Super Admin',
      passwordHash,
      roleId: superAdminRole._id,
    });

    this.logger.log(`Super Admin seeded: ${email}`);
  }
}
