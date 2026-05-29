/**
 * User Task Service
 *
 * Core business logic for user tasks:
 * - System task seeding on startup
 * - Task CRUD and lifecycle management
 * - Task completion tracking with wallet rewards
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types } from 'mongoose';
import {
  UserTask,
  UserTaskDocument,
  UserTaskStatus,
} from './schemas/user-task.schema';
import {
  UserTaskCompletion,
  UserTaskCompletionDocument,
} from './schemas/user-task-completion.schema';
import { WalletService } from '../wallet/wallet.service';
import {
  TransactionCategory,
  TransactionSource,
} from '../wallet/schemas/wallet-transaction.schema';
import {
  CreateUserTaskDto,
  UpdateUserTaskDto,
  UserTaskQueryDto,
} from './dto';
import { paginate, calculateSkip } from '../common/utils/helpers';

/** System tasks seeded on startup */
const SYSTEM_TASKS = [
  {
    taskKey: 'SETUP_WITHDRAWAL',
    title: 'Set up withdrawal account',
    description: 'Add your bank account for instant withdrawals',
    iconName: 'wallet-outline',
    actionRoute: '/(tabs)/profile/bank-details',
    displayOrder: 1,
  },
  {
    taskKey: 'FUND_WALLET',
    title: 'Fund your wallet',
    description: 'Add money to start trading gift cards',
    iconName: 'add-circle-outline',
    actionRoute: '/(modals)/fund-wallet',
    displayOrder: 2,
  },
];

@Injectable()
export class UserTaskService implements OnModuleInit {
  private readonly logger = new Logger(UserTaskService.name);

  constructor(
    @InjectModel(UserTask.name)
    private readonly taskModel: Model<UserTaskDocument>,
    @InjectModel(UserTaskCompletion.name)
    private readonly completionModel: Model<UserTaskCompletionDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService,
  ) {}

  async onModuleInit() {
    await this.seedSystemTasks();
  }

  // ═══════════════════════════════════════════════════════════
  // SYSTEM TASK SEEDING
  // ═══════════════════════════════════════════════════════════

  async seedSystemTasks(): Promise<void> {
    for (const task of SYSTEM_TASKS) {
      await this.taskModel.updateOne(
        { taskKey: task.taskKey },
        {
          $set: {
            title: task.title,
            description: task.description,
            iconName: task.iconName,
            actionRoute: task.actionRoute,
            displayOrder: task.displayOrder,
            isSystem: true,
          },
          $setOnInsert: {
            status: UserTaskStatus.ACTIVE,
            rewardAmountKobo: 0,
          },
        },
        { upsert: true },
      );
    }
    this.logger.log('System tasks seeded');
  }

  // ═══════════════════════════════════════════════════════════
  // USER-FACING
  // ═══════════════════════════════════════════════════════════

  /**
   * Get all active tasks
   */
  async getActiveTasks(): Promise<UserTaskDocument[]> {
    return this.taskModel
      .find({ status: UserTaskStatus.ACTIVE })
      .sort({ displayOrder: 1 })
      .exec();
  }

  /**
   * Get active tasks with user's completion progress
   */
  async getUserTasksWithProgress(userId: string) {
    const tasks = await this.getActiveTasks();

    const completions = await this.completionModel
      .find({
        userId: new Types.ObjectId(userId),
        taskKey: { $in: tasks.map((t) => t.taskKey) },
      })
      .lean()
      .exec();

    const completedKeys = new Set(completions.map((c) => c.taskKey));

    return tasks.map((task) => ({
      ...task.toJSON(),
      isCompleted: completedKeys.has(task.taskKey),
    }));
  }

  /**
   * Complete a task for a user
   */
  async completeTask(userId: string, taskKey: string) {
    // Check if already completed
    const existing = await this.completionModel.findOne({
      userId: new Types.ObjectId(userId),
      taskKey,
    });
    if (existing) {
      throw new BadRequestException('Task already completed');
    }

    // Find the task
    const task = await this.taskModel.findOne({
      taskKey,
      status: UserTaskStatus.ACTIVE,
    });
    if (!task) {
      throw new NotFoundException('Task not found or not active');
    }

    // Create completion record
    const completion = new this.completionModel({
      userId: new Types.ObjectId(userId),
      taskId: task._id,
      taskKey: task.taskKey,
      rewardAmountKobo: task.rewardAmountKobo,
      completedAt: new Date(),
    });

    // Credit wallet if reward > 0
    if (task.rewardAmountKobo > 0) {
      try {
        const walletTxn = await this.walletService.creditWallet({
          userId,
          amount: task.rewardAmountKobo,
          category: TransactionCategory.TASK_REWARD,
          source: TransactionSource.TASK_REWARD,
          narration: `Task reward: ${task.title}`,
          meta: {
            taskId: task._id.toString(),
            taskKey: task.taskKey,
          },
        });
        completion.walletTransactionId = (walletTxn as any)._id;
        this.logger.log(
          `Rewarded user ${userId} with ${task.rewardAmountKobo} kobo for task ${taskKey}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to reward user ${userId} for task ${taskKey}: ${err.message}`,
        );
      }
    }

    await completion.save();
    return completion;
  }

  /**
   * Check if a task is completed by a user
   */
  async isTaskCompleted(userId: string, taskKey: string): Promise<boolean> {
    const completion = await this.completionModel.findOne({
      userId: new Types.ObjectId(userId),
      taskKey,
    });
    return !!completion;
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN: TASK MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  /**
   * Create a custom task (admin)
   */
  async createTask(
    dto: CreateUserTaskDto,
    adminId: string,
  ): Promise<UserTaskDocument> {
    const taskKey = dto.title
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    const task = new this.taskModel({
      title: dto.title,
      description: dto.description || '',
      taskKey,
      isSystem: false,
      rewardAmountKobo: dto.rewardAmountKobo || 0,
      displayOrder: dto.displayOrder || 0,
      iconName: dto.iconName || 'checkmark-circle',
      actionRoute: dto.actionRoute || '',
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      status: UserTaskStatus.ACTIVE,
      createdBy: new Types.ObjectId(adminId),
    });

    const saved = await task.save();
    this.logger.log(`Task created: ${saved._id} by admin ${adminId}`);
    return saved;
  }

  /**
   * Update a task (admin)
   * System tasks only allow rewardAmountKobo updates
   */
  async updateTask(
    id: string,
    dto: UpdateUserTaskDto,
    adminId: string,
  ): Promise<UserTaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    if (task.isSystem) {
      // System tasks: only allow reward amount update
      if (dto.rewardAmountKobo !== undefined) {
        task.rewardAmountKobo = dto.rewardAmountKobo;
      }
    } else {
      // Custom tasks: allow all updates
      if (dto.title !== undefined) task.title = dto.title;
      if (dto.description !== undefined) task.description = dto.description;
      if (dto.rewardAmountKobo !== undefined)
        task.rewardAmountKobo = dto.rewardAmountKobo;
      if (dto.displayOrder !== undefined) task.displayOrder = dto.displayOrder;
      if (dto.iconName !== undefined) task.iconName = dto.iconName;
      if (dto.actionRoute !== undefined) task.actionRoute = dto.actionRoute;
      if (dto.startsAt !== undefined) task.startsAt = new Date(dto.startsAt);
      if (dto.endsAt !== undefined) task.endsAt = new Date(dto.endsAt);
    }

    return task.save();
  }

  /**
   * Delete a task (admin, blocked for system tasks)
   */
  async deleteTask(id: string): Promise<void> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    if (task.isSystem) {
      throw new BadRequestException('Cannot delete a system task');
    }

    await this.taskModel.deleteOne({ _id: task._id });
    this.logger.log(`Task deleted: ${id}`);
  }

  /**
   * Set task status
   */
  async setTaskStatus(
    id: string,
    status: UserTaskStatus,
  ): Promise<UserTaskDocument> {
    const task = await this.taskModel.findById(id);
    if (!task) throw new NotFoundException('Task not found');

    task.status = status;
    return task.save();
  }

  /**
   * List all tasks (admin, paginated)
   */
  async getTasks(query: UserTaskQueryDto) {
    const filter: any = {};
    if (query.status) filter.status = query.status;

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = calculateSkip(page, limit);

    const [data, total] = await Promise.all([
      this.taskModel
        .find(filter)
        .sort({ displayOrder: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.taskModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  /**
   * Get paginated completions for a task (admin)
   */
  async getTaskCompletions(taskId: string, query: UserTaskQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = calculateSkip(page, limit);

    const filter = { taskId: new Types.ObjectId(taskId) };

    const [data, total] = await Promise.all([
      this.completionModel
        .find(filter)
        .populate('userId', 'fullName email')
        .sort({ completedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.completionModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  /**
   * Get completion stats for a task (admin)
   */
  async getCompletionStats(taskId: string) {
    const total = await this.completionModel.countDocuments({
      taskId: new Types.ObjectId(taskId),
    });
    return { taskId, totalCompletions: total };
  }
}
