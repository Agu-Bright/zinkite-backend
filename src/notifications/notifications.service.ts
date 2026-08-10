import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  NotificationToken,
  NotificationTokenDocument,
} from './schemas/notification-token.schema';
import {
  UserNotification,
  UserNotificationDocument,
  NotificationType,
} from './schemas/user-notification.schema';
import {
  paginate,
  calculateSkip,
} from '../common/utils/helpers';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private expo: any;
  private ExpoClass: any;

  constructor(
    @InjectModel(NotificationToken.name)
    private tokenModel: Model<NotificationTokenDocument>,
    @InjectModel(UserNotification.name)
    private notificationModel: Model<UserNotificationDocument>,
  ) {}

  async onModuleInit() {
    // Use Function constructor to force a real ESM dynamic import
    // (TypeScript's "module": "commonjs" would otherwise compile import() to require())
    const importDynamic = new Function('modulePath', 'return import(modulePath)');
    const expoModule = await importDynamic('expo-server-sdk');
    this.ExpoClass = expoModule.default ?? expoModule.Expo ?? expoModule;
    this.expo = new this.ExpoClass();
    this.logger.log('Expo Push SDK initialized');
  }

  // ============================================
  // TOKEN MANAGEMENT
  // ============================================

  async registerToken(
    userId: string,
    token: string,
    platform: string,
  ): Promise<void> {
    await this.tokenModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), token },
      { userId: new Types.ObjectId(userId), token, platform, isActive: true },
      { upsert: true, new: true },
    );
    this.logger.log(`Token registered for user ${userId}`);
  }

  async unregisterToken(userId: string, token: string): Promise<void> {
    await this.tokenModel.deleteOne({
      userId: new Types.ObjectId(userId),
      token,
    });
    this.logger.log(`Token unregistered for user ${userId}`);
  }

  // ============================================
  // SEND NOTIFICATIONS (Push + Persist)
  // ============================================

  /**
   * Send a notification to a user.
   * Always persists to user_notifications.
   * Sends push via Expo Push API if user has active tokens.
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    type: NotificationType = NotificationType.SYSTEM,
    category?: string,
  ): Promise<void> {
    // 1. Always persist to in-app notifications
    try {
      await this.notificationModel.create({
        userId: new Types.ObjectId(userId),
        title,
        body,
        type,
        category: category || data?.type || null,
        data: data || {},
      });
    } catch (err) {
      this.logger.error(`Failed to persist notification for ${userId}: ${err.message}`);
    }

    // 2. Send push via Expo (best-effort)
    await this.sendPush(userId, title, body, data);
  }

  /**
   * Send a push notification to multiple users.
   */
  async sendToMultiple(
    userIds: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    type: NotificationType = NotificationType.SYSTEM,
    category?: string,
  ): Promise<void> {
    // Persist all in-app notifications in bulk
    const docs = userIds.map((userId) => ({
      userId: new Types.ObjectId(userId),
      title,
      body,
      type,
      category: category || data?.type || null,
      data: data || {},
    }));

    try {
      await this.notificationModel.insertMany(docs, { ordered: false });
    } catch (err) {
      this.logger.error(`Failed to persist bulk notifications: ${err.message}`);
    }

    // Fetch all active tokens for these users in one query
    const tokens = await this.tokenModel.find({
      userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
      isActive: true,
    });

    if (tokens.length === 0) return;

    // Build Expo push messages
    const messages: any[] = [];
    for (const t of tokens) {
      if (!this.ExpoClass.isExpoPushToken(t.token)) {
        this.logger.warn(`Invalid Expo push token: ${t.token}`);
        continue;
      }
      messages.push({
        to: t.token,
        title,
        body,
        data: data || {},
        sound: 'default',
        priority: 'high',
      });
    }

    if (messages.length === 0) return;

    // Per-message send (see sendPush for rationale). Broadcasts routinely mix
    // tokens from different EAS project generations, so batching guarantees
    // failures. Concurrency 25 keeps Expo happy without serialising everything.
    const invalidTokens: string[] = [];
    const concurrency = 25;
    for (let i = 0; i < messages.length; i += concurrency) {
      const slice = messages.slice(i, i + concurrency);
      await Promise.allSettled(
        slice.map(async (message) => {
          try {
            const tickets: any[] = await this.expo.sendPushNotificationsAsync([message]);
            const ticket = tickets?.[0];
            if (ticket?.status === 'error') {
              const err = ticket.details?.error;
              if (err === 'DeviceNotRegistered' || err === 'InvalidCredentials') {
                invalidTokens.push(message.to);
              } else {
                this.logger.warn(`Broadcast push error: ${ticket.message}`);
              }
            }
          } catch (error: any) {
            const msg = String(error?.message || '');
            if (msg.includes('same project') || msg.includes('conflicting tokens')) {
              invalidTokens.push(message.to);
            } else {
              this.logger.error(`Broadcast push failed for ${message.to}: ${msg}`);
            }
          }
        }),
      );
    }

    // Clean up invalid tokens
    if (invalidTokens.length > 0) {
      await this.tokenModel.deleteMany({ token: { $in: invalidTokens } });
      this.logger.log(`Removed ${invalidTokens.length} invalid tokens`);
    }

    this.logger.log(
      `Broadcast push sent: ${messages.length - invalidTokens.length}/${messages.length} messages to ${userIds.length} users`,
    );
  }

  /**
   * Send push notification to a single user via Expo Push API.
   */
  private async sendPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.expo) {
      this.logger.warn('Expo SDK not initialized yet, skipping push');
      return;
    }

    const tokens = await this.tokenModel.find({
      userId: new Types.ObjectId(userId),
      isActive: true,
    });

    if (tokens.length === 0) return;

    const messages: any[] = [];
    for (const t of tokens) {
      if (!this.ExpoClass.isExpoPushToken(t.token)) {
        this.logger.warn(`Invalid Expo push token: ${t.token}`);
        continue;
      }
      messages.push({
        to: t.token,
        title,
        body,
        data: data || {},
        sound: 'default',
        priority: 'high',
      });
    }

    if (messages.length === 0) return;

    // Send each token in its own request. Expo requires every message in a
    // batch to belong to the same project — if a user has tokens from an
    // older build with a different EAS projectId (common right after a
    // rebrand), batching throws "conflicting tokens" and NONE of the messages
    // are delivered. Per-token sends make a bad token cost only itself.
    const invalidTokens: string[] = [];

    await Promise.allSettled(
      messages.map(async (message) => {
        try {
          const tickets: any[] = await this.expo.sendPushNotificationsAsync([message]);
          const ticket = tickets?.[0];
          if (ticket?.status === 'error') {
            const err = ticket.details?.error;
            if (err === 'DeviceNotRegistered' || err === 'InvalidCredentials') {
              invalidTokens.push(message.to);
              this.logger.warn(
                `Removing token for user ${userId} — Expo says: ${err}`,
              );
            } else {
              this.logger.warn(`Push error for user ${userId}: ${ticket.message}`);
            }
          }
        } catch (error: any) {
          // Cross-project errors show up here as a throw. Nuke the offending
          // token so we don't hit it again on every future send.
          const msg = String(error?.message || '');
          if (msg.includes('same project') || msg.includes('conflicting tokens')) {
            invalidTokens.push(message.to);
            this.logger.warn(
              `Removing cross-project token for user ${userId}: ${message.to}`,
            );
          } else {
            this.logger.error(
              `Push failed for user ${userId} token ${message.to}: ${msg}`,
            );
          }
        }
      }),
    );

    if (invalidTokens.length > 0) {
      await this.tokenModel.deleteMany({ token: { $in: invalidTokens } });
      this.logger.log(
        `Removed ${invalidTokens.length} invalid token(s) for user ${userId}`,
      );
    }

    this.logger.log(
      `Push sent to user ${userId}: ${messages.length - invalidTokens.length}/${messages.length} device(s) delivered`,
    );
  }

  // ============================================
  // NOTIFICATION INBOX (User-facing queries)
  // ============================================

  async getUserNotifications(
    userId: string,
    query: { page?: number; limit?: number; type?: NotificationType; isRead?: boolean },
  ): Promise<PaginatedResult<UserNotification>> {
    const filter: any = { userId: new Types.ObjectId(userId) };
    if (query.type) filter.type = query.type;
    if (query.isRead !== undefined) filter.isRead = query.isRead;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const total = await this.notificationModel.countDocuments(filter);
    const data = await this.notificationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(data, total, page, limit);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
    });
  }

  async markAsRead(userId: string, notificationId: string): Promise<void> {
    await this.notificationModel.updateOne(
      { _id: notificationId, userId: new Types.ObjectId(userId) },
      { $set: { isRead: true } },
    );
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { $set: { isRead: true } },
    );
  }
}
