import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BlockedIp, BlockedIpDocument } from '../../admin/schemas/blocked-ip.schema';
import { getClientIp } from '../utils/client-ip';

@Injectable()
export class BlockedIpGuard implements CanActivate {
  constructor(
    @InjectModel(BlockedIp.name)
    private readonly blockedIpModel: Model<BlockedIpDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, any>>();
    const path = String(request.originalUrl || request.url || '').split('?')[0];

    // Never let an app-user IP block lock administrators out of the security UI.
    if (/^\/admin(?:\/|$)/.test(path)) return true;

    const ipAddress = getClientIp(request);
    if (!ipAddress) return true;

    const isBlocked = await this.blockedIpModel.exists({
      ipAddress,
      isActive: true,
    });

    if (isBlocked) {
      throw new ForbiddenException('Access from this network has been blocked');
    }

    return true;
  }
}
