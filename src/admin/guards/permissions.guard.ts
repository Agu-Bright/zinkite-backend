/**
 * Permissions Guard
 * Checks admin user permissions from JWT payload
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  ANY_PERMISSION_KEY,
} from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check for @RequirePermissions (ALL required)
    const requiredAll = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Check for @RequireAnyPermission (ANY required)
    const requiredAny = this.reflector.getAllAndOverride<string[]>(
      ANY_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permissions required, allow access
    if (
      (!requiredAll || requiredAll.length === 0) &&
      (!requiredAny || requiredAny.length === 0)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const userPermissions: string[] = user.permissions || [];

    // Check ALL required permissions
    if (requiredAll && requiredAll.length > 0) {
      const hasAll = requiredAll.every((perm) =>
        userPermissions.includes(perm),
      );
      if (!hasAll) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    // Check ANY required permissions
    if (requiredAny && requiredAny.length > 0) {
      const hasAny = requiredAny.some((perm) =>
        userPermissions.includes(perm),
      );
      if (!hasAny) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    return true;
  }
}
