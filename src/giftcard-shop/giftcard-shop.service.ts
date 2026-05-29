/**
 * Gift Card Shop Service
 *
 * Business logic for the admin-stocked gift card shop:
 * - Admin: product CRUD, bulk code upload, purchase management, stats
 * - User: browse products, purchase cards (atomic), purchase history
 *
 * All monetary amounts are stored in kobo (1 NGN = 100 kobo).
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types } from 'mongoose';
import {
  GiftCardShopProduct,
  GiftCardShopProductDocument,
  ShopProductStatus,
} from './schemas/giftcard-shop-product.schema';
import {
  GiftCardShopCode,
  GiftCardShopCodeDocument,
  ShopCodeStatus,
} from './schemas/giftcard-shop-code.schema';
import {
  GiftCardShopPurchase,
  GiftCardShopPurchaseDocument,
  ShopPurchaseStatus,
} from './schemas/giftcard-shop-purchase.schema';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  TransactionCategory,
  TransactionSource,
} from '../wallet/schemas/wallet-transaction.schema';
import {
  generateReference,
  paginate,
  calculateSkip,
  toKobo,
} from '../common/utils/helpers';
import { PaginatedResult } from '../common/dto/pagination.dto';
import {
  CreateShopProductDto,
  UpdateShopProductDto,
  ShopProductQueryDto,
  AddCodesDto,
  PurchaseShopCardDto,
  ShopPurchaseQueryDto,
  UserShopPurchaseQueryDto,
  RefundShopPurchaseDto,
} from './dto';

@Injectable()
export class GiftCardShopService {
  private readonly logger = new Logger(GiftCardShopService.name);

  constructor(
    @InjectModel(GiftCardShopProduct.name)
    private readonly productModel: Model<GiftCardShopProductDocument>,
    @InjectModel(GiftCardShopCode.name)
    private readonly codeModel: Model<GiftCardShopCodeDocument>,
    @InjectModel(GiftCardShopPurchase.name)
    private readonly purchaseModel: Model<GiftCardShopPurchaseDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ============================================
  // ADMIN: PRODUCT MANAGEMENT
  // ============================================

  private generateSlug(brandName: string, countryCode?: string, denominationValue?: number): string {
    const parts = [brandName];
    if (countryCode) parts.push(countryCode);
    if (denominationValue) parts.push(String(denominationValue));
    return parts
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async createProduct(dto: CreateShopProductDto): Promise<GiftCardShopProduct> {
    const slug = this.generateSlug(dto.brandName, dto.countryCode, dto.denominationValue);

    // Check for duplicate slug
    const existing = await this.productModel.findOne({ slug });
    if (existing) {
      throw new BadRequestException(`Product with slug "${slug}" already exists`);
    }

    const product = new this.productModel({
      ...dto,
      slug,
      priceNgn: toKobo(dto.priceNgn),
      costPriceNgn: dto.costPriceNgn ? toKobo(dto.costPriceNgn) : null,
      denominationCurrency: dto.denominationCurrency || 'USD',
    });

    const saved = await product.save();
    this.logger.log(`Product created: ${saved.brandName} ${saved.denominationValue} ${saved.denominationCurrency} [${saved._id}]`);
    return saved;
  }

  async updateProduct(id: string, dto: UpdateShopProductDto): Promise<GiftCardShopProduct> {
    const product = await this.productModel.findById(id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const updateData: any = { ...dto };

    // Convert naira to kobo for price fields
    if (dto.priceNgn !== undefined) {
      updateData.priceNgn = toKobo(dto.priceNgn);
    }
    if (dto.costPriceNgn !== undefined) {
      updateData.costPriceNgn = dto.costPriceNgn ? toKobo(dto.costPriceNgn) : null;
    }

    // Regenerate slug if brand/country/denomination changed
    if (dto.brandName || dto.countryCode || dto.denominationValue) {
      const newSlug = this.generateSlug(
        dto.brandName || product.brandName,
        dto.countryCode || product.countryCode || undefined,
        dto.denominationValue || product.denominationValue,
      );
      if (newSlug !== product.slug) {
        const slugExists = await this.productModel.findOne({ slug: newSlug, _id: { $ne: id } });
        if (slugExists) {
          throw new BadRequestException(`Product with slug "${newSlug}" already exists`);
        }
        updateData.slug = newSlug;
      }
    }

    const updated = await this.productModel.findByIdAndUpdate(id, updateData, { new: true });
    if (!updated) {
      throw new NotFoundException('Product not found after update');
    }
    this.logger.log(`Product updated: ${id}`);
    return updated;
  }

  async addCodes(productId: string, dto: AddCodesDto): Promise<{ added: number }> {
    const product = await this.productModel.findById(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const codeDocs = dto.codes.map((entry) => ({
      productId: new Types.ObjectId(productId),
      code: entry.code,
      pin: entry.pin || null,
      serialNumber: entry.serialNumber || null,
      status: ShopCodeStatus.AVAILABLE,
    }));

    await this.codeModel.insertMany(codeDocs);

    // Atomically increment counts
    const count = codeDocs.length;
    await this.productModel.findByIdAndUpdate(productId, {
      $inc: { totalCodes: count, availableCodes: count },
    });

    // If product was OUT_OF_STOCK, set back to ACTIVE
    if (product.status === ShopProductStatus.OUT_OF_STOCK) {
      await this.productModel.findByIdAndUpdate(productId, {
        status: ShopProductStatus.ACTIVE,
      });
    }

    this.logger.log(`Added ${count} codes to product ${productId}`);
    return { added: count };
  }

  async getProducts(query: ShopProductQueryDto): Promise<PaginatedResult<GiftCardShopProduct>> {
    const { page = 1, limit = 10, brandName, countryCode, status, search, isFeatured } = query;
    const skip = calculateSkip(page, limit);

    const filter: any = {};
    if (brandName) filter.brandName = { $regex: brandName, $options: 'i' };
    if (countryCode) filter.countryCode = countryCode.toUpperCase();
    if (status) filter.status = status;
    if (isFeatured !== undefined) filter.isFeatured = isFeatured;
    if (search) {
      filter.$or = [
        { brandName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.productModel.find(filter).sort({ sortOrder: 1, createdAt: -1 }).skip(skip).limit(limit),
      this.productModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  async getProductById(id: string): Promise<GiftCardShopProduct> {
    const product = await this.productModel.findById(id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  // ============================================
  // ADMIN: PURCHASE MANAGEMENT
  // ============================================

  async getPurchases(query: ShopPurchaseQueryDto): Promise<PaginatedResult<GiftCardShopPurchase>> {
    const { page = 1, limit = 10, status, userId, productId, search } = query;
    const skip = calculateSkip(page, limit);

    const filter: any = {};
    if (status) filter.status = status;
    if (userId) filter.userId = new Types.ObjectId(userId);
    if (productId) filter.productId = new Types.ObjectId(productId);
    if (search) {
      filter.$or = [
        { reference: { $regex: search, $options: 'i' } },
        { brandName: { $regex: search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.purchaseModel
        .find(filter)
        .populate('userId', 'email fullName phone')
        .populate('productId', 'brandName denominationValue denominationCurrency images')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.purchaseModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  async getPurchaseById(id: string): Promise<GiftCardShopPurchase> {
    const purchase = await this.purchaseModel
      .findById(id)
      .populate('userId', 'email fullName phone')
      .populate('productId', 'brandName denominationValue denominationCurrency images slug');

    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }
    return purchase;
  }

  async refundPurchase(purchaseId: string, adminId: string, dto: RefundShopPurchaseDto): Promise<GiftCardShopPurchase> {
    const purchase = await this.purchaseModel.findById(purchaseId);
    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }
    if (purchase.status !== ShopPurchaseStatus.SUCCESS) {
      throw new BadRequestException('Only successful purchases can be refunded');
    }

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      // Credit wallet
      const refundTxn = await this.walletService.creditWallet({
        userId: purchase.userId,
        amount: purchase.amountChargedNgn,
        category: TransactionCategory.REFUND,
        source: TransactionSource.GIFTCARD_SHOP,
        narration: `Refund: ${purchase.brandName} ${purchase.denominationValue} ${purchase.denominationCurrency} gift card`,
        reference: generateReference('GCS_REF'),
        meta: { purchaseId: purchase._id, reason: dto.reason, adminId },
        session,
      });

      // Update purchase status
      purchase.status = ShopPurchaseStatus.REFUNDED;
      purchase.refundTransactionId = (refundTxn as any)._id;
      purchase.meta = { ...purchase.meta, refundReason: dto.reason, refundedBy: adminId };
      await purchase.save({ session });

      // Set code back to AVAILABLE
      if (purchase.codeId) {
        await this.codeModel.findByIdAndUpdate(
          purchase.codeId,
          {
            status: ShopCodeStatus.AVAILABLE,
            purchasedBy: null,
            purchaseId: null,
            purchasedAt: null,
          },
          { session },
        );

        // Increment available count
        await this.productModel.findByIdAndUpdate(
          purchase.productId,
          { $inc: { availableCodes: 1, soldCount: -1 } },
          { session },
        );
      }

      await session.commitTransaction();
      this.logger.log(`Purchase ${purchaseId} refunded by admin ${adminId}`);
      return purchase;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getStats(): Promise<any> {
    const [totalProducts, activeProducts, totalPurchases, statusCounts, revenueAgg] =
      await Promise.all([
        this.productModel.countDocuments(),
        this.productModel.countDocuments({ status: ShopProductStatus.ACTIVE }),
        this.purchaseModel.countDocuments(),
        this.purchaseModel.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        this.purchaseModel.aggregate([
          { $match: { status: ShopPurchaseStatus.SUCCESS } },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$amountChargedNgn' },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

    const byBrand = await this.purchaseModel.aggregate([
      { $match: { status: ShopPurchaseStatus.SUCCESS } },
      {
        $group: {
          _id: '$brandName',
          count: { $sum: 1 },
          revenue: { $sum: '$amountChargedNgn' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]);

    const statusMap: Record<string, number> = {};
    statusCounts.forEach((s: any) => {
      statusMap[s._id] = s.count;
    });

    return {
      totalProducts,
      activeProducts,
      totalPurchases,
      successfulPurchases: statusMap[ShopPurchaseStatus.SUCCESS] || 0,
      failedPurchases: statusMap[ShopPurchaseStatus.FAILED] || 0,
      refundedPurchases: statusMap[ShopPurchaseStatus.REFUNDED] || 0,
      totalRevenueKobo: revenueAgg[0]?.totalRevenue || 0,
      byBrand: byBrand.map((b: any) => ({
        brandName: b._id,
        count: b.count,
        revenue: b.revenue,
      })),
    };
  }

  // ============================================
  // USER: BROWSE & PURCHASE
  // ============================================

  async getAvailableProducts(query: ShopProductQueryDto): Promise<PaginatedResult<GiftCardShopProduct>> {
    const { page = 1, limit = 10, brandName, countryCode, search, isFeatured } = query;
    const skip = calculateSkip(page, limit);

    const filter: any = {
      status: ShopProductStatus.ACTIVE,
      availableCodes: { $gt: 0 },
    };
    if (brandName) filter.brandName = { $regex: brandName, $options: 'i' };
    if (countryCode) filter.countryCode = countryCode.toUpperCase();
    if (isFeatured !== undefined) filter.isFeatured = isFeatured;
    if (search) {
      filter.$or = [
        { brandName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const projection = {
      costPriceNgn: 0,
      totalCodes: 0,
      meta: 0,
    };

    const [data, total] = await Promise.all([
      this.productModel.find(filter, projection).sort({ isFeatured: -1, sortOrder: 1, createdAt: -1 }).skip(skip).limit(limit),
      this.productModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  async getProductDetail(id: string): Promise<GiftCardShopProduct> {
    const product = await this.productModel.findOne(
      { _id: id, status: ShopProductStatus.ACTIVE },
      { costPriceNgn: 0, totalCodes: 0, meta: 0 },
    );
    if (!product) {
      throw new NotFoundException('Product not found or not available');
    }
    return product;
  }

  /**
   * Atomic purchase flow:
   * 1. Validate product is active with stock
   * 2. Claim one available code atomically
   * 3. Debit user wallet
   * 4. Create purchase record
   * 5. Update product counts
   * All within a single MongoDB transaction.
   */
  async purchaseCard(userId: string, dto: PurchaseShopCardDto): Promise<GiftCardShopPurchase> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      // 1. Validate product
      const product = await this.productModel.findById(dto.productId).session(session);
      if (!product) {
        throw new NotFoundException('Product not found');
      }
      if (product.status !== ShopProductStatus.ACTIVE) {
        throw new BadRequestException('Product is not available for purchase');
      }
      if (product.availableCodes <= 0) {
        throw new BadRequestException('Product is out of stock');
      }

      // 2. Claim one available code atomically
      const claimedCode = await this.codeModel.findOneAndUpdate(
        {
          productId: new Types.ObjectId(dto.productId),
          status: ShopCodeStatus.AVAILABLE,
        },
        {
          $set: {
            status: ShopCodeStatus.SOLD,
            purchasedBy: new Types.ObjectId(userId),
            purchasedAt: new Date(),
          },
        },
        { new: true, session },
      );

      if (!claimedCode) {
        throw new BadRequestException('No available codes — product is out of stock');
      }

      // 3. Debit user wallet
      const reference = generateReference('GCS');
      const walletTxn = await this.walletService.debitWallet({
        userId,
        amount: product.priceNgn,
        category: TransactionCategory.GIFTCARD_BUY,
        source: TransactionSource.GIFTCARD_SHOP,
        narration: `Purchase: ${product.brandName} ${product.denominationValue} ${product.denominationCurrency} gift card`,
        reference,
        meta: { productId: product._id, brandName: product.brandName },
        session,
      });

      // 4. Create purchase record
      const purchase = new this.purchaseModel({
        userId: new Types.ObjectId(userId),
        productId: product._id,
        codeId: claimedCode._id,
        reference,
        brandName: product.brandName,
        denominationValue: product.denominationValue,
        denominationCurrency: product.denominationCurrency,
        amountChargedNgn: product.priceNgn,
        status: ShopPurchaseStatus.SUCCESS,
        cardCode: claimedCode.code,
        cardPin: claimedCode.pin,
        walletTransactionId: (walletTxn as any)._id,
      });
      await purchase.save({ session });

      // Link code to purchase
      claimedCode.purchaseId = purchase._id;
      await claimedCode.save({ session });

      // 5. Update product counts
      const updatedProduct = await this.productModel.findByIdAndUpdate(
        product._id,
        { $inc: { availableCodes: -1, soldCount: 1 } },
        { new: true, session },
      );

      // Auto-set OUT_OF_STOCK if no codes left
      if (updatedProduct && updatedProduct.availableCodes <= 0) {
        await this.productModel.findByIdAndUpdate(
          product._id,
          { status: ShopProductStatus.OUT_OF_STOCK },
          { session },
        );
      }

      await session.commitTransaction();

      this.logger.log(
        `Gift card purchased: user=${userId}, product=${product._id}, ref=${reference}, amount=${product.priceNgn}`,
      );

      // Send notification (async, outside transaction)
      this.notificationsService
        .sendToUser(
          userId,
          'Gift Card Purchased',
          `Your ${product.brandName} ${product.denominationValue} ${product.denominationCurrency} gift card is ready!`,
          { purchaseId: String(purchase._id), reference },
        )
        .catch((err) => this.logger.debug(`Notification error: ${err.message}`));

      return purchase;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async getUserPurchases(userId: string, query: UserShopPurchaseQueryDto): Promise<PaginatedResult<GiftCardShopPurchase>> {
    const { page = 1, limit = 10, status } = query;
    const skip = calculateSkip(page, limit);

    const filter: any = { userId: new Types.ObjectId(userId) };
    if (status) filter.status = status;

    const [data, total] = await Promise.all([
      this.purchaseModel
        .find(filter)
        .populate('productId', 'brandName denominationValue denominationCurrency images slug')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.purchaseModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  async getUserPurchaseById(userId: string, purchaseId: string): Promise<GiftCardShopPurchase> {
    const purchase = await this.purchaseModel
      .findOne({
        _id: purchaseId,
        userId: new Types.ObjectId(userId),
      })
      .populate('productId', 'brandName denominationValue denominationCurrency images slug redeemInstructions');

    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }
    return purchase;
  }
}
