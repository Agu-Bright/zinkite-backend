/**
 * Admin Auth Service
 * Handles admin-specific authentication (separate from user auth)
 */
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';

// ── Inline TOTP (RFC 6238) — replaces otplib to avoid ESM-incompatible deps ──
const B32_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b32Decode(s: string): Buffer {
  const str = s.toUpperCase().replace(/=+$/, '');
  let bits = 0, value = 0, pos = 0;
  const out = Buffer.alloc(Math.ceil(str.length * 5 / 8));
  for (const ch of str) {
    const idx = B32_ALPHA.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out[pos++] = (value >>> (bits - 8)) & 0xff; bits -= 8; }
  }
  return out.subarray(0, pos);
}

function b32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32_ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_ALPHA[(value << (5 - bits)) & 31];
  return out;
}

function totpCode(secret: string, window = 0): string {
  const key = b32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30) + window;
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1_000_000;
  return code.toString().padStart(6, '0');
}

function generateSecret(): string { return b32Encode(crypto.randomBytes(20)); }

function generateURI({ issuer, label, secret }: { issuer: string; label: string; secret: string }): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function verifySync({ token, secret }: { token: string; secret: string }): { valid: boolean } {
  const valid = [-1, 0, 1].some(w => totpCode(secret, w) === token);
  return { valid };
}
// ─────────────────────────────────────────────────────────────────────────────
import { AdminUser, AdminUserDocument, AdminUserStatus } from './schemas/admin-user.schema';
import { AdminRole, AdminRoleDocument } from './schemas/admin-role.schema';

export interface AdminJwtPayload {
  sub: string;       // AdminUser _id
  adminId: string;   // Same as sub, explicit for clarity
  email: string;
  roleSlug: string;
  permissions: string[];
  type: 'admin';     // Differentiates from user JWTs
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @InjectModel(AdminUser.name)
    private readonly adminUserModel: Model<AdminUserDocument>,
    @InjectModel(AdminRole.name)
    private readonly adminRoleModel: Model<AdminRoleDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Validate admin credentials
   */
  async validateAdmin(email: string, password: string): Promise<AdminUserDocument> {
    const admin = await this.adminUserModel
      .findOne({ email: email.toLowerCase().trim() })
      .populate('roleId');

    if (!admin) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (admin.status !== AdminUserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return admin;
  }

  /**
   * Generate admin JWT tokens
   */
  async generateAdminTokens(admin: AdminUserDocument): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const role = admin.roleId as unknown as AdminRoleDocument;

    const payload: AdminJwtPayload = {
      sub: admin._id.toString(),
      adminId: admin._id.toString(),
      email: admin.email,
      roleSlug: role.slug,
      permissions: role.permissions,
      type: 'admin',
    };

    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');

    const accessToken = this.jwtService.sign(payload, {
      secret,
      expiresIn: '30m',
    });

    const refreshToken = this.jwtService.sign(
      { sub: admin._id.toString(), type: 'admin_refresh' },
      {
        secret: refreshSecret,
        expiresIn: '7d',
      },
    );

    // Update last login
    await this.adminUserModel.findByIdAndUpdate(admin._id, {
      lastLoginAt: new Date(),
    });

    return { accessToken, refreshToken };
  }

  /**
   * Generate a short-lived temp token for 2FA flow
   */
  generateTempToken(adminId: string): string {
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    return this.jwtService.sign(
      { sub: adminId, type: 'admin_2fa_temp' },
      { secret, expiresIn: '5m' },
    );
  }

  /**
   * Validate a temp token from the 2FA flow
   */
  validateTempToken(token: string): string {
    try {
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const payload = this.jwtService.verify(token, { secret });
      if (payload.type !== 'admin_2fa_temp') {
        throw new UnauthorizedException('Invalid temp token');
      }
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired temp token');
    }
  }

  /**
   * Refresh admin JWT
   */
  async refreshAdminToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    try {
      const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
      const payload = this.jwtService.verify(refreshToken, { secret: refreshSecret });

      if (payload.type !== 'admin_refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const admin = await this.adminUserModel
        .findById(payload.sub)
        .populate('roleId');

      if (!admin || admin.status !== AdminUserStatus.ACTIVE) {
        throw new UnauthorizedException('Admin account not found or inactive');
      }

      return this.generateAdminTokens(admin);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Get admin profile by ID
   */
  async getAdminProfile(adminId: string): Promise<any> {
    const admin = await this.adminUserModel
      .findById(adminId)
      .select('-passwordHash -twoFactorSecret')
      .populate('roleId')
      .populate('createdBy', 'fullName email');

    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    const role = admin.roleId as unknown as AdminRoleDocument;

    return {
      _id: admin._id,
      email: admin.email,
      fullName: admin.fullName,
      status: admin.status,
      twoFactorEnabled: admin.twoFactorEnabled,
      lastLoginAt: admin.lastLoginAt,
      createdBy: admin.createdBy,
      createdAt: admin.createdAt,
      role: {
        _id: role._id,
        name: role.name,
        slug: role.slug,
        description: role.description,
      },
      permissions: role.permissions,
    };
  }

  /**
   * Hash password
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  // ─── 2FA Methods ────────────────────────────────────────────────

  private get encryptionKey(): Buffer {
    const key = this.configService.get<string>('ADMIN_2FA_ENCRYPTION_KEY');
    if (!key || key.length < 32) {
      // Derive a 32-byte key from whatever is configured (or fallback to JWT secret)
      const source = key || this.configService.get<string>('JWT_ACCESS_SECRET') || 'fallback-key';
      return crypto.createHash('sha256').update(source).digest();
    }
    return Buffer.from(key.slice(0, 32), 'utf8');
  }

  private encryptSecret(secret: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decryptSecret(encrypted: string): string {
    const [ivHex, data] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Setup 2FA — generate TOTP secret + QR code
   */
  async setup2fa(adminId: string): Promise<{ secret: string; qrCodeDataUri: string }> {
    const admin = await this.adminUserModel.findById(adminId);
    if (!admin) throw new UnauthorizedException('Admin not found');
    if (admin.twoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    const secret = generateSecret();
    const otpUri = generateURI({ issuer: 'Zinkite Admin', label: admin.email, secret });
    const qrCodeDataUri = await QRCode.toDataURL(otpUri);

    // Store encrypted secret (not yet enabled until verified)
    admin.twoFactorSecret = this.encryptSecret(secret);
    await admin.save();

    return { secret, qrCodeDataUri };
  }

  /**
   * Enable 2FA — verify code to confirm setup
   */
  async enable2fa(adminId: string, code: string): Promise<void> {
    const admin = await this.adminUserModel.findById(adminId);
    if (!admin) throw new UnauthorizedException('Admin not found');
    if (admin.twoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }
    if (!admin.twoFactorSecret) {
      throw new BadRequestException('2FA setup not initiated. Call setup first.');
    }

    const secret = this.decryptSecret(admin.twoFactorSecret);
    const isValid = verifySync({ token: code, secret }).valid;
    if (!isValid) {
      throw new BadRequestException('Invalid 2FA code');
    }

    admin.twoFactorEnabled = true;
    await admin.save();
  }

  /**
   * Disable 2FA — requires valid TOTP code
   */
  async disable2fa(adminId: string, code: string): Promise<void> {
    const admin = await this.adminUserModel.findById(adminId);
    if (!admin) throw new UnauthorizedException('Admin not found');
    if (!admin.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    const secret = this.decryptSecret(admin.twoFactorSecret!);
    const isValid = verifySync({ token: code, secret }).valid;
    if (!isValid) {
      throw new BadRequestException('Invalid 2FA code');
    }

    admin.twoFactorEnabled = false;
    admin.twoFactorSecret = null;
    await admin.save();
  }

  /**
   * Validate 2FA code during login — exchanges tempToken + code for real JWT
   */
  async validate2faLogin(tempToken: string, code: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const adminId = this.validateTempToken(tempToken);
    const admin = await this.adminUserModel
      .findById(adminId)
      .populate('roleId');

    if (!admin || admin.status !== AdminUserStatus.ACTIVE) {
      throw new UnauthorizedException('Admin not found or inactive');
    }

    if (!admin.twoFactorEnabled || !admin.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled for this account');
    }

    const secret = this.decryptSecret(admin.twoFactorSecret);
    const isValid = verifySync({ token: code, secret }).valid;
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    return this.generateAdminTokens(admin);
  }
}
