/**
 * Promos Module
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromoBanner, PromoBannerSchema } from './schemas/promo-banner.schema';
import { PromosService } from './promos.service';
import { PromosController, AdminPromosController } from './promos.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PromoBanner.name, schema: PromoBannerSchema },
    ]),
  ],
  controllers: [PromosController, AdminPromosController],
  providers: [PromosService],
  exports: [PromosService],
})
export class PromosModule {}
