/**
 * Audit Service
 * Handles audit logging for security and compliance
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AuditLog,
  AuditLogDocument,
  AuditAction,
  AuditResource,
  AuditStatus,
} from './schemas/audit-log.schema';
import { PaginatedResult } from '../common/dto/pagination.dto';
import { paginate, calculateSkip, sanitizeForLog } from '../common/utils/helpers';

export interface AuditLogOptions {
  userId?: string;
  adminId?: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId?: string;
  status?: AuditStatus;
  description: string;
  previousValues?: Record<string, any>;
  newValues?: Record<string, any>;
  meta?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  errorMessage?: string;
}

export interface AuditQueryOptions {
  userId?: string;
  adminId?: string;
  action?: AuditAction;
  resource?: AuditResource;
  status?: AuditStatus;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  /**
   * Create an audit log entry
   */
  async log(options: AuditLogOptions): Promise<AuditLog> {
    try {
      // Sanitize sensitive data before logging
      const sanitizedMeta = options.meta
        ? sanitizeForLog(options.meta)
        : undefined;
      const sanitizedPrevious = options.previousValues
        ? sanitizeForLog(options.previousValues)
        : undefined;
      const sanitizedNew = options.newValues
        ? sanitizeForLog(options.newValues)
        : undefined;

      const auditLog = new this.auditLogModel({
        userId: options.userId ? new Types.ObjectId(options.userId) : null,
        adminId: options.adminId ? new Types.ObjectId(options.adminId) : null,
        action: options.action,
        resource: options.resource,
        resourceId: options.resourceId || null,
        status: options.status || AuditStatus.SUCCESS,
        description: options.description,
        previousValues: sanitizedPrevious || null,
        newValues: sanitizedNew || null,
        meta: sanitizedMeta || {},
        ipAddress: options.ipAddress || null,
        userAgent: options.userAgent || null,
        requestId: options.requestId || null,
        errorMessage: options.errorMessage || null,
      });

      const saved = await auditLog.save();

      this.logger.debug(
        `Audit: ${options.action} on ${options.resource}${
          options.resourceId ? `:${options.resourceId}` : ''
        } - ${options.status || 'SUCCESS'}`,
      );

      return saved;
    } catch (error) {
      // Don't throw errors from audit logging - just log them
      this.logger.error(`Failed to create audit log: ${error.message}`, error.stack);
      return null as any;
    }
  }

  /**
   * Log a user action
   */
  async logUserAction(
    userId: string,
    action: AuditAction,
    description: string,
    options?: Partial<AuditLogOptions>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      action,
      resource: AuditResource.USER,
      resourceId: userId,
      description,
      ...options,
    });
  }

  /**
   * Log an admin action
   */
  async logAdminAction(
    adminId: string,
    action: AuditAction,
    resource: AuditResource,
    resourceId: string,
    description: string,
    options?: Partial<AuditLogOptions>,
  ): Promise<AuditLog> {
    return this.log({
      adminId,
      action,
      resource,
      resourceId,
      description,
      ...options,
    });
  }

  /**
   * Log a wallet action
   */
  async logWalletAction(
    userId: string,
    action: AuditAction,
    walletId: string,
    description: string,
    meta?: Record<string, any>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      action,
      resource: AuditResource.WALLET,
      resourceId: walletId,
      description,
      meta,
    });
  }

  /**
   * Log a trade action
   */
  async logTradeAction(
    userId: string,
    action: AuditAction,
    tradeId: string,
    description: string,
    meta?: Record<string, any>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      action,
      resource: AuditResource.GIFTCARD_TRADE,
      resourceId: tradeId,
      description,
      meta,
    });
  }

  /**
   * Log a VTU action
   */
  async logVtuAction(
    userId: string,
    action: AuditAction,
    resource: AuditResource.VTU_AIRTIME | AuditResource.VTU_DATA,
    transactionId: string,
    description: string,
    meta?: Record<string, any>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      action,
      resource,
      resourceId: transactionId,
      description,
      meta,
    });
  }

  /**
   * Log a system event
   */
  async logSystemEvent(
    action: AuditAction,
    description: string,
    meta?: Record<string, any>,
    status?: AuditStatus,
    errorMessage?: string,
  ): Promise<AuditLog> {
    return this.log({
      action,
      resource: AuditResource.SYSTEM,
      description,
      meta,
      status,
      errorMessage,
    });
  }

  /**
   * Log a failed action
   */
  async logFailure(
    options: Omit<AuditLogOptions, 'status'> & { errorMessage: string },
  ): Promise<AuditLog> {
    return this.log({
      ...options,
      status: AuditStatus.FAILED,
    });
  }

  /**
   * Query audit logs with filters
   */
  async getAuditLogs(query: AuditQueryOptions): Promise<PaginatedResult<AuditLog>> {
    const filter: any = {};
    const page = query.page || 1;
    const limit = query.limit || 20;

    if (query.userId) {
      filter.userId = new Types.ObjectId(query.userId);
    }

    if (query.adminId) {
      filter.adminId = new Types.ObjectId(query.adminId);
    }

    if (query.action) {
      filter.action = query.action;
    }

    if (query.resource) {
      filter.resource = query.resource;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = query.startDate;
      }
      if (query.endDate) {
        filter.createdAt.$lte = query.endDate;
      }
    }

    if (query.search) {
      filter.$text = { $search: query.search };
    }

    const total = await this.auditLogModel.countDocuments(filter);
    const logs = await this.auditLogModel
      .find(filter)
      .populate('userId', 'email fullName')
      .populate('adminId', 'email fullName')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(logs, total, page, limit);
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserAuditLogs(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<AuditLog>> {
    return this.getAuditLogs({ userId, page, limit });
  }

  /**
   * Get audit logs for a specific resource
   */
  async getResourceAuditLogs(
    resource: AuditResource,
    resourceId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<AuditLog>> {
    const filter = {
      resource,
      resourceId,
    };

    const total = await this.auditLogModel.countDocuments(filter);
    const logs = await this.auditLogModel
      .find(filter)
      .populate('userId', 'email fullName')
      .populate('adminId', 'email fullName')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(logs, total, page, limit);
  }

  /**
   * Get recent admin actions
   */
  async getRecentAdminActions(
    limit = 50,
  ): Promise<AuditLog[]> {
    return this.auditLogModel
      .find({ adminId: { $ne: null } })
      .populate('adminId', 'email fullName')
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  /**
   * Get failed actions for monitoring
   */
  async getFailedActions(
    startDate: Date,
    endDate: Date,
    limit = 100,
  ): Promise<AuditLog[]> {
    return this.auditLogModel
      .find({
        status: AuditStatus.FAILED,
        createdAt: { $gte: startDate, $lte: endDate },
      })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  /**
   * Get audit log statistics
   */
  async getStats(startDate?: Date, endDate?: Date): Promise<any> {
    const matchStage: any = {};

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }

    const stats = await this.auditLogModel.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: {
            action: '$action',
            status: '$status',
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.action',
          statuses: {
            $push: {
              status: '$_id.status',
              count: '$count',
            },
          },
          total: { $sum: '$count' },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const byResource = await this.auditLogModel.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: '$resource',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const totalLogs = await this.auditLogModel.countDocuments(matchStage);
    const failedCount = await this.auditLogModel.countDocuments({
      ...matchStage,
      status: AuditStatus.FAILED,
    });

    return {
      totalLogs,
      failedCount,
      failureRate: totalLogs > 0 ? (failedCount / totalLogs) * 100 : 0,
      byAction: stats,
      byResource,
    };
  }
}
