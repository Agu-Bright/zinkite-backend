/**
 * Users Service
 * 
 * Handles user CRUD operations and queries.
 */
import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole } from './schemas/user.schema';
import {
  AuthProviderAccount,
  AuthProviderAccountDocument,
  AuthProvider,
} from './schemas/auth-provider-account.schema';

const SALT_ROUNDS = 12;

export interface CreateUserDto {
  email?: string;
  phone?: string;
  password?: string;
  fullName?: string;
  avatarUrl?: string;
  isEmailVerified?: boolean;
  roles?: UserRole[];
  referralCode?: string;
  referredBy?: Types.ObjectId;
}

export interface CreateProviderAccountDto {
  userId: Types.ObjectId;
  provider: AuthProvider;
  providerUserId: string;
  email?: string;
  profileData?: Record<string, any>;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(AuthProviderAccount.name)
    private readonly authProviderModel: Model<AuthProviderAccountDocument>,
  ) {}

  /**
   * Create a new user
   */
  async create(dto: CreateUserDto, session?: ClientSession): Promise<UserDocument> {
    // Check for existing email
    if (dto.email) {
      const existingEmail = await this.userModel
        .findOne({ email: dto.email.toLowerCase() })
        .session(session || null);
      if (existingEmail) {
        throw new ConflictException('Email already registered');
      }
    }

    // Check for existing phone
    if (dto.phone) {
      const existingPhone = await this.userModel
        .findOne({ phone: dto.phone })
        .session(session || null);
      if (existingPhone) {
        throw new ConflictException('Phone number already registered');
      }
    }

    // Hash password if provided
    let passwordHash: string | undefined;
    if (dto.password) {
      passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    }

    const user = new this.userModel({
      email: dto.email?.toLowerCase(),
      phone: dto.phone,
      passwordHash,
      fullName: dto.fullName,
      avatarUrl: dto.avatarUrl,
      isEmailVerified: dto.isEmailVerified ?? false,
      roles: dto.roles ?? [UserRole.USER],
      status: 'ACTIVE',
      referralCode: dto.referralCode,
      referredBy: dto.referredBy || null,
    });

    const savedUser = await user.save({ session });
    this.logger.log(`User created: ${savedUser._id}`);
    return savedUser;
  }

  /**
   * Find user by ID
   */
  async findById(id: string | Types.ObjectId): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  /**
   * Find user by referral code
   */
  async findByReferralCode(referralCode: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ referralCode: referralCode.toUpperCase() })
      .exec();
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  /**
   * Find user by phone
   */
  async findByPhone(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone }).exec();
  }

  /**
   * Find user by email or phone
   */
  async findByEmailOrPhone(
    email?: string,
    phone?: string,
  ): Promise<UserDocument | null> {
    const conditions: any[] = [];
    if (email) conditions.push({ email: email.toLowerCase() });
    if (phone) conditions.push({ phone });

    if (conditions.length === 0) return null;

    return this.userModel.findOne({ $or: conditions }).exec();
  }

  /**
   * Update user
   */
  async update(
    id: string | Types.ObjectId,
    updates: Partial<User>,
    session?: ClientSession,
  ): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(id, updates, { new: true })
      .session(session || null)
      .exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  /**
   * Mark email as verified
   */
  async markEmailVerified(
    userId: string | Types.ObjectId,
  ): Promise<UserDocument> {
    return this.update(userId, { isEmailVerified: true });
  }

  /**
   * Update user password
   */
  async updatePassword(
    userId: string | Types.ObjectId,
    newPassword: string,
  ): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.update(userId, { passwordHash });
  }

  /**
   * Set transaction PIN
   */
  async setTransactionPin(
    userId: string | Types.ObjectId,
    pin: string,
  ): Promise<void> {
    const transactionPinHash = await bcrypt.hash(pin, SALT_ROUNDS);
    await this.update(userId, { transactionPinHash });
    this.logger.log(`Transaction PIN set for user: ${userId}`);
  }

  /**
   * Verify transaction PIN
   */
  async verifyTransactionPin(
    userId: string | Types.ObjectId,
    pin: string,
  ): Promise<boolean> {
    const user = await this.userModel
      .findById(userId)
      .select('transactionPinHash')
      .exec();

    if (!user || !user.transactionPinHash) {
      return false;
    }

    return bcrypt.compare(pin, user.transactionPinHash);
  }

  /**
   * Check if user has PIN set
   */
  async hasPinSet(userId: string | Types.ObjectId): Promise<boolean> {
    const user = await this.userModel
      .findById(userId)
      .select('transactionPinHash')
      .exec();
    return !!user?.transactionPinHash;
  }

  /**
   * Validate password
   */
  async validatePassword(
    user: UserDocument,
    password: string,
  ): Promise<boolean> {
    if (!user.passwordHash) {
      return false;
    }
    return bcrypt.compare(password, user.passwordHash);
  }

  /**
   * Soft-delete a user: set isDeleted flag and anonymize PII
   */
  async softDeleteUser(
    userId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const user = await this.userModel.findById(userId).session(session || null);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const anonymized = `deleted_${user._id}`;

    await this.userModel
      .findByIdAndUpdate(
        userId,
        {
          isDeleted: true,
          status: 'DEACTIVATED',
          email: `${anonymized}@deleted.zinkite.com`,
          phone: null,
          fullName: 'Deleted User',
          avatarUrl: null,
          passwordHash: null,
          transactionPinHash: null,
        },
        { session: session || undefined },
      )
      .exec();

    // Remove linked provider accounts
    await this.authProviderModel
      .deleteMany({ userId: new Types.ObjectId(userId) })
      .session(session || null);

    this.logger.log(`User soft-deleted: ${userId}`);
  }

  // =====================
  // Auth Provider Methods
  // =====================

  /**
   * Create auth provider account
   */
  async createProviderAccount(
    dto: CreateProviderAccountDto,
    session?: ClientSession,
  ): Promise<AuthProviderAccountDocument> {
    const account = new this.authProviderModel({
      userId: dto.userId,
      provider: dto.provider,
      providerUserId: dto.providerUserId,
      email: dto.email?.toLowerCase(),
      profileData: dto.profileData,
    });

    const saved = await account.save({ session });
    this.logger.log(
      `Auth provider account created: ${dto.provider} for user ${dto.userId}`,
    );
    return saved;
  }

  /**
   * Find user by provider account
   */
  async findByProviderAccount(
    provider: AuthProvider,
    providerUserId: string,
  ): Promise<UserDocument | null> {
    const account = await this.authProviderModel
      .findOne({ provider, providerUserId })
      .exec();

    if (!account) {
      return null;
    }

    return this.findById(account.userId);
  }

  /**
   * Find auth provider account
   */
  async findProviderAccount(
    provider: AuthProvider,
    providerUserId: string,
  ): Promise<AuthProviderAccountDocument | null> {
    return this.authProviderModel.findOne({ provider, providerUserId }).exec();
  }

  /**
   * Get all provider accounts for a user
   */
  async getUserProviderAccounts(
    userId: string | Types.ObjectId,
  ): Promise<AuthProviderAccountDocument[]> {
    return this.authProviderModel.find({ userId }).exec();
  }

  /**
   * Link provider account to existing user
   */
  async linkProviderAccount(
    userId: string | Types.ObjectId,
    dto: Omit<CreateProviderAccountDto, 'userId'>,
    session?: ClientSession,
  ): Promise<AuthProviderAccountDocument> {
    // Check if provider account already exists
    const existing = await this.authProviderModel
      .findOne({
        provider: dto.provider,
        providerUserId: dto.providerUserId,
      })
      .session(session || null);

    if (existing) {
      throw new ConflictException(
        `${dto.provider} account already linked to another user`,
      );
    }

    return this.createProviderAccount(
      { ...dto, userId: new Types.ObjectId(userId) },
      session,
    );
  }
}
