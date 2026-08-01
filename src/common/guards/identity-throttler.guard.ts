import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';

/**
 * Keeps rate limits isolated per authenticated session or login identity.
 * This prevents unrelated users behind the same production proxy/network
 * from consuming one another's request allowance.
 */
@Injectable()
export class IdentityThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const authorization = String(req.headers?.authorization || '');
    if (authorization.toLowerCase().startsWith('bearer ')) {
      return `session:${this.hash(authorization.slice(7))}`;
    }

    const identity = String(
      req.body?.email || req.body?.phone || req.body?.refreshToken || '',
    )
      .trim()
      .toLowerCase();

    if (identity) {
      return `identity:${this.hash(identity)}`;
    }

    return `ip:${req.ip}`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
