import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PERMISSIONS, RequireAnyPermission, RequirePermissions } from '../admin/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../admin/guards/permissions.guard';
import { VtuQueryDto } from './dto/vtu.dto';
import { VtuService } from './vtu.service';

@Controller('admin/vtu')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VtuAdminController {
  constructor(private readonly service: VtuService) {}
  @Get() @RequirePermissions(PERMISSIONS.VTU_VIEW)
  async list(@Query() query: VtuQueryDto) {
    const result = await this.service.list(query);
    return { data: result.data, meta: { ...result.pagination, totalPages: result.pagination.pages } };
  }
  @Get('stats') @RequirePermissions(PERMISSIONS.VTU_VIEW)
  async stats() { return { success: true, data: await this.service.stats() }; }
  @Post(':id/requery') @RequireAnyPermission(PERMISSIONS.VTU_RETRY, PERMISSIONS.ELECTRICITY_RETRY)
  async requery(@Param('id') id: string) { return { success: true, data: await this.service.requery(id) }; }
  @Post(':id/refund') @RequireAnyPermission(PERMISSIONS.VTU_REFUND, PERMISSIONS.ELECTRICITY_REFUND)
  async refund(@Param('id') id: string) { return { success: true, data: await this.service.refund(id, 'Refunded by administrator') }; }
}
