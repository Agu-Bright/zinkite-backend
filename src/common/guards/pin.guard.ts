/**
 * PIN Guard
 * 
 * Verifies the user's 4-digit transaction PIN for sensitive operations.
 * Requires x-txn-pin header.
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcrypt';

// Import UsersService instead of User model directly
import { UsersService } from '../../users/users.service';

// Export constant for decorator
export const REQUIRE_PIN_KEY = 'requirePin';

@Injectable()
export class PinGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if PIN is required for this route
    const requirePin = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_PIN_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If @RequirePin() decorator is not present, skip PIN check
    if (!requirePin) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.sub) {
      throw new ForbiddenException('Authentication required');
    }

    // Get PIN from header
    const pin = request.headers['x-txn-pin'];

    if (!pin) {
      throw new BadRequestException(
        'Transaction PIN required. Please provide x-txn-pin header.',
      );
    }

    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      throw new BadRequestException('Invalid PIN format. Must be 4 digits.');
    }

    // Get user from database using UsersService
    const dbUser = await this.usersService.findById(user.sub);

    if (!dbUser) {
      throw new ForbiddenException('User not found');
    }

    if (!dbUser.transactionPinHash) {
      throw new ForbiddenException(
        'Transaction PIN not set. Please set your PIN first.',
      );
    }

    // Verify PIN
    const isPinValid = await bcrypt.compare(pin, dbUser.transactionPinHash);

    if (!isPinValid) {
      throw new ForbiddenException('Invalid transaction PIN');
    }

    return true;
  }
}