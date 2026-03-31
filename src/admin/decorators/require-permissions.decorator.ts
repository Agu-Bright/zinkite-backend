/**
 * Permission Decorators
 * Fine-grained permission control for admin endpoints
 */
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const ANY_PERMISSION_KEY = 'any_permission';

/**
 * Require ALL listed permissions
 * Usage: @RequirePermissions('users.view', 'users.edit')
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Require ANY of the listed permissions
 * Usage: @RequireAnyPermission('transactions.refund', 'transactions.retry')
 */
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);

/**
 * Complete permission set for the Zinkite admin platform
 */
export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW: 'dashboard.view',
  DASHBOARD_ANALYTICS: 'dashboard.analytics',

  // Users
  USERS_VIEW: 'users.view',
  USERS_EDIT: 'users.edit',
  USERS_SUSPEND: 'users.suspend',
  USERS_BAN: 'users.ban',
  USERS_EXPORT: 'users.export',

  // Wallet
  WALLET_VIEW: 'wallet.view',
  WALLET_CREDIT: 'wallet.credit',
  WALLET_DEBIT: 'wallet.debit',
  WALLET_FREEZE: 'wallet.freeze',
  WALLET_LIMITS: 'wallet.limits',

  // Transactions
  TRANSACTIONS_VIEW: 'transactions.view',
  TRANSACTIONS_REFUND: 'transactions.refund',
  TRANSACTIONS_RETRY: 'transactions.retry',
  TRANSACTIONS_RESOLVE: 'transactions.resolve',
  TRANSACTIONS_EXPORT: 'transactions.export',

  // Gift Cards
  GIFTCARDS_TRADES_VIEW: 'giftcards.trades.view',
  GIFTCARDS_TRADES_APPROVE: 'giftcards.trades.approve',
  GIFTCARDS_TRADES_REJECT: 'giftcards.trades.reject',
  GIFTCARDS_TRADES_ESCALATE: 'giftcards.trades.escalate',
  GIFTCARDS_BRANDS_VIEW: 'giftcards.brands.view',
  GIFTCARDS_BRANDS_MANAGE: 'giftcards.brands.manage',
  GIFTCARDS_RATES_VIEW: 'giftcards.rates.view',
  GIFTCARDS_RATES_MANAGE: 'giftcards.rates.manage',

  // Crypto
  CRYPTO_TRADES_VIEW: 'crypto.trades.view',
  CRYPTO_TRADES_MANAGE: 'crypto.trades.manage',
  CRYPTO_RATES_VIEW: 'crypto.rates.view',
  CRYPTO_RATES_MANAGE: 'crypto.rates.manage',
  CRYPTO_SUPPORTED_VIEW: 'crypto.supported.view',
  CRYPTO_SUPPORTED_MANAGE: 'crypto.supported.manage',

  // VTU
  VTU_VIEW: 'vtu.view',
  VTU_REFUND: 'vtu.refund',
  VTU_RETRY: 'vtu.retry',

  // Electricity
  ELECTRICITY_VIEW: 'electricity.view',
  ELECTRICITY_REFUND: 'electricity.refund',
  ELECTRICITY_RETRY: 'electricity.retry',

  // Withdrawals & Topups
  WITHDRAWALS_VIEW: 'withdrawals.view',
  TOPUPS_VIEW: 'topups.view',

  // Settings
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',

  // Admin Management
  ADMIN_USERS_VIEW: 'admin.users.view',
  ADMIN_USERS_MANAGE: 'admin.users.manage',
  ADMIN_ROLES_VIEW: 'admin.roles.view',
  ADMIN_ROLES_MANAGE: 'admin.roles.manage',

  // Audit
  AUDIT_VIEW: 'audit.view',

  // Reports
  REPORTS_VIEW: 'reports.view',
  REPORTS_GENERATE: 'reports.generate',
  REPORTS_EXPORT: 'reports.export',

  // Complaints
  COMPLAINTS_VIEW: 'complaints.view',
  COMPLAINTS_MANAGE: 'complaints.manage',
  COMPLAINTS_ASSIGN: 'complaints.assign',

  // Notifications
  NOTIFICATIONS_VIEW: 'notifications.view',
  NOTIFICATIONS_MANAGE: 'notifications.manage',

  // Provider Health
  PROVIDER_HEALTH_VIEW: 'provider-health.view',

  // Reconciliation
  RECONCILIATION_VIEW: 'reconciliation.view',
  RECONCILIATION_MANAGE: 'reconciliation.manage',

  // Gift Card Buy (Reloadly)
  GIFTCARD_BUY_VIEW: 'giftcard-buy.view',
  GIFTCARD_BUY_MANAGE: 'giftcard-buy.manage',
  GIFTCARD_BUY_SYNC: 'giftcard-buy.sync',
  GIFTCARD_BUY_REFUND: 'giftcard-buy.refund',
  GIFTCARD_BUY_STATS: 'giftcard-buy.stats',

  // Referrals
  REFERRALS_VIEW: 'referrals.view',
  REFERRALS_MANAGE: 'referrals.manage',

  // Promos
  PROMOS_MANAGE: 'promos.manage',
} as const;

/** All permission values as an array */
export const ALL_PERMISSIONS = Object.values(PERMISSIONS);
