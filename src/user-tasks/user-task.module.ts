/**
 * User Task Module
 *
 * Task system with user tracking,
 * completion logic, and wallet rewards.
 */
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserTask, UserTaskSchema } from './schemas/user-task.schema';
import {
  UserTaskCompletion,
  UserTaskCompletionSchema,
} from './schemas/user-task-completion.schema';
import { UserTaskService } from './user-task.service';
import { UserTaskController } from './user-task.controller';
import { UserTaskAdminController } from './user-task-admin.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserTask.name, schema: UserTaskSchema },
      { name: UserTaskCompletion.name, schema: UserTaskCompletionSchema },
    ]),
    forwardRef(() => WalletModule),
  ],
  controllers: [UserTaskController, UserTaskAdminController],
  providers: [UserTaskService],
  exports: [UserTaskService],
})
export class UserTaskModule {}
