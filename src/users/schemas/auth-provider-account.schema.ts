/**
 * Auth Provider Account Schema
 * 
 * Stores linked social auth accounts (Google, Apple).
 * Separate collection for clean indexing and uniqueness.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuthProviderAccountDocument = AuthProviderAccount & Document;

export enum AuthProvider {
  GOOGLE = 'GOOGLE',
  APPLE = 'APPLE',
}

@Schema({
  timestamps: true,
  collection: 'auth_provider_accounts',
})
export class AuthProviderAccount {
  /**
   * Reference to the User
   */
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  /**
   * Auth provider type
   */
  @Prop({
    type: String,
    enum: Object.values(AuthProvider),
    required: true,
  })
  provider: AuthProvider;

  /**
   * Provider's unique user ID (e.g., Google sub, Apple sub)
   */
  @Prop({
    type: String,
    required: true,
  })
  providerUserId: string;

  /**
   * Email from provider (may differ from User.email for Apple private relay)
   */
  @Prop({
    type: String,
    lowercase: true,
    trim: true,
  })
  email?: string;

  /**
   * Additional data from provider (name, picture, etc.)
   */
  @Prop({ type: Object })
  profileData?: Record<string, any>;

  /**
   * Timestamps (auto-managed)
   */
  createdAt: Date;
  updatedAt: Date;
}

export const AuthProviderAccountSchema =
  SchemaFactory.createForClass(AuthProviderAccount);

// Unique compound index: one provider account per provider per user
AuthProviderAccountSchema.index(
  { provider: 1, providerUserId: 1 },
  { unique: true },
);

// Unique sparse index on email (if present)
AuthProviderAccountSchema.index(
  { provider: 1, email: 1 },
  { unique: true, sparse: true },
);

// Index for finding accounts by user
AuthProviderAccountSchema.index({ userId: 1 });
