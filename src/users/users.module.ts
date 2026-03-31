/**
 * Users Module
 * 
 * Manages user accounts and authentication provider links.
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User, UserSchema } from './schemas/user.schema';
import {
  AuthProviderAccount,
  AuthProviderAccountSchema,
} from './schemas/auth-provider-account.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuthProviderAccount.name, schema: AuthProviderAccountSchema },
    ]),
  ],
  providers: [UsersService],
  exports: [UsersService, MongooseModule], // Export both UsersService and MongooseModule
})
export class UsersModule {}