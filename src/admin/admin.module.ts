/**
 * Admin Module
 * Handles all admin-only operations and management features
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Existing
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

// RBAC schemas
import { AdminRole, AdminRoleSchema } from './schemas/admin-role.schema';
import { AdminUser, AdminUserSchema } from './schemas/admin-user.schema';
import { WalletCreditRequest, WalletCreditRequestSchema } from './schemas/wallet-credit-request.schema';

// External schemas
import { User, UserSchema } from '../users/schemas/user.schema';
import { Wallet, WalletSchema } from '../wallet/schemas/wallet.schema';
import {
  WalletTransaction,
  WalletTransactionSchema,
} from '../wallet/schemas/wallet-transaction.schema';
import {
  GiftCardTrade,
  GiftCardTradeSchema,
} from '../giftcards/schemas/gift-card-trade.schema';
import {
  PaystackTransaction,
  PaystackTransactionSchema,
} from '../paystack/schemas/paystack-transaction.schema';
import { Withdrawal, WithdrawalSchema } from '../wallet/schemas/withdrawal.schema';

// RBAC controllers & services
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminRolesController } from './admin-roles.controller';
import { AdminRolesService } from './admin-roles.service';
import { AdminAuditController } from './admin-audit.controller';
import { ProviderHealthService, ProviderHealthCheck, ProviderHealthCheckSchema } from './provider-health.service';
import { AdminSeedService } from './seeds/seed-roles';
import { NotificationLog, NotificationLogSchema } from './schemas/notification-log.schema';

// Feature modules
import { WalletModule } from '../wallet/wallet.module';
import { GiftCardsModule } from '../giftcards/giftcards.module';
import { UsersModule } from '../users/users.module';
import { SettingsModule } from '../settings/settings.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: WalletTransaction.name, schema: WalletTransactionSchema },
      { name: GiftCardTrade.name, schema: GiftCardTradeSchema },
      { name: PaystackTransaction.name, schema: PaystackTransactionSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
      { name: AdminRole.name, schema: AdminRoleSchema },
      { name: AdminUser.name, schema: AdminUserSchema },
      { name: WalletCreditRequest.name, schema: WalletCreditRequestSchema },
      { name: ProviderHealthCheck.name, schema: ProviderHealthCheckSchema },
      { name: NotificationLog.name, schema: NotificationLogSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: '30m' },
      }),
      inject: [ConfigService],
    }),
    WalletModule,
    GiftCardsModule,
    UsersModule,
    SettingsModule,
    AuditModule,
    NotificationsModule,
  ],
  controllers: [
    // More-specific prefix controllers MUST come before AdminController
    // to prevent GET /admin/users/:id from intercepting /admin/users/admins etc.
    AdminAuthController,
    AdminUsersController,
    AdminRolesController,
    AdminAuditController,
    AdminController,
  ],
  providers: [
    AdminService,
    AdminAuthService,
    AdminUsersService,
    AdminRolesService,
    ProviderHealthService,
    AdminSeedService,
  ],
  exports: [AdminService, AdminAuthService],
})
export class AdminModule {}
