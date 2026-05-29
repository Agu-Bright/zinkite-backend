/**
 * User Task Admin Controller
 *
 * Admin endpoints for managing user tasks.
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../admin/guards/permissions.guard';
import { RequirePermissions } from '../admin/decorators/require-permissions.decorator';
import { UserTaskService } from './user-task.service';
import {
  CreateUserTaskDto,
  UpdateUserTaskDto,
  UserTaskQueryDto,
} from './dto';
import { UserTaskStatus } from './schemas/user-task.schema';

@ApiTags('Admin Tasks')
@Controller('admin/tasks')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth('JWT-auth')
export class UserTaskAdminController {
  constructor(private readonly userTaskService: UserTaskService) {}

  /**
   * List all tasks (paginated)
   */
  @Get()
  @RequirePermissions('tasks.manage')
  async getTasks(@Query() query: UserTaskQueryDto) {
    return this.userTaskService.getTasks(query);
  }

  /**
   * Create a custom task
   */
  @Post()
  @RequirePermissions('tasks.manage')
  async createTask(@Req() req: any, @Body() dto: CreateUserTaskDto) {
    const adminId = req.user.adminId || req.user.sub;
    return this.userTaskService.createTask(dto, adminId);
  }

  /**
   * Update a task
   */
  @Patch(':id')
  @RequirePermissions('tasks.manage')
  async updateTask(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateUserTaskDto,
  ) {
    const adminId = req.user.adminId || req.user.sub;
    return this.userTaskService.updateTask(id, dto, adminId);
  }

  /**
   * Delete a task (blocked for system tasks)
   */
  @Delete(':id')
  @RequirePermissions('tasks.manage')
  async deleteTask(@Param('id') id: string) {
    await this.userTaskService.deleteTask(id);
    return { message: 'Task deleted' };
  }

  /**
   * Activate a task
   */
  @Post(':id/activate')
  @RequirePermissions('tasks.manage')
  @HttpCode(HttpStatus.OK)
  async activateTask(@Param('id') id: string) {
    return this.userTaskService.setTaskStatus(id, UserTaskStatus.ACTIVE);
  }

  /**
   * Pause a task
   */
  @Post(':id/pause')
  @RequirePermissions('tasks.manage')
  @HttpCode(HttpStatus.OK)
  async pauseTask(@Param('id') id: string) {
    return this.userTaskService.setTaskStatus(id, UserTaskStatus.PAUSED);
  }

  /**
   * Get completions for a task
   */
  @Get(':id/completions')
  @RequirePermissions('tasks.manage')
  async getCompletions(
    @Param('id') id: string,
    @Query() query: UserTaskQueryDto,
  ) {
    return this.userTaskService.getTaskCompletions(id, query);
  }
}
