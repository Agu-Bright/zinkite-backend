/**
 * Gift Card Buy Service
 *
 * Core business logic for gift card buying:
 * - Product sync (cron + manual)
 * - Price calculation with markup cascade
 * - Purchase flow (debit wallet → Reloadly order → redeem codes)
 * - Admin: order management, markup CRUD, stats
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import {
  ReloadlyProduct,
  ReloadlyProductDocument,
  DenominationType,
} from './schemas/reloadly-product.schema';
import {
  GiftCardBuyOrder,
  GiftCardBuyOrderDocument,
  BuyOrderStatus,
} from './schemas/giftcard-buy-order.schema';
import {
  GiftCardBuyMarkup,
  GiftCardBuyMarkupDocument,
  MarkupLevel,
} from './schemas/giftcard-buy-markup.schema';
import {
  GiftCardBuyConfig,
  GiftCardBuyConfigDocument,
} from './schemas/giftcard-buy-config.schema';
import { ConfigService } from '@nestjs/config';
import { ReloadlyService } from './reloadly.service';
import { WalletService } from '../wallet/wallet.service';
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
  PurchaseGiftCardDto,
  AdminProductsQueryDto,
  AdminOrdersQueryDto,
  UpsertMarkupDto,
  ProductsQueryDto,
  UserOrdersQueryDto,
} from './dto';

export interface PricePreview {
  reloadlyCostNgn: number;
  reloadlyDiscount: number;
  markupPercentage: number;
  markupAmount: number;
  totalPrice: number;
  profit: number;
  recipientCurrencyCode: string;
  unitPrice: number;
}

// Countries enabled for sync
const ENABLED_COUNTRIES = ['NG', 'US'];

@Injectable()
export class GiftCardBuyService {
  private readonly logger = new Logger(GiftCardBuyService.name);

  constructor(
    @InjectModel(ReloadlyProduct.name)
    private readonly productModel: Model<ReloadlyProductDocument>,
    @InjectModel(GiftCardBuyOrder.name)
    private readonly orderModel: Model<GiftCardBuyOrderDocument>,
    @InjectModel(GiftCardBuyMarkup.name)
    private readonly markupModel: Model<GiftCardBuyMarkupDocument>,
    @InjectModel(GiftCardBuyConfig.name)
    private readonly configModel: Model<GiftCardBuyConfigDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly configService: ConfigService,
    private readonly reloadlyService: ReloadlyService,
    private readonly walletService: WalletService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // EXCHANGE RATE CONFIG
  // ═══════════════════════════════════════════════════════════

  /**
   * Get current USD→NGN exchange rate
   * Priority: DB config > env var > default 1600
   */
  async getExchangeRate(): Promise<number> {
    const config = await this.configModel.findOne({ key: 'USD_NGN_RATE' }).lean();
    if (config) return config.value;

    const envRate = this.configService.get<number>('RELOADLY_USD_NGN_RATE');
    if (envRate) return Number(envRate);

    this.logger.warn('No USD_NGN_RATE configured! Using default 1600.');
    return 1600;
  }

  /**
   * Update USD→NGN exchange rate (admin)
   */
  async updateExchangeRate(rate: number, adminId: string): Promise<GiftCardBuyConfigDocument> {
    const config = await this.configModel.findOneAndUpdate(
      { key: 'USD_NGN_RATE' },
      {
        key: 'USD_NGN_RATE',
        value: rate,
        updatedBy: new Types.ObjectId(adminId),
      },
      { upsert: true, new: true },
    );
    this.logger.log(`Exchange rate updated to ${rate} by admin ${adminId}`);
    return config;
  }

  /**
   * Get all config entries
   */
  async getConfig(): Promise<GiftCardBuyConfigDocument[]> {
    return this.configModel.find().lean() as any;
  }

  // ═══════════════════════════════════════════════════════════
  // PRODUCT SYNC
  // ═══════════════════════════════════════════════════════════

  /**
   * Cron: sync products every 6 hours
   */
  @Cron('0 */6 * * *')
  async syncAllProducts(): Promise<{ synced: number; errors: number }> {
    this.logger.log('Starting scheduled product sync...');
    let totalSynced = 0;
    let totalErrors = 0;

    for (const countryCode of ENABLED_COUNTRIES) {
      try {
        const result = await this.syncProductsByCountry(countryCode);
        totalSynced += result.synced;
      } catch (error: any) {
        totalErrors++;
        this.logger.error(`Sync failed for ${countryCode}: ${error.message}`);
      }
    }

    this.logger.log(`Product sync complete: ${totalSynced} synced, ${totalErrors} errors`);
    return { synced: totalSynced, errors: totalErrors };
  }

  /**
   * Sync products for a specific country
   */
  async syncProductsByCountry(countryCode: string): Promise<{ synced: number }> {
    this.logger.log(`Syncing products for ${countryCode}...`);

    const products = await this.reloadlyService.getProductsByCountry(countryCode);
    let synced = 0;

    for (const product of products) {
      try {
        await this.productModel.findOneAndUpdate(
          { reloadlyProductId: product.productId },
          {
            reloadlyProductId: product.productId,
            productName: product.productName,
            brandId: product.brand.brandId,
            brandName: product.brand.brandName,
            countryCode: product.country.isoName,
            countryName: product.country.name,
            countryFlagUrl: product.country.flagUrl || '',
            denominationType: product.denominationType as DenominationType,
            recipientCurrencyCode: product.recipientCurrencyCode,
            senderCurrencyCode: product.senderCurrencyCode,
            senderFee: product.senderFee || 0,
            discountPercentage: product.discountPercentage || 0,
            minRecipientDenomination: product.minRecipientDenomination,
            maxRecipientDenomination: product.maxRecipientDenomination,
            fixedRecipientDenominations: product.fixedRecipientDenominations || [],
            fixedSenderDenominations: product.fixedSenderDenominations || [],
            fixedRecipientToSenderDenominationsMap:
              product.fixedRecipientToSenderDenominationsMap || {},
            logoUrls: product.logoUrls || [],
            redeemInstructionConcise: product.redeemInstruction?.concise || '',
            redeemInstructionVerbose: product.redeemInstruction?.verbose || '',
            lastSyncedAt: new Date(),
          },
          { upsert: true, new: true },
        );
        synced++;
      } catch (error: any) {
        this.logger.warn(
          `Failed to upsert product ${product.productId}: ${error.message}`,
        );
      }
    }

    this.logger.log(`Synced ${synced}/${products.length} products for ${countryCode}`);
    return { synced };
  }

  // ═══════════════════════════════════════════════════════════
  // PRODUCTS (User-facing)
  // ═══════════════════════════════════════════════════════════

  /**
   * List enabled products for users
   */
  async getEnabledProducts(
    query: ProductsQueryDto,
  ): Promise<PaginatedResult<ReloadlyProduct>> {
    const { page = 1, limit = 20, countryCode, brandName, search } = query;

    const filter: any = { isEnabled: true };
    if (countryCode) filter.countryCode = countryCode.toUpperCase();
    if (brandName) filter.brandName = { $regex: brandName, $options: 'i' };
    if (search) {
      filter.$or = [
        { productName: { $regex: search, $options: 'i' } },
        { brandName: { $regex: search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.productModel
        .find(filter)
        .sort({ brandName: 1, productName: 1 })
        .skip(calculateSkip(page, limit))
        .limit(limit)
        .lean(),
      this.productModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  /**
   * Get product by DB ID
   */
  async getProductById(id: string): Promise<ReloadlyProductDocument> {
    const product = await this.productModel.findById(id).lean();
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product as any;
  }

  /**
   * Get supported countries
   */
  getCountries() {
    return ENABLED_COUNTRIES.map((code) => ({
      code,
      name: code === 'NG' ? 'Nigeria' : code === 'US' ? 'United States' : code,
      flagUrl:
        code === 'NG'
          ? 'https://flagcdn.com/ng.svg'
          : code === 'US'
            ? 'https://flagcdn.com/us.svg'
            : '',
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // PRICING
  // ═══════════════════════════════════════════════════════════

  /**
   * Get applicable markup percentage using cascade: BRAND > COUNTRY > GLOBAL
   */
  async getApplicableMarkup(
    brandName: string,
    countryCode: string,
  ): Promise<number> {
    // 1. Brand-level markup
    const brandMarkup = await this.markupModel.findOne({
      level: MarkupLevel.BRAND,
      brandName,
      isActive: true,
    });
    if (brandMarkup) return brandMarkup.markupPercentage;

    // 2. Country-level markup
    const countryMarkup = await this.markupModel.findOne({
      level: MarkupLevel.COUNTRY,
      countryCode: countryCode.toUpperCase(),
      isActive: true,
    });
    if (countryMarkup) return countryMarkup.markupPercentage;

    // 3. Global markup (fallback)
    const globalMarkup = await this.markupModel.findOne({
      level: MarkupLevel.GLOBAL,
      isActive: true,
    });
    if (globalMarkup) return globalMarkup.markupPercentage;

    // No markup configured — default to 0
    this.logger.warn('No markup configured! Using 0% markup.');
    return 0;
  }

  /**
   * Calculate price preview for a product + unitPrice
   */
  async calculatePrice(
    productId: string,
    unitPrice: number,
  ): Promise<PricePreview> {
    const product = await this.getProductById(productId);

    // Validate unitPrice against denomination type
    if (product.denominationType === DenominationType.FIXED) {
      const validDenominations = product.fixedRecipientDenominations;
      if (!validDenominations.includes(unitPrice)) {
        throw new BadRequestException(
          `Invalid denomination. Available: ${validDenominations.join(', ')}`,
        );
      }
    } else {
      // RANGE type
      if (
        product.minRecipientDenomination !== null &&
        unitPrice < product.minRecipientDenomination
      ) {
        throw new BadRequestException(
          `Minimum amount is ${product.minRecipientDenomination} ${product.recipientCurrencyCode}`,
        );
      }
      if (
        product.maxRecipientDenomination !== null &&
        unitPrice > product.maxRecipientDenomination
      ) {
        throw new BadRequestException(
          `Maximum amount is ${product.maxRecipientDenomination} ${product.recipientCurrencyCode}`,
        );
      }
    }

    // Get Reloadly cost in NGN
    let reloadlyCostNgn: number;

    if (product.denominationType === DenominationType.FIXED) {
      const mapKey = unitPrice.toFixed(2);
      const cost = product.fixedRecipientToSenderDenominationsMap[mapKey];
      if (cost != null) {
        reloadlyCostNgn = cost;
      } else {
        // Try without decimal
        const altKey = String(unitPrice);
        const altCost = product.fixedRecipientToSenderDenominationsMap[altKey];
        if (altCost != null) {
          reloadlyCostNgn = altCost;
        } else if (product.senderCurrencyCode === product.recipientCurrencyCode) {
          // Same currency (e.g. NGN→NGN) — sender cost equals recipient denomination
          reloadlyCostNgn = unitPrice;
        } else {
          throw new BadRequestException(
            `Price not available for ${unitPrice} ${product.recipientCurrencyCode}`,
          );
        }
      }
    } else {
      // RANGE: proportional calculation from sender denominations
      // Use ratio: unitPrice / maxRecipientDenomination * maxSenderDenomination
      if (
        product.fixedSenderDenominations.length >= 2 &&
        product.minRecipientDenomination &&
        product.maxRecipientDenomination
      ) {
        const minSender = product.fixedSenderDenominations[0];
        const maxSender =
          product.fixedSenderDenominations[product.fixedSenderDenominations.length - 1];
        const range =
          product.maxRecipientDenomination - product.minRecipientDenomination;
        const ratio =
          (unitPrice - product.minRecipientDenomination) / (range || 1);
        reloadlyCostNgn = minSender + ratio * (maxSender - minSender);
      } else {
        // Fallback: estimate using senderFee if available
        // For RANGE products, the sender amount is roughly proportional
        reloadlyCostNgn = unitPrice * (product.senderFee || 1);
      }
      reloadlyCostNgn += product.senderFee || 0;
    }

    // Convert to NGN if sender currency is not NGN
    if (product.senderCurrencyCode !== 'NGN') {
      const exchangeRate = await this.getExchangeRate();
      reloadlyCostNgn = reloadlyCostNgn * exchangeRate;
    }

    // Calculate discount
    const discountNgn = reloadlyCostNgn * (product.discountPercentage / 100);

    // Get markup
    const markupPercentage = await this.getApplicableMarkup(
      product.brandName,
      product.countryCode,
    );
    const markupAmount = reloadlyCostNgn * (markupPercentage / 100);
    const totalPrice = reloadlyCostNgn + markupAmount;
    const profit = discountNgn + markupAmount;

    return {
      reloadlyCostNgn: Math.round(reloadlyCostNgn * 100) / 100,
      reloadlyDiscount: Math.round(discountNgn * 100) / 100,
      markupPercentage,
      markupAmount: Math.round(markupAmount * 100) / 100,
      totalPrice: Math.round(totalPrice * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      recipientCurrencyCode: product.recipientCurrencyCode,
      unitPrice,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PURCHASE FLOW
  // ═══════════════════════════════════════════════════════════

  /**
   * Purchase a gift card — follows VTU pattern:
   * 1. Validate product
   * 2. Calculate price
   * 3. Start transaction
   * 4. Debit wallet
   * 5. Call Reloadly
   * 6. Fetch redeem codes
   * 7. Commit or abort
   */
  async purchaseGiftCard(
    userId: string,
    dto: PurchaseGiftCardDto,
  ): Promise<GiftCardBuyOrderDocument> {
    const product = await this.getProductById(dto.productId);

    if (!product.isEnabled) {
      throw new BadRequestException('This product is currently unavailable');
    }

    const quantity = dto.quantity || 1;
    const pricePreview = await this.calculatePrice(dto.productId, dto.unitPrice);
    const totalPriceNgn = pricePreview.totalPrice * quantity;
    const totalChargedKobo = toKobo(totalPriceNgn);
    const reference = generateReference('GCB');

    // ═══════════════════════════════════════════════════════════
    // PHASE 1 — Atomic DB txn: create order (PENDING) + debit wallet
    //
    // IMPORTANT: do NOT call external APIs (Reloadly) from inside a
    // MongoDB transaction. The txn can time out (default 60s) or fail
    // to commit after Reloadly has already placed the order — classic
    // dual-write bug where the user pays $0 and we pay Reloadly.
    // ═══════════════════════════════════════════════════════════
    const session = await this.connection.startSession();
    let orderDoc: GiftCardBuyOrderDocument | null = null;

    try {
      session.startTransaction();

      const [created] = await this.orderModel.create(
        [
          {
            userId: new Types.ObjectId(userId),
            reference,
            reloadlyProductId: product.reloadlyProductId,
            productName: product.productName,
            brandName: product.brandName,
            countryCode: product.countryCode,
            denominationType: product.denominationType,
            unitPrice: dto.unitPrice,
            recipientCurrencyCode: product.recipientCurrencyCode,
            quantity,
            reloadlyCostNgn: toKobo(pricePreview.reloadlyCostNgn * quantity),
            reloadlyDiscount: toKobo(pricePreview.reloadlyDiscount * quantity),
            markupPercentage: pricePreview.markupPercentage,
            markupAmountNgn: toKobo(pricePreview.markupAmount * quantity),
            totalChargedNgn: totalChargedKobo,
            profitNgn: toKobo(pricePreview.profit * quantity),
            redeemInstructionConcise: product.redeemInstructionConcise || null,
            redeemInstructionVerbose: product.redeemInstructionVerbose || null,
            status: BuyOrderStatus.PENDING,
          },
        ],
        { session },
      );
      orderDoc = created;

      const walletTxn = await this.walletService.debitWallet({
        userId,
        amount: totalChargedKobo,
        category: TransactionCategory.GIFTCARD_BUY,
        source: TransactionSource.GIFTCARD_RELOADLY,
        reference,
        narration: `Gift Card: ${product.brandName} ${product.productName} - ${dto.unitPrice} ${product.recipientCurrencyCode}`,
        meta: {
          orderId: orderDoc._id.toString(),
          productName: product.productName,
          brandName: product.brandName,
          unitPrice: dto.unitPrice,
          quantity,
          recipientCurrency: product.recipientCurrencyCode,
        },
        session,
      });

      orderDoc.walletTransactionId = (walletTxn as any)._id;
      orderDoc.status = BuyOrderStatus.PROCESSING;
      await orderDoc.save({ session });

      await session.commitTransaction();
    } catch (error: any) {
      await session.abortTransaction();
      this.logger.error(`Phase 1 failed (wallet debit / order create): ${reference}`, error);
      if (error.status) throw error;
      throw new InternalServerErrorException(
        'Gift card purchase failed. Your wallet was not charged.',
      );
    } finally {
      session.endSession();
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 2 — External Reloadly call (no DB txn).
    //
    // `customIdentifier: reference` makes Reloadly calls idempotent
    // on their side — retries with the same reference return the
    // same order rather than creating a duplicate.
    //
    // On success: update order with Reloadly details + redeem codes.
    // On failure: mark order FAILED + refund wallet via a separate
    // credit transaction (reference `${reference}-REFUND`).
    // ═══════════════════════════════════════════════════════════
    if (!orderDoc) {
      // Unreachable: phase 1 either assigns orderDoc or throws.
      throw new InternalServerErrorException('Order state lost after phase 1');
    }
    const order = orderDoc; // narrowed, no longer nullable

    try {
      const reloadlyOrder = await this.reloadlyService.orderGiftCard({
        productId: product.reloadlyProductId,
        countryCode: product.countryCode,
        quantity,
        unitPrice: dto.unitPrice,
        customIdentifier: reference,
      });

      order.reloadlyTransactionId = reloadlyOrder.transactionId;
      order.reloadlyStatus = reloadlyOrder.status;

      // Fetch redeem codes (store ALL for multi-quantity orders)
      try {
        const codes = await this.reloadlyService.getRedeemCodes(
          reloadlyOrder.transactionId,
        );
        if (codes && codes.length > 0) {
          order.redeemCodes = codes.map((c) => ({
            cardNumber: c.cardNumber || null,
            pinCode: c.pinCode || null,
          }));
          // Backward compat: first code in top-level fields
          order.cardNumber = codes[0].cardNumber || null;
          order.pinCode = codes[0].pinCode || null;
        }
      } catch (codeError: any) {
        this.logger.warn(
          `Failed to fetch redeem codes for ${reference}: ${codeError.message}. Will retry later.`,
        );
        order.meta = {
          ...order.meta,
          redeemCodeFetchFailed: true,
          redeemCodeError: codeError.message,
        };
      }

      order.status = BuyOrderStatus.SUCCESS;
      await order.save();

      this.logger.log(`Gift card purchased: ${reference} — ${product.brandName} $${dto.unitPrice}`);
      return order;
    } catch (error: any) {
      this.logger.error(
        `Phase 2 failed (Reloadly call): ${reference} — refunding wallet`,
        error,
      );

      // Mark order failed
      order.status = BuyOrderStatus.FAILED;
      order.failureReason = error.message || 'Reloadly order failed';
      try {
        await order.save();
      } catch (saveErr: any) {
        this.logger.error(
          `Failed to mark order FAILED: ${reference} — ${saveErr.message}`,
        );
      }

      // Refund the user's wallet via a separate credit transaction.
      // Use a distinct reference so the unique index doesn't collide
      // with the original debit and so the refund is queryable.
      try {
        await this.walletService.creditWallet({
          userId,
          amount: totalChargedKobo,
          category: TransactionCategory.REFUND,
          source: TransactionSource.GIFTCARD_RELOADLY,
          reference: `${reference}-REFUND`,
          narration: `Refund: failed gift card purchase (${product.brandName} ${product.productName})`,
          meta: {
            orderId: order._id.toString(),
            originalReference: reference,
            reason: error.message || 'Reloadly order failed',
          },
        });
        this.logger.log(`Refunded ${totalChargedKobo} kobo for failed order: ${reference}`);
      } catch (refundErr: any) {
        // CRITICAL: wallet was debited but refund failed. This requires
        // manual reconciliation — log loudly so ops can address it.
        this.logger.error(
          `CRITICAL: refund failed for ${reference} — user ${userId} ` +
            `was debited ${totalChargedKobo} kobo with no refund. ` +
            `Error: ${refundErr.message}. MANUAL RECONCILIATION REQUIRED.`,
          refundErr.stack,
        );
      }

      if (error.status) throw error;
      throw new InternalServerErrorException(
        'Gift card purchase failed. Your wallet has been refunded.',
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // RETRY REDEEM CODES
  // ═══════════════════════════════════════════════════════════

  /**
   * Retry fetching redeem codes from Reloadly for a completed order.
   * Can be called by the user (with userId check) or admin (without userId).
   */
  async retryRedeemCodes(
    orderId: string,
    userId?: string,
  ): Promise<GiftCardBuyOrderDocument> {
    const filter: any = { _id: new Types.ObjectId(orderId) };
    if (userId) filter.userId = new Types.ObjectId(userId);

    const order = await this.orderModel.findOne(filter);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== BuyOrderStatus.SUCCESS) {
      throw new BadRequestException('Can only retry codes for successful orders');
    }

    if (!order.reloadlyTransactionId) {
      throw new BadRequestException('Order has no Reloadly transaction ID');
    }

    const codes = await this.reloadlyService.getRedeemCodes(
      order.reloadlyTransactionId,
    );

    if (!codes || codes.length === 0) {
      throw new BadRequestException(
        'No redeem codes returned from Reloadly. Please try again later.',
      );
    }

    order.redeemCodes = codes.map((c) => ({
      cardNumber: c.cardNumber || null,
      pinCode: c.pinCode || null,
    }));
    order.cardNumber = codes[0].cardNumber || null;
    order.pinCode = codes[0].pinCode || null;

    // Clear the failed flag
    if (order.meta?.redeemCodeFetchFailed) {
      const { redeemCodeFetchFailed, redeemCodeError, ...restMeta } = order.meta;
      order.meta = restMeta;
      order.markModified('meta');
    }

    await order.save();
    this.logger.log(`Redeem codes retried for order ${order.reference}`);

    return order;
  }

  // ═══════════════════════════════════════════════════════════
  // USER ORDERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Get user's buy orders
   */
  async getUserOrders(
    userId: string,
    query: UserOrdersQueryDto,
  ): Promise<PaginatedResult<GiftCardBuyOrder>> {
    const { page = 1, limit = 10, status } = query;

    const filter: any = { userId: new Types.ObjectId(userId) };
    if (status) filter.status = status;

    const [data, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(calculateSkip(page, limit))
        .limit(limit)
        .lean(),
      this.orderModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  /**
   * Get user's order by ID (with redeem codes)
   */
  async getUserOrderById(
    orderId: string,
    userId: string,
  ): Promise<GiftCardBuyOrderDocument> {
    const order = await this.orderModel
      .findOne({
        _id: new Types.ObjectId(orderId),
        userId: new Types.ObjectId(userId),
      })
      .lean();

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order as any;
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN: PRODUCTS
  // ═══════════════════════════════════════════════════════════

  /**
   * Admin: list all products (including disabled)
   */
  async getAdminProducts(
    query: AdminProductsQueryDto,
  ): Promise<PaginatedResult<ReloadlyProduct>> {
    const { page = 1, limit = 20, countryCode, brandName, isEnabled, search } = query;

    const filter: any = {};
    if (countryCode) filter.countryCode = countryCode.toUpperCase();
    if (brandName) filter.brandName = { $regex: brandName, $options: 'i' };
    if (isEnabled !== undefined) filter.isEnabled = isEnabled;
    if (search) {
      filter.$or = [
        { productName: { $regex: search, $options: 'i' } },
        { brandName: { $regex: search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.productModel
        .find(filter)
        .sort({ countryCode: 1, brandName: 1, productName: 1 })
        .skip(calculateSkip(page, limit))
        .limit(limit)
        .lean(),
      this.productModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  /**
   * Admin: toggle product enabled/disabled
   */
  async toggleProduct(
    productId: string,
    isEnabled: boolean,
  ): Promise<ReloadlyProductDocument> {
    const product = await this.productModel.findByIdAndUpdate(
      productId,
      { isEnabled },
      { new: true },
    );
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN: MARKUPS
  // ═══════════════════════════════════════════════════════════

  /**
   * Admin: list all markups
   */
  async getMarkups(): Promise<GiftCardBuyMarkupDocument[]> {
    return this.markupModel.find().sort({ level: 1, brandName: 1, countryCode: 1 }).lean() as any;
  }

  /**
   * Admin: create or update a markup
   */
  async upsertMarkup(
    dto: UpsertMarkupDto,
    adminId: string,
  ): Promise<GiftCardBuyMarkupDocument> {
    // Validate level-specific fields
    if (dto.level === MarkupLevel.COUNTRY && !dto.countryCode) {
      throw new BadRequestException('Country code is required for COUNTRY level markup');
    }
    if (dto.level === MarkupLevel.BRAND && !dto.brandName) {
      throw new BadRequestException('Brand name is required for BRAND level markup');
    }

    const filter: any = { level: dto.level };
    if (dto.level === MarkupLevel.COUNTRY) {
      filter.countryCode = dto.countryCode?.toUpperCase();
      filter.brandName = null;
    } else if (dto.level === MarkupLevel.BRAND) {
      filter.brandName = dto.brandName;
      filter.countryCode = null;
    } else {
      filter.countryCode = null;
      filter.brandName = null;
    }

    const markup = await this.markupModel.findOneAndUpdate(
      filter,
      {
        ...filter,
        markupPercentage: dto.markupPercentage,
        isActive: true,
        updatedBy: new Types.ObjectId(adminId),
      },
      { upsert: true, new: true },
    );

    return markup;
  }

  /**
   * Admin: delete a markup
   */
  async deleteMarkup(id: string): Promise<void> {
    const result = await this.markupModel.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundException('Markup not found');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN: ORDERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Admin: list all orders
   */
  async getAdminOrders(
    query: AdminOrdersQueryDto,
  ): Promise<PaginatedResult<GiftCardBuyOrder>> {
    const { page = 1, limit = 20, status, countryCode, brandName, userId, search } = query;

    const filter: any = {};
    if (status) filter.status = status;
    if (countryCode) filter.countryCode = countryCode.toUpperCase();
    if (brandName) filter.brandName = { $regex: brandName, $options: 'i' };
    if (userId) filter.userId = new Types.ObjectId(userId);
    if (search) {
      filter.$or = [
        { reference: { $regex: search, $options: 'i' } },
        { productName: { $regex: search, $options: 'i' } },
        { brandName: { $regex: search, $options: 'i' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(calculateSkip(page, limit))
        .limit(limit)
        .populate('userId', 'email fullName phone')
        .lean(),
      this.orderModel.countDocuments(filter),
    ]);

    return paginate(data, total, page, limit);
  }

  /**
   * Admin: get order detail
   */
  async getAdminOrderById(orderId: string): Promise<GiftCardBuyOrderDocument> {
    const order = await this.orderModel
      .findById(orderId)
      .populate('userId', 'email fullName phone')
      .lean();

    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order as any;
  }

  /**
   * Admin: manual refund for a completed order
   */
  async refundOrder(
    orderId: string,
    adminId: string,
    reason?: string,
  ): Promise<GiftCardBuyOrderDocument> {
    const order = await this.orderModel.findById(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status === BuyOrderStatus.REFUNDED) {
      throw new BadRequestException('Order already refunded');
    }

    if (order.status !== BuyOrderStatus.SUCCESS && order.status !== BuyOrderStatus.FAILED) {
      throw new BadRequestException('Only completed or failed orders can be refunded');
    }

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const refundTxn = await this.walletService.creditWallet({
        userId: order.userId.toString(),
        amount: order.totalChargedNgn,
        category: TransactionCategory.GIFTCARD_BUY,
        source: TransactionSource.GIFTCARD_RELOADLY,
        reference: `REFUND_${order.reference}`,
        narration: `Refund: Gift Card ${order.reference}`,
        meta: {
          originalReference: order.reference,
          refundReason: reason || 'Admin refund',
          adminId,
          orderId: order._id.toString(),
        },
        session,
      });

      order.status = BuyOrderStatus.REFUNDED;
      order.refundTransactionId = (refundTxn as any)._id;
      order.meta = {
        ...order.meta,
        refundReason: reason || 'Admin refund',
        refundedBy: adminId,
        refundedAt: new Date().toISOString(),
      };
      await order.save({ session });

      await session.commitTransaction();
      this.logger.log(`Order refunded: ${order.reference} by admin ${adminId}`);

      return order;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Admin: get buy order stats
   */
  async getStats(): Promise<{
    totalOrders: number;
    successOrders: number;
    failedOrders: number;
    totalRevenueKobo: number;
    totalProfitKobo: number;
    byCountry: Array<{ countryCode: string; count: number; revenue: number }>;
    byBrand: Array<{ brandName: string; count: number; revenue: number }>;
  }> {
    const [totalOrders, successOrders, failedOrders] = await Promise.all([
      this.orderModel.countDocuments(),
      this.orderModel.countDocuments({ status: BuyOrderStatus.SUCCESS }),
      this.orderModel.countDocuments({ status: BuyOrderStatus.FAILED }),
    ]);

    const revenueAgg = await this.orderModel.aggregate([
      { $match: { status: BuyOrderStatus.SUCCESS } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalChargedNgn' },
          totalProfit: { $sum: '$profitNgn' },
        },
      },
    ]);

    const byCountry = await this.orderModel.aggregate([
      { $match: { status: BuyOrderStatus.SUCCESS } },
      {
        $group: {
          _id: '$countryCode',
          count: { $sum: 1 },
          revenue: { $sum: '$totalChargedNgn' },
        },
      },
      { $project: { countryCode: '$_id', count: 1, revenue: 1, _id: 0 } },
      { $sort: { revenue: -1 } },
    ]);

    const byBrand = await this.orderModel.aggregate([
      { $match: { status: BuyOrderStatus.SUCCESS } },
      {
        $group: {
          _id: '$brandName',
          count: { $sum: 1 },
          revenue: { $sum: '$totalChargedNgn' },
        },
      },
      { $project: { brandName: '$_id', count: 1, revenue: 1, _id: 0 } },
      { $sort: { revenue: -1 } },
      { $limit: 20 },
    ]);

    return {
      totalOrders,
      successOrders,
      failedOrders,
      totalRevenueKobo: revenueAgg[0]?.totalRevenue || 0,
      totalProfitKobo: revenueAgg[0]?.totalProfit || 0,
      byCountry,
      byBrand,
    };
  }
}
