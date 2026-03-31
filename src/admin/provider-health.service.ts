/**
 * Provider Health Service
 * Monitors external API provider availability
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// ─── Schema ─────────────────────────────────────────────────
export type ProviderHealthCheckDocument = ProviderHealthCheck & Document;

@Schema({ timestamps: true, collection: 'provider_health_checks' })
export class ProviderHealthCheck {
  @Prop({ required: true })
  provider: string;

  @Prop({ required: true })
  responseTimeMs: number;

  @Prop({ required: true })
  success: boolean;

  @Prop({ type: String, default: null })
  errorMessage: string | null;

  @Prop()
  checkedAt: Date;

  createdAt: Date;
}

export const ProviderHealthCheckSchema =
  SchemaFactory.createForClass(ProviderHealthCheck);

// TTL: auto-delete after 7 days
ProviderHealthCheckSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 },
);
ProviderHealthCheckSchema.index({ provider: 1, checkedAt: -1 });

// ─── Provider Status Types ──────────────────────────────────
export interface ProviderStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  responseTimeMs: number;
  errorRatePercent: number;
  lastSuccessAt: Date | null;
  uptimePercent24h: number;
  recentChecks: Array<{ time: string; responseTimeMs: number; success: boolean }>;
}

// ─── Service ────────────────────────────────────────────────
@Injectable()
export class ProviderHealthService {
  private readonly logger = new Logger(ProviderHealthService.name);

  private readonly providers = [
    { name: 'Paystack', envKey: 'PAYSTACK_BASE_URL', healthPath: '' },
  ];

  constructor(
    @InjectModel(ProviderHealthCheck.name)
    private readonly healthModel: Model<ProviderHealthCheckDocument>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Run health checks every 5 minutes
   */
  @Cron('*/5 * * * *')
  async runHealthChecks(): Promise<void> {
    this.logger.debug('Running provider health checks...');

    for (const provider of this.providers) {
      await this.checkProvider(provider.name, provider.envKey, provider.healthPath);
    }
  }

  private async checkProvider(name: string, envKey: string, healthPath: string): Promise<void> {
    const baseUrl = this.configService.get<string>(envKey);
    const url = baseUrl ? `${baseUrl}${healthPath}` : null;

    const startTime = Date.now();
    let success = false;
    let errorMessage: string | null = null;

    try {
      if (!url) {
        throw new Error(`${envKey} not configured`);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'Zinkite-HealthCheck/1.0' },
      });
      clearTimeout(timeout);

      // Consider 2xx and 4xx as "reachable" (server responded)
      success = response.status < 500;
      if (!success) {
        errorMessage = `HTTP ${response.status}`;
      }
    } catch (err: any) {
      errorMessage = err.message || 'Unknown error';
      success = false;
    }

    const responseTimeMs = Date.now() - startTime;

    try {
      await this.healthModel.create({
        provider: name,
        responseTimeMs,
        success,
        errorMessage,
        checkedAt: new Date(),
      });
    } catch (err: any) {
      this.logger.error(`Failed to save health check for ${name}: ${err.message}`);
    }
  }

  /**
   * Get provider health status for all providers
   */
  async getProviderHealth(): Promise<ProviderStatus[]> {
    const results: ProviderStatus[] = [];
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    for (const provider of this.providers) {
      // Get checks from last hour for status calculation
      const recentChecks = await this.healthModel
        .find({ provider: provider.name, checkedAt: { $gte: oneHourAgo } })
        .sort({ checkedAt: -1 })
        .limit(12);

      // Get checks from last 24h for uptime
      const dayChecks = await this.healthModel
        .find({ provider: provider.name, checkedAt: { $gte: oneDayAgo } })
        .select('success');

      const totalRecent = recentChecks.length;
      const failedRecent = recentChecks.filter((c) => !c.success).length;
      const errorRate = totalRecent > 0 ? (failedRecent / totalRecent) * 100 : 0;

      const totalDay = dayChecks.length;
      const successDay = dayChecks.filter((c) => c.success).length;
      const uptimePercent = totalDay > 0 ? (successDay / totalDay) * 100 : 100;

      const avgResponseTime = totalRecent > 0
        ? Math.round(recentChecks.reduce((sum, c) => sum + c.responseTimeMs, 0) / totalRecent)
        : 0;

      const lastSuccess = await this.healthModel
        .findOne({ provider: provider.name, success: true })
        .sort({ checkedAt: -1 });

      // Determine status
      let status: 'healthy' | 'degraded' | 'down' = 'healthy';
      if (errorRate > 50 || (totalRecent > 0 && recentChecks[0] && !recentChecks[0].success && failedRecent > 2)) {
        status = 'down';
      } else if (errorRate > 5) {
        status = 'degraded';
      }

      results.push({
        name: provider.name,
        status,
        responseTimeMs: avgResponseTime,
        errorRatePercent: Math.round(errorRate * 100) / 100,
        lastSuccessAt: lastSuccess?.checkedAt || null,
        uptimePercent24h: Math.round(uptimePercent * 100) / 100,
        recentChecks: recentChecks.map((c) => ({
          time: c.checkedAt.toISOString(),
          responseTimeMs: c.responseTimeMs,
          success: c.success,
        })),
      });
    }

    return results;
  }
}
