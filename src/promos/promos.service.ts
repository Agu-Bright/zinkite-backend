/**
 * Promos Service
 *
 * Business logic for promo banners.
 */
import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PromoBanner, PromoBannerDocument, BannerStatus } from './schemas/promo-banner.schema';
import { CreatePromoBannerDto, UpdatePromoBannerDto, PromoBannerQueryDto } from './dto';
import { paginate, calculateSkip } from '../common/utils/helpers';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class PromosService {
  private readonly logger = new Logger(PromosService.name);

  constructor(
    @InjectModel(PromoBanner.name)
    private readonly bannerModel: Model<PromoBannerDocument>,
  ) {}

  /**
   * Get active banners for public display (mobile app).
   * Returns ACTIVE banners within their scheduled date range.
   */
  async getActiveBanners(): Promise<PromoBanner[]> {
    const now = new Date();

    const banners = await this.bannerModel
      .find({
        status: BannerStatus.ACTIVE,
        $or: [
          { startsAt: null, endsAt: null },
          { startsAt: { $lte: now }, endsAt: null },
          { startsAt: null, endsAt: { $gte: now } },
          { startsAt: { $lte: now }, endsAt: { $gte: now } },
        ],
      })
      .sort({ displayOrder: 1, createdAt: -1 });

    return banners;
  }

  /**
   * Get banners (admin, paginated).
   */
  async getBanners(query: PromoBannerQueryDto): Promise<PaginatedResult<PromoBanner>> {
    const filter: Record<string, any> = {};

    if (query.status) filter.status = query.status;
    if (query.search) {
      filter.$or = [
        { label: { $regex: query.search, $options: 'i' } },
        { title: { $regex: query.search, $options: 'i' } },
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const total = await this.bannerModel.countDocuments(filter);

    const banners = await this.bannerModel
      .find(filter)
      .sort({ displayOrder: 1, createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(banners, total, page, limit);
  }

  /**
   * Create a banner.
   */
  async createBanner(dto: CreatePromoBannerDto): Promise<PromoBanner> {
    const banner = new this.bannerModel(dto);
    const saved = await banner.save();
    this.logger.log(`Banner created: ${saved._id}`);
    return saved;
  }

  /**
   * Update a banner.
   */
  async updateBanner(id: string, dto: UpdatePromoBannerDto): Promise<PromoBanner> {
    const banner = await this.bannerModel.findByIdAndUpdate(
      id,
      { $set: dto },
      { new: true },
    );
    if (!banner) throw new NotFoundException('Banner not found');
    this.logger.log(`Banner updated: ${id}`);
    return banner;
  }

  /**
   * Delete a banner.
   */
  async deleteBanner(id: string): Promise<void> {
    const result = await this.bannerModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Banner not found');
    this.logger.log(`Banner deleted: ${id}`);
  }
}
