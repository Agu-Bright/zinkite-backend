import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, RequirePin } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PinGuard } from '../common/guards/pin.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PurchaseAirtimeDto, PurchaseDataDto, PurchaseElectricityDto, PurchaseTvDto, VerifyCustomerDto, VtuQueryDto } from './dto/vtu.dto';
import { VtuService } from './vtu.service';

@Controller('vtu')
export class VtuController {
  constructor(private readonly service: VtuService) {}

  @Get('networks') networks() { return { success: true, data: this.service.networks() }; }
  @Get('data-plans') async dataPlans(@Query('network') network: string) { return { success: true, data: await this.service.dataPlans(network) }; }
  @Get('electricity/providers') async electricityProviders() { return { success: true, data: await this.service.electricityProviders() }; }
  @Get('tv/:serviceId/bouquets') async bouquets(@Param('serviceId') serviceId: string) { return { success: true, data: await this.service.tvBouquets(serviceId) }; }

  @Post('verify') @UseGuards(JwtAuthGuard)
  async verify(@Body() dto: VerifyCustomerDto) { return { success: true, data: await this.service.verifyCustomer(dto.serviceId, dto.billersCode, dto.type) }; }

  @Post('airtime')
  @Throttle({ short: { limit: 1, ttl: 1000 }, medium: { limit: 3, ttl: 60000 }, long: { limit: 15, ttl: 3600000 } })
  @UseGuards(JwtAuthGuard, PinGuard) @RequirePin()
  async airtime(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PurchaseAirtimeDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    return { success: true, data: await this.service.purchaseAirtime(user.sub, dto, idempotencyKey) };
  }

  @Post('data') @UseGuards(JwtAuthGuard, PinGuard) @RequirePin()
  async data(@CurrentUser() user: JwtPayload, @Body() dto: PurchaseDataDto) { return { success: true, data: await this.service.purchaseData(user.sub, dto) }; }

  @Post('electricity') @UseGuards(JwtAuthGuard, PinGuard) @RequirePin()
  async electricity(@CurrentUser() user: JwtPayload, @Body() dto: PurchaseElectricityDto) { return { success: true, data: await this.service.purchaseElectricity(user.sub, dto) }; }

  @Post('tv') @UseGuards(JwtAuthGuard, PinGuard) @RequirePin()
  async tv(@CurrentUser() user: JwtPayload, @Body() dto: PurchaseTvDto) { return { success: true, data: await this.service.purchaseTv(user.sub, dto) }; }

  @Get('history') @UseGuards(JwtAuthGuard)
  async history(@CurrentUser() user: JwtPayload, @Query() query: VtuQueryDto) {
    const result = await this.service.list(query, user.sub);
    return { data: result.data, meta: { ...result.pagination, totalPages: result.pagination.pages } };
  }

  @Get('transactions/:id') @UseGuards(JwtAuthGuard)
  async transaction(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return { success: true, data: await this.service.findOneForUser(id, user.sub) };
  }

  @Post('webhook')
  async webhook(@Body() payload: any) {
    await this.service.handleWebhook(payload);
    return { success: true, response: 'success' };
  }

  @Post(':id/requery') @UseGuards(JwtAuthGuard)
  async requery(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const result: any = await this.service.requery(id, user.sub);
    return { success: true, data: result };
  }
}
