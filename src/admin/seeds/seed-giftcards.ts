/**
 * Seed Script — Gift Card Brands, Categories, Rates & Shop Products
 *
 * Seeds realistic test data for the gift card sell flow and shop.
 * Uses real brand names and realistic rates.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GiftCardBrand,
  GiftCardBrandDocument,
  BrandStatus,
} from '../../giftcards/schemas/gift-card-brand.schema';
import {
  GiftCardCategory,
  GiftCardCategoryDocument,
  CategoryStatus,
  CardType,
} from '../../giftcards/schemas/gift-card-category.schema';
import {
  GiftCardRate,
  GiftCardRateDocument,
  RateStatus,
} from '../../giftcards/schemas/gift-card-rate.schema';
import {
  GiftCardShopProduct,
  GiftCardShopProductDocument,
  ShopProductStatus,
} from '../../giftcard-shop/schemas/giftcard-shop-product.schema';
import {
  GiftCardShopCode,
  GiftCardShopCodeDocument,
  ShopCodeStatus,
} from '../../giftcard-shop/schemas/giftcard-shop-code.schema';

// ─── Brand logos (public CDN URLs) ───────────────────────
const LOGOS = {
  itunes: 'https://www.google.com/s2/favicons?domain=apple.com&sz=128',
  amazon: 'https://www.google.com/s2/favicons?domain=amazon.com&sz=128',
  steam: 'https://www.google.com/s2/favicons?domain=steampowered.com&sz=128',
  google: 'https://www.google.com/s2/favicons?domain=play.google.com&sz=128',
  xbox: 'https://www.google.com/s2/favicons?domain=xbox.com&sz=128',
  playstation: 'https://www.google.com/s2/favicons?domain=playstation.com&sz=128',
  visa: 'https://www.google.com/s2/favicons?domain=visa.com&sz=128',
  ebay: 'https://www.google.com/s2/favicons?domain=ebay.com&sz=128',
  nike: 'https://www.google.com/s2/favicons?domain=nike.com&sz=128',
  sephora: 'https://www.google.com/s2/favicons?domain=sephora.com&sz=128',
};

// ─── Sell Flow: Brands + Categories + Rates ──────────────
const SELL_BRANDS = [
  {
    name: 'iTunes',
    slug: 'itunes',
    logoUrl: LOGOS.itunes,
    description: 'Apple iTunes & App Store gift cards',
    isFeatured: true,
    sortOrder: 1,
    categories: [
      {
        name: 'iTunes US Physical',
        slug: 'itunes-us-physical',
        cardType: CardType.PHYSICAL,
        country: 'US',
        minValue: 25,
        maxValue: 500,
        rates: [
          { minValue: 25, maxValue: 100, rate: 620 },
          { minValue: 101, maxValue: 200, rate: 600 },
          { minValue: 201, maxValue: 500, rate: 580 },
        ],
      },
      {
        name: 'iTunes US E-Code',
        slug: 'itunes-us-ecode',
        cardType: CardType.ECODE,
        country: 'US',
        minValue: 10,
        maxValue: 200,
        rates: [
          { minValue: 10, maxValue: 50, rate: 600 },
          { minValue: 51, maxValue: 200, rate: 580 },
        ],
      },
      {
        name: 'iTunes UK Physical',
        slug: 'itunes-uk-physical',
        cardType: CardType.PHYSICAL,
        country: 'UK',
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 570 },
          { minValue: 101, maxValue: 200, rate: 540 },
        ],
      },
    ],
  },
  {
    name: 'Amazon',
    slug: 'amazon',
    logoUrl: LOGOS.amazon,
    description: 'Amazon gift cards for shopping',
    isFeatured: true,
    sortOrder: 2,
    categories: [
      {
        name: 'Amazon US Physical',
        slug: 'amazon-us-physical',
        cardType: CardType.PHYSICAL,
        country: 'US',
        minValue: 25,
        maxValue: 500,
        rates: [
          { minValue: 25, maxValue: 100, rate: 580 },
          { minValue: 101, maxValue: 500, rate: 560 },
        ],
      },
      {
        name: 'Amazon US E-Code',
        slug: 'amazon-us-ecode',
        cardType: CardType.ECODE,
        country: 'US',
        minValue: 10,
        maxValue: 200,
        rates: [
          { minValue: 10, maxValue: 200, rate: 560 },
        ],
      },
      {
        name: 'Amazon UK E-Code',
        slug: 'amazon-uk-ecode',
        cardType: CardType.ECODE,
        country: 'UK',
        minValue: 10,
        maxValue: 100,
        rates: [
          { minValue: 10, maxValue: 50, rate: 530 },
          { minValue: 51, maxValue: 100, rate: 510 },
        ],
      },
    ],
  },
  {
    name: 'Steam',
    slug: 'steam',
    logoUrl: LOGOS.steam,
    description: 'Steam Wallet gift cards for gaming',
    isFeatured: true,
    sortOrder: 3,
    categories: [
      {
        name: 'Steam US Physical',
        slug: 'steam-us-physical',
        cardType: CardType.PHYSICAL,
        country: 'US',
        minValue: 20,
        maxValue: 100,
        rates: [
          { minValue: 20, maxValue: 50, rate: 560 },
          { minValue: 51, maxValue: 100, rate: 540 },
        ],
      },
      {
        name: 'Steam US E-Code',
        slug: 'steam-us-ecode',
        cardType: CardType.ECODE,
        country: 'US',
        minValue: 10,
        maxValue: 100,
        rates: [
          { minValue: 10, maxValue: 50, rate: 540 },
          { minValue: 51, maxValue: 100, rate: 520 },
        ],
      },
      {
        name: 'Steam UK Physical',
        slug: 'steam-uk-physical',
        cardType: CardType.PHYSICAL,
        country: 'UK',
        minValue: 25,
        maxValue: 100,
        rates: [
          { minValue: 25, maxValue: 50, rate: 520 },
          { minValue: 51, maxValue: 100, rate: 500 },
        ],
      },
    ],
  },
  {
    name: 'Google Play',
    slug: 'google-play',
    logoUrl: LOGOS.google,
    description: 'Google Play Store gift cards',
    isFeatured: true,
    sortOrder: 4,
    categories: [
      {
        name: 'Google Play US Physical',
        slug: 'google-play-us-physical',
        cardType: CardType.PHYSICAL,
        country: 'US',
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 200, rate: 540 },
        ],
      },
      {
        name: 'Google Play US E-Code',
        slug: 'google-play-us-ecode',
        cardType: CardType.ECODE,
        country: 'US',
        minValue: 10,
        maxValue: 100,
        rates: [
          { minValue: 10, maxValue: 50, rate: 530 },
          { minValue: 51, maxValue: 100, rate: 510 },
        ],
      },
      {
        name: 'Google Play UK Physical',
        slug: 'google-play-uk-physical',
        cardType: CardType.PHYSICAL,
        country: 'UK',
        minValue: 25,
        maxValue: 100,
        rates: [
          { minValue: 25, maxValue: 50, rate: 500 },
          { minValue: 51, maxValue: 100, rate: 480 },
        ],
      },
    ],
  },
  {
    name: 'Xbox',
    slug: 'xbox',
    logoUrl: LOGOS.xbox,
    description: 'Xbox gift cards for gaming and subscriptions',
    isFeatured: false,
    sortOrder: 5,
    categories: [
      {
        name: 'Xbox US Physical',
        slug: 'xbox-us-physical',
        cardType: CardType.PHYSICAL,
        country: 'US',
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 510 },
          { minValue: 101, maxValue: 200, rate: 490 },
        ],
      },
      {
        name: 'Xbox US E-Code',
        slug: 'xbox-us-ecode',
        cardType: CardType.ECODE,
        country: 'US',
        minValue: 10,
        maxValue: 100,
        rates: [
          { minValue: 10, maxValue: 50, rate: 500 },
          { minValue: 51, maxValue: 100, rate: 480 },
        ],
      },
      {
        name: 'Xbox UK Physical',
        slug: 'xbox-uk-physical',
        cardType: CardType.PHYSICAL,
        country: 'UK',
        minValue: 25,
        maxValue: 100,
        rates: [
          { minValue: 25, maxValue: 50, rate: 490 },
          { minValue: 51, maxValue: 100, rate: 470 },
        ],
      },
    ],
  },
  {
    name: 'PlayStation',
    slug: 'playstation',
    logoUrl: LOGOS.playstation,
    description: 'PlayStation Store gift cards',
    isFeatured: false,
    sortOrder: 6,
    categories: [
      {
        name: 'PlayStation US Physical',
        slug: 'playstation-us-physical',
        cardType: CardType.PHYSICAL,
        country: 'US',
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 500 },
          { minValue: 101, maxValue: 200, rate: 480 },
        ],
      },
      {
        name: 'PlayStation US E-Code',
        slug: 'playstation-us-ecode',
        cardType: CardType.ECODE,
        country: 'US',
        minValue: 10,
        maxValue: 100,
        rates: [
          { minValue: 10, maxValue: 50, rate: 490 },
          { minValue: 51, maxValue: 100, rate: 470 },
        ],
      },
      {
        name: 'PlayStation EU Physical',
        slug: 'playstation-eu-physical',
        cardType: CardType.PHYSICAL,
        country: 'EU',
        minValue: 25,
        maxValue: 100,
        rates: [
          { minValue: 25, maxValue: 50, rate: 480 },
          { minValue: 51, maxValue: 100, rate: 460 },
        ],
      },
    ],
  },
  {
    name: 'Visa Gift Card',
    slug: 'visa-gift-card',
    logoUrl: LOGOS.visa,
    description: 'Visa prepaid gift cards',
    isFeatured: false,
    sortOrder: 7,
    categories: [
      {
        name: 'Visa US Physical',
        slug: 'visa-us-physical',
        cardType: CardType.PHYSICAL,
        country: 'US',
        minValue: 25,
        maxValue: 500,
        rates: [
          { minValue: 25, maxValue: 200, rate: 560 },
          { minValue: 201, maxValue: 500, rate: 540 },
        ],
      },
      {
        name: 'Visa US E-Code',
        slug: 'visa-us-ecode',
        cardType: CardType.ECODE,
        country: 'US',
        minValue: 25,
        maxValue: 300,
        rates: [
          { minValue: 25, maxValue: 100, rate: 540 },
          { minValue: 101, maxValue: 300, rate: 520 },
        ],
      },
      {
        name: 'Visa EU Physical',
        slug: 'visa-eu-physical',
        cardType: CardType.PHYSICAL,
        country: 'EU',
        minValue: 25,
        maxValue: 250,
        rates: [
          { minValue: 25, maxValue: 100, rate: 530 },
          { minValue: 101, maxValue: 250, rate: 510 },
        ],
      },
    ],
  },
  {
    name: 'eBay',
    slug: 'ebay',
    logoUrl: LOGOS.ebay,
    description: 'eBay gift cards for online shopping',
    isFeatured: false,
    sortOrder: 8,
    categories: [
      {
        name: 'eBay US E-Code',
        slug: 'ebay-us-ecode',
        cardType: CardType.ECODE,
        country: 'US',
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 520 },
          { minValue: 101, maxValue: 200, rate: 500 },
        ],
      },
      {
        name: 'eBay US Physical',
        slug: 'ebay-us-physical',
        cardType: CardType.PHYSICAL,
        country: 'US',
        minValue: 25,
        maxValue: 300,
        rates: [
          { minValue: 25, maxValue: 100, rate: 510 },
          { minValue: 101, maxValue: 300, rate: 490 },
        ],
      },
      {
        name: 'eBay UK E-Code',
        slug: 'ebay-uk-ecode',
        cardType: CardType.ECODE,
        country: 'UK',
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 490 },
          { minValue: 101, maxValue: 200, rate: 470 },
        ],
      },
    ],
  },
  {
    name: 'Nike',
    slug: 'nike',
    logoUrl: LOGOS.nike,
    description: 'Nike gift cards for sportswear',
    isFeatured: false,
    sortOrder: 9,
    categories: [
      {
        name: 'Nike US Physical',
        slug: 'nike-us-physical',
        cardType: CardType.PHYSICAL,
        country: 'US',
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 490 },
          { minValue: 101, maxValue: 200, rate: 470 },
        ],
      },
      {
        name: 'Nike US E-Code',
        slug: 'nike-us-ecode',
        cardType: CardType.ECODE,
        country: 'US',
        minValue: 25,
        maxValue: 150,
        rates: [
          { minValue: 25, maxValue: 75, rate: 480 },
          { minValue: 76, maxValue: 150, rate: 460 },
        ],
      },
      {
        name: 'Nike UK Physical',
        slug: 'nike-uk-physical',
        cardType: CardType.PHYSICAL,
        country: 'UK',
        minValue: 25,
        maxValue: 150,
        rates: [
          { minValue: 25, maxValue: 75, rate: 470 },
          { minValue: 76, maxValue: 150, rate: 450 },
        ],
      },
    ],
  },
  {
    name: 'Sephora',
    slug: 'sephora',
    logoUrl: LOGOS.sephora,
    description: 'Sephora beauty gift cards',
    isFeatured: false,
    sortOrder: 10,
    categories: [
      {
        name: 'Sephora US Physical',
        slug: 'sephora-us-physical',
        cardType: CardType.PHYSICAL,
        country: 'US',
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 480 },
          { minValue: 101, maxValue: 200, rate: 460 },
        ],
      },
      {
        name: 'Sephora US E-Code',
        slug: 'sephora-us-ecode',
        cardType: CardType.ECODE,
        country: 'US',
        minValue: 25,
        maxValue: 150,
        rates: [
          { minValue: 25, maxValue: 75, rate: 470 },
          { minValue: 76, maxValue: 150, rate: 450 },
        ],
      },
      {
        name: 'Sephora CA Physical',
        slug: 'sephora-ca-physical',
        cardType: CardType.PHYSICAL,
        country: 'CA',
        minValue: 25,
        maxValue: 150,
        rates: [
          { minValue: 25, maxValue: 75, rate: 460 },
          { minValue: 76, maxValue: 150, rate: 440 },
        ],
      },
    ],
  },
];

// ─── Shop Products (Admin-stocked) ───────────────────────
const SHOP_PRODUCTS = [
  {
    brandName: 'iTunes',
    image: LOGOS.itunes,
    slug: 'shop-itunes-us-25',
    cardType: 'E-Code',
    countryCode: 'US',
    region: 'United States',
    denominationValue: 25,
    denominationCurrency: 'USD',
    priceNgn: 22000 * 100, // ₦22,000 in kobo
    costPriceNgn: 18000 * 100,
    description: 'Apple iTunes $25 E-Code — redeemable on App Store, iTunes, Apple Music and more.',
    redeemInstructions: '1. Open the App Store on your Apple device\n2. Tap your profile icon\n3. Tap "Redeem Gift Card or Code"\n4. Enter the code',
    isFeatured: true,
    sortOrder: 1,
    codes: [
      { code: 'XKJL-MNPQ-RS7T-UV8W', pin: null },
      { code: 'AB2C-DEFG-HJ3K-LM4N', pin: null },
      { code: 'PQ5R-ST6U-VW7X-YZ8A', pin: null },
      { code: 'BC9D-EF1G-HJ2K-LM3N', pin: null },
      { code: 'UV4W-XY5Z-AB6C-DE7F', pin: null },
    ],
  },
  {
    brandName: 'iTunes',
    image: LOGOS.itunes,
    slug: 'shop-itunes-us-50',
    cardType: 'E-Code',
    countryCode: 'US',
    region: 'United States',
    denominationValue: 50,
    denominationCurrency: 'USD',
    priceNgn: 42000 * 100,
    costPriceNgn: 35000 * 100,
    description: 'Apple iTunes $50 E-Code — perfect for apps, games, music and subscriptions.',
    redeemInstructions: '1. Open the App Store on your Apple device\n2. Tap your profile icon\n3. Tap "Redeem Gift Card or Code"\n4. Enter the code',
    isFeatured: true,
    sortOrder: 2,
    codes: [
      { code: 'GH8J-KL9M-NP1Q-RS2T', pin: null },
      { code: 'UV3W-XY4Z-AB5C-DE6F', pin: null },
      { code: 'GH7J-KL8M-NP9Q-RS1T', pin: null },
    ],
  },
  {
    brandName: 'Amazon',
    image: LOGOS.amazon,
    slug: 'shop-amazon-us-25',
    cardType: 'E-Code',
    countryCode: 'US',
    region: 'United States',
    denominationValue: 25,
    denominationCurrency: 'USD',
    priceNgn: 21000 * 100,
    costPriceNgn: 17500 * 100,
    description: 'Amazon $25 Gift Card — shop millions of items on Amazon.com.',
    redeemInstructions: '1. Go to amazon.com/redeem\n2. Sign in to your account\n3. Enter the claim code\n4. Balance added instantly',
    isFeatured: true,
    sortOrder: 3,
    codes: [
      { code: 'AZ-HQKF-NB7RTY', pin: null },
      { code: 'AZ-WMXL-PD3VCS', pin: null },
      { code: 'AZ-JRNF-QK8BHT', pin: null },
      { code: 'AZ-GLPS-VW2MXN', pin: null },
    ],
  },
  {
    brandName: 'Amazon',
    image: LOGOS.amazon,
    slug: 'shop-amazon-us-100',
    cardType: 'E-Code',
    countryCode: 'US',
    region: 'United States',
    denominationValue: 100,
    denominationCurrency: 'USD',
    priceNgn: 82000 * 100,
    costPriceNgn: 70000 * 100,
    description: 'Amazon $100 Gift Card — the perfect gift for any occasion.',
    redeemInstructions: '1. Go to amazon.com/redeem\n2. Sign in to your account\n3. Enter the claim code\n4. Balance added instantly',
    isFeatured: false,
    sortOrder: 4,
    codes: [
      { code: 'AZ-TPNW-QR5FJK', pin: null },
      { code: 'AZ-BVXD-HL9MCS', pin: null },
    ],
  },
  {
    brandName: 'Steam',
    image: LOGOS.steam,
    slug: 'shop-steam-us-20',
    cardType: 'E-Code',
    countryCode: 'US',
    region: 'United States',
    denominationValue: 20,
    denominationCurrency: 'USD',
    priceNgn: 16000 * 100,
    costPriceNgn: 13000 * 100,
    description: 'Steam Wallet $20 — buy games, DLC, and in-game items.',
    redeemInstructions: '1. Open Steam client\n2. Click your username > Account Details\n3. Click "Add funds to your Steam Wallet"\n4. Click "Redeem a Steam Gift Card"\n5. Enter the code',
    isFeatured: false,
    sortOrder: 5,
    codes: [
      { code: 'STEAM-4KNP-QRTX-7BWL', pin: null },
      { code: 'STEAM-8FHJ-MDVZ-3CKS', pin: null },
      { code: 'STEAM-6RWN-PLGX-9BTQ', pin: null },
    ],
  },
  {
    brandName: 'Google Play',
    image: LOGOS.google,
    slug: 'shop-google-play-us-25',
    cardType: 'E-Code',
    countryCode: 'US',
    region: 'United States',
    denominationValue: 25,
    denominationCurrency: 'USD',
    priceNgn: 19000 * 100,
    costPriceNgn: 15000 * 100,
    description: 'Google Play $25 — apps, games, movies, books and more.',
    redeemInstructions: '1. Open Google Play Store app\n2. Tap Menu > Redeem\n3. Enter the code\n4. Tap Redeem',
    isFeatured: false,
    sortOrder: 6,
    codes: [
      { code: 'GP-7KBNR-FWLTX-Q3D', pin: null },
      { code: 'GP-2MHPS-VJCWN-K8R', pin: null },
    ],
  },
];

@Injectable()
export class GiftCardSeedService implements OnModuleInit {
  private readonly logger = new Logger(GiftCardSeedService.name);

  constructor(
    @InjectModel(GiftCardBrand.name) private readonly brandModel: Model<GiftCardBrandDocument>,
    @InjectModel(GiftCardCategory.name) private readonly categoryModel: Model<GiftCardCategoryDocument>,
    @InjectModel(GiftCardRate.name) private readonly rateModel: Model<GiftCardRateDocument>,
    @InjectModel(GiftCardShopProduct.name) private readonly shopProductModel: Model<GiftCardShopProductDocument>,
    @InjectModel(GiftCardShopCode.name) private readonly shopCodeModel: Model<GiftCardShopCodeDocument>,
  ) {}

  async onModuleInit() {
    // Never auto-seed in production. The seed contains fake shop codes
    // (XKJL-MNPQ-RS7T-UV8W, etc.) which must never reach a production DB.
    // To seed a fresh production DB, run the seed manually via a one-off script.
    const env = process.env.NODE_ENV;
    if (env === 'production' || process.env.DISABLE_SEEDS === 'true') {
      this.logger.log(
        `Skipping gift card auto-seed (NODE_ENV=${env}, DISABLE_SEEDS=${process.env.DISABLE_SEEDS})`,
      );
      return;
    }

    await this.seedSellFlow();
    await this.seedShopProducts();
  }

  /**
   * Seed brands, categories, and rates for the sell gift card flow
   */
  async seedSellFlow(): Promise<void> {
    let brandsCreated = 0;
    let catsCreated = 0;
    let ratesCreated = 0;

    // ── Step 0: clean up orphans from previous runs ──
    // If a brand was deleted via the admin UI and then re-seeded, its
    // categories now reference a dead brandId and become invisible to the
    // public API. Same for rates that reference deleted categories. Drop
    // them so the next pass can rebuild cleanly.
    const liveBrandIds = (await this.brandModel.find({}, '_id').lean()).map(
      (b: any) => b._id,
    );
    const orphanCats = await this.categoryModel.deleteMany({
      brandId: { $nin: liveBrandIds },
    });
    if (orphanCats.deletedCount) {
      this.logger.warn(
        `Removed ${orphanCats.deletedCount} orphaned categories (brand no longer exists)`,
      );
    }

    const liveCategoryIds = (
      await this.categoryModel.find({}, '_id').lean()
    ).map((c: any) => c._id);
    const orphanRates = await this.rateModel.deleteMany({
      categoryId: { $nin: liveCategoryIds },
    });
    if (orphanRates.deletedCount) {
      this.logger.warn(
        `Removed ${orphanRates.deletedCount} orphaned rates (category no longer exists)`,
      );
    }

    for (const brandDef of SELL_BRANDS) {
      // Upsert brand
      let brand = await this.brandModel.findOne({ slug: brandDef.slug });
      if (!brand) {
        brand = await this.brandModel.create({
          name: brandDef.name,
          slug: brandDef.slug,
          logoUrl: brandDef.logoUrl,
          description: brandDef.description,
          status: BrandStatus.ACTIVE,
          sortOrder: brandDef.sortOrder,
          isFeatured: brandDef.isFeatured,
        });
        brandsCreated++;
      } else {
        // Update logo and description
        brand.logoUrl = brandDef.logoUrl;
        brand.description = brandDef.description;
        brand.sortOrder = brandDef.sortOrder;
        brand.isFeatured = brandDef.isFeatured;
        await brand.save();
      }

      // Seed categories for this brand
      for (const catDef of brandDef.categories) {
        // Scope the lookup by brandId — the unique index is
        // { brandId: 1, slug: 1 }, so slugs can legitimately repeat
        // across brands. Scoping here also guards against the orphan
        // bug where a pre-existing category points to a deleted brand.
        let category = await this.categoryModel.findOne({
          brandId: brand._id,
          slug: catDef.slug,
        });
        if (!category) {
          category = await this.categoryModel.create({
            brandId: brand._id,
            name: catDef.name,
            slug: catDef.slug,
            cardType: catDef.cardType,
            country: catDef.country,
            status: CategoryStatus.ACTIVE,
            minValue: catDef.minValue,
            maxValue: catDef.maxValue,
            sortOrder: 0,
          });
          catsCreated++;
        } else if (category.status !== CategoryStatus.ACTIVE) {
          // Re-activate any category that was soft-deactivated
          category.status = CategoryStatus.ACTIVE;
          await category.save();
        }

        // Seed rates for this category
        for (const rateDef of catDef.rates) {
          const existingRate = await this.rateModel.findOne({
            categoryId: category._id,
            minValue: rateDef.minValue,
            maxValue: rateDef.maxValue,
          });
          if (!existingRate) {
            await this.rateModel.create({
              categoryId: category._id,
              minValue: rateDef.minValue,
              maxValue: rateDef.maxValue,
              rate: rateDef.rate,
              status: RateStatus.ACTIVE,
            });
            ratesCreated++;
          }
        }
      }
    }

    this.logger.log(
      `Sell flow seeded: ${brandsCreated} brands, ${catsCreated} categories, ${ratesCreated} rates`,
    );
  }

  /**
   * Seed shop products with codes for the admin gift card shop
   */
  async seedShopProducts(): Promise<void> {
    let productsCreated = 0;
    let codesCreated = 0;

    for (const prodDef of SHOP_PRODUCTS) {
      let product = await this.shopProductModel.findOne({ slug: prodDef.slug });
      if (!product) {
        product = await this.shopProductModel.create({
          brandName: prodDef.brandName,
          slug: prodDef.slug,
          cardType: prodDef.cardType,
          countryCode: prodDef.countryCode,
          region: prodDef.region,
          denominationValue: prodDef.denominationValue,
          denominationCurrency: prodDef.denominationCurrency,
          priceNgn: prodDef.priceNgn,
          costPriceNgn: prodDef.costPriceNgn,
          description: prodDef.description,
          redeemInstructions: prodDef.redeemInstructions,
          status: ShopProductStatus.ACTIVE,
          totalCodes: prodDef.codes.length,
          availableCodes: prodDef.codes.length,
          soldCount: 0,
          sortOrder: prodDef.sortOrder,
          isFeatured: prodDef.isFeatured,
          images: prodDef.image ? [prodDef.image] : [],
        });
        productsCreated++;

        // Add codes
        for (const codeDef of prodDef.codes) {
          await this.shopCodeModel.create({
            productId: product._id,
            code: codeDef.code,
            pin: codeDef.pin,
            status: ShopCodeStatus.AVAILABLE,
          });
          codesCreated++;
        }
      } else {
        // Update images on existing products
        const newImages = prodDef.image ? [prodDef.image] : [];
        if (!product.images?.length && newImages.length) {
          product.images = newImages;
          await product.save();
        }
      }
    }

    this.logger.log(
      `Shop seeded: ${productsCreated} products, ${codesCreated} codes`,
    );
  }
}
