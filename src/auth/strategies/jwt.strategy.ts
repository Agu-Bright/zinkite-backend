/**
 * JWT Strategy
 *
 * PassportJS strategy for validating JWT tokens.
 * Supports both user JWTs and admin JWTs.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

// Use require to avoid TypeScript module resolution issues with passport-jwt types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const passportJwt = require('passport-jwt');
const Strategy = passportJwt.Strategy;
const ExtractJwt = passportJwt.ExtractJwt;

export interface JwtPayload {
  sub: string;        // User ID or Admin ID
  email?: string;     // Email
  roles?: string[];   // User roles (regular users)
  adminId?: string;   // Admin ID (admin users)
  roleSlug?: string;  // Admin role slug
  permissions?: string[]; // Admin permissions
  type?: 'admin';     // Token type differentiator
  iat?: number;       // Issued at
  exp?: number;       // Expiration
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const secret = configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET environment variable is required');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Validate JWT payload and return user data for request
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Admin tokens — skip user lookup, trust the JWT payload
    if (payload.type === 'admin' && payload.adminId) {
      return {
        sub: payload.sub,
        adminId: payload.adminId,
        email: payload.email,
        roleSlug: payload.roleSlug,
        permissions: payload.permissions || [],
        type: 'admin',
        roles: ['ADMIN'], // Backwards compatible with existing @Roles('ADMIN') guard
      };
    }

    // Regular user tokens — verify user still exists and is active
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    if (user.isDeleted) {
      throw new UnauthorizedException('Account has been deleted');
    }

    // Return payload to be attached to request.user
    return {
      sub: payload.sub,
      email: user.email,
      roles: user.roles,
    };
  }
}
