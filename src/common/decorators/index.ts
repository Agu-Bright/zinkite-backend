/**
 * Custom Decorators
 * 
 * Includes:
 * - @CurrentUser() - Extract current user from request
 * - @Public() - Mark route as public (no JWT required)
 * - @Roles(...roles) - Require specific roles
 * - @RequirePin() - Require transaction PIN
 */
import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../guards/jwt-auth.guard';
import { ROLES_KEY } from '../guards/roles.guard';
import { REQUIRE_PIN_KEY } from '../guards/pin.guard';

/**
 * Extract current user from request
 * Usage: @CurrentUser() user: JwtPayload
 * Or: @CurrentUser('sub') userId: string
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);

/**
 * Mark route as public (bypasses JWT auth)
 * Usage: @Public()
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Require specific roles for route access
 * Usage: @Roles('ADMIN') or @Roles('ADMIN', 'MODERATOR')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Require transaction PIN for route access
 * Usage: @RequirePin()
 */
export const RequirePin = () => SetMetadata(REQUIRE_PIN_KEY, true);
