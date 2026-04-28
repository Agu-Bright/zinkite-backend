/**
 * Gift Cards Service
 * Handles all gift card related business logic including brands, categories, rates, and trades
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types } from 'mongoose';
import {
  GiftCardBrand,
  GiftCardBrandDocument,
  BrandStatus,
} from './schemas/gift-card-brand.schema';
import {
  GiftCardCategory,
  GiftCardCategoryDocument,
  CategoryStatus,
} from './schemas/gift-card-category.schema';
import {
  GiftCardRate,
  GiftCardRateDocument,
  RateStatus,
} from './schemas/gift-card-rate.schema';
import {
  GiftCardTrade,
  GiftCardTradeDocument,
  TradeStatus,
} from './schemas/gift-card-trade.schema';
import { WalletService } from '../wallet/wallet.service';
import {
  TransactionCategory,
  TransactionSource,
} from '../wallet/schemas/wallet-transaction.schema';
import {
  CreateBrandDto,
  UpdateBrandDto,
  BrandQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQueryDto,
  CreateRateDto,
  UpdateRateDto,
  RateQueryDto,
  SubmitTradeDto,
  ReviewTradeDto,
  TradeQueryDto,
  CalculatedRateResponse,
} from './dto';
import { generateReference, paginate, calculateSkip, toKobo, toNaira } from '../common/utils/helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/user-notification.schema';
import { EmailService } from '../email/email.service';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class GiftCardsService implements OnModuleInit {
  private readonly logger = new Logger(GiftCardsService.name);

  constructor(
    @InjectModel(GiftCardBrand.name)
    private readonly brandModel: Model<GiftCardBrandDocument>,
    @InjectModel(GiftCardCategory.name)
    private readonly categoryModel: Model<GiftCardCategoryDocument>,
    @InjectModel(GiftCardRate.name)
    private readonly rateModel: Model<GiftCardRateDocument>,
    @InjectModel(GiftCardTrade.name)
    private readonly tradeModel: Model<GiftCardTradeDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Fix any existing rates where categoryId was stored as a string instead of ObjectId.
   * This runs once on startup and ensures all rate queries work correctly.
   */
  async onModuleInit() {
    try {
      const db = this.connection.db;
      if (!db) return;
      const ratesCol = db.collection('giftcardrates');
      const allRates = await ratesCol.find({}).toArray();
      let fixed = 0;
      for (const rate of allRates) {
        if (typeof rate.categoryId === 'string') {
          await ratesCol.updateOne(
            { _id: rate._id },
            { $set: { categoryId: new Types.ObjectId(rate.categoryId) } },
          );
          fixed++;
        }
      }
      if (fixed > 0) {
        this.logger.log(`Fixed ${fixed} rate(s) with string categoryId → ObjectId`);
      }
    } catch (err) {
      this.logger.warn(`Rate data migration check failed: ${err}`);
    }
  }

  // ============================================
  // BRAND OPERATIONS
  // ============================================

  /**
   * Create a new gift card brand
   */
  async createBrand(dto: CreateBrandDto): Promise<GiftCardBrand> {
    // Check for duplicate name or slug among active brands
    const existingBrand = await this.brandModel.findOne({
      status: BrandStatus.ACTIVE,
      $or: [
        { name: { $regex: new RegExp(`^${dto.name}$`, 'i') } },
        { slug: dto.slug },
      ],
    });

    if (existingBrand) {
      throw new ConflictException('Brand with this name or slug already exists');
    }

    const brand = new this.brandModel(dto);
    return brand.save();
  }

  /**
   * Get all brands with pagination and filters
   */
  async getBrands(query: BrandQueryDto): Promise<PaginatedResult<GiftCardBrand>> {
    const filter: any = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.featured !== undefined) {
      filter.isFeatured = query.featured;
    }

    if (query.search) {
      filter.$text = { $search: query.search };
    }

    const total = await this.brandModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const brands = await this.brandModel
      .find(filter)
      .sort({ sortOrder: 1, name: 1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(brands, total, page, limit);
  }

  /**
   * Get active brands only (for public API)
   */
  async getActiveBrands(): Promise<GiftCardBrand[]> {
    return this.brandModel
      .find({ status: BrandStatus.ACTIVE })
      .sort({ sortOrder: 1, name: 1 });
  }

  /**
   * Get a single brand by ID
   */
  async getBrandById(id: string): Promise<GiftCardBrand> {
    const brand = await this.brandModel.findById(id);
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return brand;
  }

  /**
   * Update a brand
   */
  async updateBrand(id: string, dto: UpdateBrandDto): Promise<GiftCardBrand> {
    // Check for duplicate name or slug if being updated
    if (dto.name || dto.slug) {
      const existingBrand = await this.brandModel.findOne({
        _id: { $ne: id },
        status: BrandStatus.ACTIVE,
        $or: [
          ...(dto.name ? [{ name: { $regex: new RegExp(`^${dto.name}$`, 'i') } }] : []),
          ...(dto.slug ? [{ slug: dto.slug }] : []),
        ],
      });

      if (existingBrand) {
        throw new ConflictException('Brand with this name or slug already exists');
      }
    }

    const brand = await this.brandModel.findByIdAndUpdate(
      id,
      { $set: dto },
      { new: true },
    );

    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    return brand;
  }

  /**
   * Delete a brand (soft delete by setting status to INACTIVE)
   */
  async deleteBrand(id: string): Promise<void> {
    const brand = await this.brandModel.findByIdAndDelete(id);

    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
  }

  // ============================================
  // CATEGORY OPERATIONS
  // ============================================

  /**
   * Create a new category
   */
  async createCategory(dto: CreateCategoryDto): Promise<GiftCardCategory> {
    // Verify brand exists and is active
    const brand = await this.brandModel.findById(dto.brandId);
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    // Check for duplicate slug within brand (active only)
    const existingCategory = await this.categoryModel.findOne({
      brandId: dto.brandId,
      slug: dto.slug,
      status: CategoryStatus.ACTIVE,
    });

    if (existingCategory) {
      throw new ConflictException('Category with this slug already exists for this brand');
    }

    // Validate value ranges
    if (dto.minValue >= dto.maxValue) {
      throw new BadRequestException('Minimum value must be less than maximum value');
    }

    const category = new this.categoryModel(dto);
    return category.save();
  }

  /**
   * Get categories with pagination and filters
   */
  async getCategories(query: CategoryQueryDto): Promise<PaginatedResult<GiftCardCategory>> {
    const filter: any = {};

    if (query.brandId) {
      filter.brandId = new Types.ObjectId(query.brandId);
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.cardType) {
      filter.cardType = query.cardType;
    }

    const total = await this.categoryModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const categories = await this.categoryModel
      .find(filter)
      .populate('brandId', 'name slug logoUrl')
      .sort({ sortOrder: 1, name: 1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(categories, total, page, limit);
  }

  /**
   * Get active categories for a brand (public API)
   *
   * IMPORTANT: brandId MUST be cast to ObjectId explicitly. Although Mongoose
   * usually auto-casts string query params based on the schema type, in this
   * DB a mix of legacy categories (brandId stored as string — created via
   * admin UI before the schema was fully enforced) and seeded categories
   * (brandId stored as ObjectId) exist side-by-side. Without an explicit
   * cast, the string comparison silently matches ONLY the string-brandId
   * docs and drops the ObjectId-brandId ones — which is exactly why the
   * mobile app was seeing "no categories" while the admin (which uses the
   * sibling `getCategories()` method that already casts explicitly at
   * line ~269) was showing the real data.
   */
  async getActiveCategories(brandId: string): Promise<GiftCardCategory[]> {
    if (!Types.ObjectId.isValid(brandId)) {
      return [];
    }
    // Match BOTH forms: legacy string-brandId docs AND properly-cast ObjectId docs.
    // The DB has a mix until fix-string-brandids.js is run on production.
    const oid = new Types.ObjectId(brandId);
    return this.categoryModel
      .find({
        $or: [
          { brandId: oid },
          { brandId: brandId },
        ],
        status: CategoryStatus.ACTIVE,
      })
      .sort({ sortOrder: 1, name: 1 });
  }

  /**
   * Get a single category by ID
   */
  async getCategoryById(id: string): Promise<GiftCardCategory> {
    const category = await this.categoryModel
      .findById(id)
      .populate('brandId', 'name slug logoUrl');

    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  /**
   * Update a category
   */
  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<GiftCardCategory> {
    if (dto.minValue !== undefined && dto.maxValue !== undefined) {
      if (dto.minValue >= dto.maxValue) {
        throw new BadRequestException('Minimum value must be less than maximum value');
      }
    }

    const category = await this.categoryModel.findByIdAndUpdate(
      id,
      { $set: dto },
      { new: true },
    );

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  /**
   * Delete a category
   */
  async deleteCategory(id: string): Promise<void> {
    const category = await this.categoryModel.findByIdAndDelete(id);

    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  // ============================================
  // RATE OPERATIONS
  // ============================================

  /**
   * Create a new rate
   */
  /**
   * Build a filter that matches categoryId regardless of stored BSON type (String or ObjectId).
   * Mongoose auto-casting can fail if data was saved with the wrong type.
   */
  private categoryIdFilter(id: string): any {
    try {
      return { $in: [id, new Types.ObjectId(id)] };
    } catch {
      return id;
    }
  }

  async createRate(dto: CreateRateDto): Promise<GiftCardRate> {
    // Verify category exists
    const category = await this.categoryModel.findById(dto.categoryId);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    // Validate value range
    if (dto.minValue >= dto.maxValue) {
      throw new BadRequestException('Minimum value must be less than maximum value');
    }

    const catOid = new Types.ObjectId(dto.categoryId);

    // Check for overlapping ranges
    const overlappingRate = await this.rateModel.findOne({
      categoryId: this.categoryIdFilter(dto.categoryId),
      status: RateStatus.ACTIVE,
      $or: [
        { minValue: { $lte: dto.minValue }, maxValue: { $gte: dto.minValue } },
        { minValue: { $lte: dto.maxValue }, maxValue: { $gte: dto.maxValue } },
        { minValue: { $gte: dto.minValue }, maxValue: { $lte: dto.maxValue } },
      ],
    });

    if (overlappingRate) {
      throw new ConflictException('A rate with overlapping value range already exists');
    }

    // Explicitly cast categoryId to ObjectId to ensure correct BSON type storage
    const rate = new this.rateModel({
      ...dto,
      categoryId: catOid,
    });
    return rate.save();
  }

  /**
   * Get rates with pagination and filters
   */
  async getRates(query: RateQueryDto): Promise<PaginatedResult<GiftCardRate>> {
    const filter: any = {};

    if (query.categoryId) {
      filter.categoryId = this.categoryIdFilter(query.categoryId);
    }

    if (query.status) {
      filter.status = query.status;
    }

    const total = await this.rateModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const rates = await this.rateModel
      .find(filter)
      .populate('categoryId', 'name slug cardType')
      .sort({ minValue: 1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(rates, total, page, limit);
  }

  /**
   * Get the applicable rate for a card value
   */
  async getApplicableRate(categoryId: string, cardValue: number): Promise<CalculatedRateResponse> {
    // Verify category exists and is active
    const category = await this.categoryModel.findOne({
      _id: categoryId,
      status: CategoryStatus.ACTIVE,
    });

    if (!category) {
      throw new NotFoundException('Category not found or inactive');
    }

    // Validate card value is within category limits
    if (cardValue < category.minValue || cardValue > category.maxValue) {
      throw new BadRequestException(
        `Card value must be between ${category.minValue} and ${category.maxValue} USD`,
      );
    }

    // Use flexible filter to match categoryId regardless of stored BSON type
    const rate = await this.rateModel.findOne({
      categoryId: this.categoryIdFilter(categoryId),
      status: RateStatus.ACTIVE,
      minValue: { $lte: cardValue },
      maxValue: { $gte: cardValue },
    });

    if (!rate) {
      throw new NotFoundException('No rate found for this card value');
    }

    const amountNgn = cardValue * rate.rate;

    return {
      categoryId,
      cardValueUsd: cardValue,
      rate: rate.rate,
      amountNgn,
      rateId: (rate as any)._id.toString(),
    };
  }

  /**
   * Update a rate
   */
  async updateRate(id: string, dto: UpdateRateDto): Promise<GiftCardRate> {
    // Ensure categoryId is stored as ObjectId if provided
    const updateData: any = { ...dto };
    if (updateData.categoryId) {
      updateData.categoryId = new Types.ObjectId(updateData.categoryId);
    }

    const rate = await this.rateModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true },
    );

    if (!rate) {
      throw new NotFoundException('Rate not found');
    }

    return rate;
  }

  /**
   * Delete a rate
   */
  async deleteRate(id: string): Promise<void> {
    const rate = await this.rateModel.findByIdAndDelete(id);

    if (!rate) {
      throw new NotFoundException('Rate not found');
    }
  }

  // ============================================
  // TRADE OPERATIONS
  // ============================================

  /**
   * Submit a new trade (user action)
   */
  async submitTrade(userId: string, dto: SubmitTradeDto): Promise<GiftCardTrade> {
    // Get the applicable rate
    const rateInfo = await this.getApplicableRate(dto.categoryId, dto.cardValueUsd);

    // Get category to find brandId
    const category = await this.categoryModel.findById(dto.categoryId);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    // Generate unique reference
    const reference = generateReference('GC');

    // Convert amount to kobo for storage
    const amountNgnKobo = toKobo(rateInfo.amountNgn);

    const trade = new this.tradeModel({
      userId: new Types.ObjectId(userId),
      brandId: category.brandId,
      categoryId: new Types.ObjectId(dto.categoryId),
      rateId: new Types.ObjectId(rateInfo.rateId),
      reference,
      cardValueUsd: dto.cardValueUsd,
      rateApplied: rateInfo.rate,
      amountNgn: amountNgnKobo,
      cardCode: dto.cardCode || null,
      cardPin: dto.cardPin || null,
      proofImages: dto.proofImages,
      userNotes: dto.userNotes || null,
      status: TradeStatus.PENDING,
    });

    const savedTrade = await trade.save();

    this.logger.log(
      `Trade submitted: ${reference} | User: ${userId} | Amount: NGN ${rateInfo.amountNgn}`,
    );

    return savedTrade;
  }

  /**
   * Get user's trades (paginated)
   */
  async getUserTrades(
    userId: string,
    query: TradeQueryDto,
  ): Promise<PaginatedResult<GiftCardTrade>> {
    const filter: any = { userId: new Types.ObjectId(userId) };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.brandId) {
      filter.brandId = new Types.ObjectId(query.brandId);
    }

    if (query.categoryId) {
      filter.categoryId = new Types.ObjectId(query.categoryId);
    }

    const total = await this.tradeModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const trades = await this.tradeModel
      .find(filter)
      .populate('brandId', 'name slug logoUrl')
      .populate('categoryId', 'name slug cardType')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(trades, total, page, limit);
  }

  /**
   * Get all trades (admin - paginated)
   */
  async getAllTrades(query: TradeQueryDto): Promise<PaginatedResult<GiftCardTrade>> {
    const filter: any = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.brandId) {
      filter.brandId = new Types.ObjectId(query.brandId);
    }

    if (query.categoryId) {
      filter.categoryId = new Types.ObjectId(query.categoryId);
    }

    if (query.userId) {
      filter.userId = new Types.ObjectId(query.userId);
    }

    if (query.search) {
      filter.$or = [
        { reference: { $regex: query.search, $options: 'i' } },
        { $text: { $search: query.search } },
      ];
    }

    const total = await this.tradeModel.countDocuments(filter);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const trades = await this.tradeModel
      .find(filter)
      .populate('userId', 'email phone fullName')
      .populate('brandId', 'name slug logoUrl')
      .populate('categoryId', 'name slug cardType')
      .sort({ createdAt: -1 })
      .skip(calculateSkip(page, limit))
      .limit(limit);

    return paginate(trades, total, page, limit);
  }

  /**
   * Get a single trade by ID
   */
  async getTradeById(id: string, userId?: string): Promise<GiftCardTrade> {
    const filter: any = { _id: id };

    // If userId provided, ensure user owns the trade
    if (userId) {
      filter.userId = new Types.ObjectId(userId);
    }

    const trade = await this.tradeModel
      .findOne(filter)
      .populate('userId', 'email phone fullName')
      .populate('brandId', 'name slug logoUrl')
      .populate('categoryId', 'name slug cardType')
      .populate('reviewedBy', 'email fullName');

    if (!trade) {
      throw new NotFoundException('Trade not found');
    }

    return trade;
  }

  /**
   * Review and process a trade (admin action)
   */
  async reviewTrade(
    tradeId: string,
    adminId: string,
    dto: ReviewTradeDto,
  ): Promise<GiftCardTrade> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      // Get the trade
      const trade = await this.tradeModel.findById(tradeId).session(session);

      if (!trade) {
        throw new NotFoundException('Trade not found');
      }

      // Validate trade can be reviewed
      if (trade.status !== TradeStatus.PENDING && trade.status !== TradeStatus.PROCESSING) {
        throw new BadRequestException('Trade has already been reviewed');
      }

      // Validate rejection has reason
      if (dto.status === TradeStatus.REJECTED && !dto.rejectionReason) {
        throw new BadRequestException('Rejection reason is required');
      }

      // Update trade status
      trade.status = dto.status;
      if (dto.adminNotes !== undefined) {
        trade.adminNotes = dto.adminNotes || null;
      }

      // PROCESSING is an intermediate state — don't set reviewedBy/reviewedAt
      if (dto.status === TradeStatus.PROCESSING) {
        this.logger.log(`Trade marked as processing: ${trade.reference}`);

        await trade.save({ session });
        await session.commitTransaction();

        const populated = await this.tradeModel
          .findById(trade._id)
          .populate('userId', 'email phone fullName')
          .populate('brandId', 'name slug logoUrl')
          .populate('categoryId', 'name slug cardType');

        return populated || trade;
      }

      // Final review — set reviewer info
      trade.rejectionReason = dto.rejectionReason || null;
      trade.reviewedBy = new Types.ObjectId(adminId);
      trade.reviewedAt = new Date();

      // If approved, credit the wallet
      if (dto.status === TradeStatus.APPROVED) {
        const amountToCredit = dto.adjustedAmountNgn ?? trade.amountNgn;

        // Credit user's wallet
        const walletTransaction = await this.walletService.creditWallet({
          userId: trade.userId.toString(),
          amount: amountToCredit,
          category: TransactionCategory.GIFTCARD,
          source: TransactionSource.GIFTCARD_TRADE,
          reference: trade.reference,
          narration: `Gift card trade approved: ${trade.reference}`,
          meta: {
            tradeId: trade._id,
            brandId: trade.brandId,
            categoryId: trade.categoryId,
            cardValueUsd: trade.cardValueUsd,
            rateApplied: trade.rateApplied,
            originalAmountNgn: trade.amountNgn,
            adjustedAmountNgn: dto.adjustedAmountNgn,
          },
          session,
        });

        trade.walletTransactionId = (walletTransaction as any)._id;

        // Update amount if adjusted
        if (dto.adjustedAmountNgn !== undefined) {
          trade.amountNgn = dto.adjustedAmountNgn;
        }

        this.logger.log(
          `Trade approved: ${trade.reference} | Credited: NGN ${toNaira(amountToCredit)}`,
        );
      } else {
        this.logger.log(
          `Trade rejected: ${trade.reference} | Reason: ${dto.rejectionReason}`,
        );
      }

      await trade.save({ session });
      await session.commitTransaction();

      // Re-populate after save so the response has full objects
      const populated = await this.tradeModel
        .findById(trade._id)
        .populate('userId', 'email phone fullName')
        .populate('brandId', 'name slug logoUrl')
        .populate('categoryId', 'name slug cardType')
        .populate('reviewedBy', 'email fullName');

      // Send push notification to user (best-effort, outside transaction)
      const userId = trade.userId.toString();
      const brandName = (populated?.brandId as any)?.name || 'Gift Card';
      if (dto.status === TradeStatus.APPROVED) {
        const creditedNaira = toNaira(dto.adjustedAmountNgn ?? trade.amountNgn);
        this.notificationsService.sendToUser(
          userId,
          'Trade Approved!',
          `Your ${brandName} trade has been approved. ₦${creditedNaira.toLocaleString()} has been credited to your wallet.`,
          { type: 'trade_review', tradeId: trade._id.toString() },
          NotificationType.TRADE,
        ).catch(err => this.logger.error(`Failed to send trade approval notification: ${err.message}`));

        // Send email notification
        const userEmail = (populated?.userId as any)?.email;
        if (userEmail) {
          this.emailService.sendTradeApproved(
            userEmail, brandName, trade.cardValueUsd, toNaira(dto.adjustedAmountNgn ?? trade.amountNgn), trade.reference,
          ).catch(err => this.logger.error(`Failed to send trade approval email: ${err.message}`));
        }
      } else if (dto.status === TradeStatus.REJECTED) {
        this.notificationsService.sendToUser(
          userId,
          'Trade Rejected',
          `Your ${brandName} trade was rejected. Reason: ${dto.rejectionReason || 'No reason provided'}`,
          { type: 'trade_review', tradeId: trade._id.toString() },
          NotificationType.TRADE,
        ).catch(err => this.logger.error(`Failed to send trade rejection notification: ${err.message}`));

        // Send email notification
        const userEmail = (populated?.userId as any)?.email;
        if (userEmail) {
          this.emailService.sendTradeRejected(
            userEmail, brandName, trade.reference, dto.rejectionReason || 'No reason provided',
          ).catch(err => this.logger.error(`Failed to send trade rejection email: ${err.message}`));
        }
      }

      return populated || trade;
    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`Trade review failed: ${error.message}`, error.stack);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Cancel a trade (user action - only for PENDING trades)
   */
  async cancelTrade(tradeId: string, userId: string): Promise<GiftCardTrade> {
    const trade = await this.tradeModel.findOne({
      _id: tradeId,
      userId: new Types.ObjectId(userId),
    });

    if (!trade) {
      throw new NotFoundException('Trade not found');
    }

    if (trade.status !== TradeStatus.PENDING) {
      throw new BadRequestException('Only pending trades can be cancelled');
    }

    trade.status = TradeStatus.CANCELLED;
    await trade.save();

    this.logger.log(`Trade cancelled by user: ${trade.reference}`);

    return trade;
  }

  /**
   * Get trade statistics (admin)
   */
  async getTradeStats(): Promise<any> {
    const stats = await this.tradeModel.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmountNgn: { $sum: '$amountNgn' },
        },
      },
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayStats = await this.tradeModel.aggregate([
      { $match: { createdAt: { $gte: today } } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmountNgn: { $sum: '$amountNgn' },
        },
      },
    ]);

    return {
      overall: stats,
      today: todayStats,
    };
  }
}
