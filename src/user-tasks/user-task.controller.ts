/**
 * User Task Controller (User-facing)
 *
 * Endpoints for users to view active tasks and complete them.
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UserTaskService } from './user-task.service';

@ApiTags('Tasks')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard('jwt'))
@Controller('tasks')
export class UserTaskController {
  constructor(private readonly userTaskService: UserTaskService) {}

  /**
   * Get active tasks with user's completion progress
   */
  @Get('active')
  async getActiveTasks(@Req() req: any) {
    const userId = req.user.userId || req.user.sub;
    return this.userTaskService.getUserTasksWithProgress(userId);
  }

  /**
   * Complete a task
   */
  @Post(':taskKey/complete')
  @HttpCode(HttpStatus.OK)
  async completeTask(@Req() req: any, @Param('taskKey') taskKey: string) {
    const userId = req.user.userId || req.user.sub;
    return this.userTaskService.completeTask(userId, taskKey);
  }
}
