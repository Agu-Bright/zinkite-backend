import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { getClientIp } from '../utils/client-ip';

/**
 * Keeps rate limits isolated per authenticated session or login identity.
 * This prevents unrelated users behind the same production proxy/network
 * from consuming one another's request allowance.
 */
@Injectable()
export class IdentityThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Registration must be limited by source, not by the submitted email.
    // Otherwise an automated client can bypass the limit with a new address
    // on every request.
    if (this.isRegistrationRequest(req)) {
      return `registration-ip:${this.hash(getClientIp(req) || 'unknown')}`;
    }

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

    return `ip:${getClientIp(req) || 'unknown'}`;
  }

  private isRegistrationRequest(req: Record<string, any>): boolean {
    const path = String(req.originalUrl || req.url || '').split('?')[0];
    return String(req.method).toUpperCase() === 'POST' && /\/auth\/register\/?$/.test(path);
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
