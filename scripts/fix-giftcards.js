/**
 * scripts/fix-giftcards.js
 *
 * Standalone MongoDB repair script for gift card brands, categories, and rates.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   node scripts/fix-giftcards.js
 *
 * What it does:
 *   1. Connects to the MONGO_URI from .env
 *   2. Prints current counts of brands/categories/rates
 *   3. Deletes orphaned categories (brandId points to a missing brand)
 *   4. Deletes orphaned rates (categoryId points to a missing category)
 *   5. Upserts all brands/categories/rates from the embedded SELL_BRANDS data
 *   6. Prints final counts so you can verify everything is in place
 */

const path = require("path");
const mongoose = require(path.join(
  __dirname,
  "..",
  "node_modules",
  "mongoose"
));
require(path.join(__dirname, "..", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", ".env"),
});

// ─── Data to upsert (mirrors src/admin/seeds/seed-giftcards.ts SELL_BRANDS) ──

const LOGOS = {
  itunes: "https://www.google.com/s2/favicons?domain=apple.com&sz=128",
  amazon: "https://www.google.com/s2/favicons?domain=amazon.com&sz=128",
  steam: "https://www.google.com/s2/favicons?domain=steampowered.com&sz=128",
  google: "https://www.google.com/s2/favicons?domain=play.google.com&sz=128",
  xbox: "https://www.google.com/s2/favicons?domain=xbox.com&sz=128",
  playstation:
    "https://www.google.com/s2/favicons?domain=playstation.com&sz=128",
  visa: "https://www.google.com/s2/favicons?domain=visa.com&sz=128",
  ebay: "https://www.google.com/s2/favicons?domain=ebay.com&sz=128",
  nike: "https://www.google.com/s2/favicons?domain=nike.com&sz=128",
  sephora: "https://www.google.com/s2/favicons?domain=sephora.com&sz=128",
};

const SELL_BRANDS = [
  {
    name: "iTunes",
    slug: "itunes",
    logoUrl: LOGOS.itunes,
    description: "Apple iTunes & App Store gift cards",
    isFeatured: true,
    sortOrder: 1,
    categories: [
      {
        name: "iTunes US Physical",
        slug: "itunes-us-physical",
        cardType: "PHYSICAL",
        country: "US",
        minValue: 25,
        maxValue: 500,
        rates: [
          { minValue: 25, maxValue: 100, rate: 620 },
          { minValue: 101, maxValue: 200, rate: 600 },
          { minValue: 201, maxValue: 500, rate: 580 },
        ],
      },
      {
        name: "iTunes US E-Code",
        slug: "itunes-us-ecode",
        cardType: "ECODE",
        country: "US",
        minValue: 10,
        maxValue: 200,
        rates: [
          { minValue: 10, maxValue: 50, rate: 600 },
          { minValue: 51, maxValue: 200, rate: 580 },
        ],
      },
      {
        name: "iTunes UK Physical",
        slug: "itunes-uk-physical",
        cardType: "PHYSICAL",
        country: "UK",
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
    name: "Amazon",
    slug: "amazon",
    logoUrl: LOGOS.amazon,
    description: "Amazon gift cards for shopping",
    isFeatured: true,
    sortOrder: 2,
    categories: [
      {
        name: "Amazon US Physical",
        slug: "amazon-us-physical",
        cardType: "PHYSICAL",
        country: "US",
        minValue: 25,
        maxValue: 500,
        rates: [
          { minValue: 25, maxValue: 100, rate: 580 },
          { minValue: 101, maxValue: 500, rate: 560 },
        ],
      },
      {
        name: "Amazon US E-Code",
        slug: "amazon-us-ecode",
        cardType: "ECODE",
        country: "US",
        minValue: 10,
        maxValue: 200,
        rates: [{ minValue: 10, maxValue: 200, rate: 560 }],
      },
      {
        name: "Amazon UK E-Code",
        slug: "amazon-uk-ecode",
        cardType: "ECODE",
        country: "UK",
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
    name: "Steam",
    slug: "steam",
    logoUrl: LOGOS.steam,
    description: "Steam Wallet gift cards for gaming",
    isFeatured: true,
    sortOrder: 3,
    categories: [
      {
        name: "Steam US Physical",
        slug: "steam-us-physical",
        cardType: "PHYSICAL",
        country: "US",
        minValue: 20,
        maxValue: 100,
        rates: [
          { minValue: 20, maxValue: 50, rate: 560 },
          { minValue: 51, maxValue: 100, rate: 540 },
        ],
      },
      {
        name: "Steam US E-Code",
        slug: "steam-us-ecode",
        cardType: "ECODE",
        country: "US",
        minValue: 10,
        maxValue: 100,
        rates: [
          { minValue: 10, maxValue: 50, rate: 540 },
          { minValue: 51, maxValue: 100, rate: 520 },
        ],
      },
      {
        name: "Steam UK Physical",
        slug: "steam-uk-physical",
        cardType: "PHYSICAL",
        country: "UK",
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
    name: "Google Play",
    slug: "google-play",
    logoUrl: LOGOS.google,
    description: "Google Play Store gift cards",
    isFeatured: true,
    sortOrder: 4,
    categories: [
      {
        name: "Google Play US Physical",
        slug: "google-play-us-physical",
        cardType: "PHYSICAL",
        country: "US",
        minValue: 25,
        maxValue: 200,
        rates: [{ minValue: 25, maxValue: 200, rate: 540 }],
      },
      {
        name: "Google Play US E-Code",
        slug: "google-play-us-ecode",
        cardType: "ECODE",
        country: "US",
        minValue: 10,
        maxValue: 100,
        rates: [
          { minValue: 10, maxValue: 50, rate: 530 },
          { minValue: 51, maxValue: 100, rate: 510 },
        ],
      },
      {
        name: "Google Play UK Physical",
        slug: "google-play-uk-physical",
        cardType: "PHYSICAL",
        country: "UK",
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
    name: "Xbox",
    slug: "xbox",
    logoUrl: LOGOS.xbox,
    description: "Xbox gift cards for gaming and subscriptions",
    isFeatured: false,
    sortOrder: 5,
    categories: [
      {
        name: "Xbox US Physical",
        slug: "xbox-us-physical",
        cardType: "PHYSICAL",
        country: "US",
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 510 },
          { minValue: 101, maxValue: 200, rate: 490 },
        ],
      },
      {
        name: "Xbox US E-Code",
        slug: "xbox-us-ecode",
        cardType: "ECODE",
        country: "US",
        minValue: 10,
        maxValue: 100,
        rates: [
          { minValue: 10, maxValue: 50, rate: 500 },
          { minValue: 51, maxValue: 100, rate: 480 },
        ],
      },
      {
        name: "Xbox UK Physical",
        slug: "xbox-uk-physical",
        cardType: "PHYSICAL",
        country: "UK",
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
    name: "PlayStation",
    slug: "playstation",
    logoUrl: LOGOS.playstation,
    description: "PlayStation Store gift cards",
    isFeatured: false,
    sortOrder: 6,
    categories: [
      {
        name: "PlayStation US Physical",
        slug: "playstation-us-physical",
        cardType: "PHYSICAL",
        country: "US",
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 500 },
          { minValue: 101, maxValue: 200, rate: 480 },
        ],
      },
      {
        name: "PlayStation US E-Code",
        slug: "playstation-us-ecode",
        cardType: "ECODE",
        country: "US",
        minValue: 10,
        maxValue: 100,
        rates: [
          { minValue: 10, maxValue: 50, rate: 490 },
          { minValue: 51, maxValue: 100, rate: 470 },
        ],
      },
      {
        name: "PlayStation EU Physical",
        slug: "playstation-eu-physical",
        cardType: "PHYSICAL",
        country: "EU",
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
    name: "Visa Gift Card",
    slug: "visa-gift-card",
    logoUrl: LOGOS.visa,
    description: "Visa prepaid gift cards",
    isFeatured: false,
    sortOrder: 7,
    categories: [
      {
        name: "Visa US Physical",
        slug: "visa-us-physical",
        cardType: "PHYSICAL",
        country: "US",
        minValue: 25,
        maxValue: 500,
        rates: [
          { minValue: 25, maxValue: 200, rate: 560 },
          { minValue: 201, maxValue: 500, rate: 540 },
        ],
      },
      {
        name: "Visa US E-Code",
        slug: "visa-us-ecode",
        cardType: "ECODE",
        country: "US",
        minValue: 25,
        maxValue: 300,
        rates: [
          { minValue: 25, maxValue: 100, rate: 540 },
          { minValue: 101, maxValue: 300, rate: 520 },
        ],
      },
      {
        name: "Visa EU Physical",
        slug: "visa-eu-physical",
        cardType: "PHYSICAL",
        country: "EU",
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
    name: "eBay",
    slug: "ebay",
    logoUrl: LOGOS.ebay,
    description: "eBay gift cards for online shopping",
    isFeatured: false,
    sortOrder: 8,
    categories: [
      {
        name: "eBay US E-Code",
        slug: "ebay-us-ecode",
        cardType: "ECODE",
        country: "US",
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 520 },
          { minValue: 101, maxValue: 200, rate: 500 },
        ],
      },
      {
        name: "eBay US Physical",
        slug: "ebay-us-physical",
        cardType: "PHYSICAL",
        country: "US",
        minValue: 25,
        maxValue: 300,
        rates: [
          { minValue: 25, maxValue: 100, rate: 510 },
          { minValue: 101, maxValue: 300, rate: 490 },
        ],
      },
      {
        name: "eBay UK E-Code",
        slug: "ebay-uk-ecode",
        cardType: "ECODE",
        country: "UK",
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
    name: "Nike",
    slug: "nike",
    logoUrl: LOGOS.nike,
    description: "Nike gift cards for sportswear",
    isFeatured: false,
    sortOrder: 9,
    categories: [
      {
        name: "Nike US Physical",
        slug: "nike-us-physical",
        cardType: "PHYSICAL",
        country: "US",
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 490 },
          { minValue: 101, maxValue: 200, rate: 470 },
        ],
      },
      {
        name: "Nike US E-Code",
        slug: "nike-us-ecode",
        cardType: "ECODE",
        country: "US",
        minValue: 25,
        maxValue: 150,
        rates: [
          { minValue: 25, maxValue: 75, rate: 480 },
          { minValue: 76, maxValue: 150, rate: 460 },
        ],
      },
      {
        name: "Nike UK Physical",
        slug: "nike-uk-physical",
        cardType: "PHYSICAL",
        country: "UK",
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
    name: "Sephora",
    slug: "sephora",
    logoUrl: LOGOS.sephora,
    description: "Sephora beauty gift cards",
    isFeatured: false,
    sortOrder: 10,
    categories: [
      {
        name: "Sephora US Physical",
        slug: "sephora-us-physical",
        cardType: "PHYSICAL",
        country: "US",
        minValue: 25,
        maxValue: 200,
        rates: [
          { minValue: 25, maxValue: 100, rate: 480 },
          { minValue: 101, maxValue: 200, rate: 460 },
        ],
      },
      {
        name: "Sephora US E-Code",
        slug: "sephora-us-ecode",
        cardType: "ECODE",
        country: "US",
        minValue: 25,
        maxValue: 150,
        rates: [
          { minValue: 25, maxValue: 75, rate: 470 },
          { minValue: 76, maxValue: 150, rate: 450 },
        ],
      },
      {
        name: "Sephora CA Physical",
        slug: "sephora-ca-physical",
        cardType: "PHYSICAL",
        country: "CA",
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

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("ERROR: MONGO_URI not set in .env");
    process.exit(1);
  }

  console.log("[connect] connecting to MongoDB...");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`[connect] connected to database: ${db.databaseName}`);

  const brands = db.collection("giftcardbrands");
  const categories = db.collection("giftcardcategories");
  const rates = db.collection("giftcardrates");

  // ── DIAGNOSE ──
  const beforeB = await brands.countDocuments();
  const beforeC = await categories.countDocuments();
  const beforeR = await rates.countDocuments();
  console.log(
    `[diagnose] BEFORE: brands=${beforeB} categories=${beforeC} rates=${beforeR}`
  );

  // Per-brand category counts before
  const beforeAgg = await categories
    .aggregate([{ $group: { _id: "$brandId", count: { $sum: 1 } } }])
    .toArray();
  const brandDocs = await brands.find({}).toArray();
  const brandMap = new Map(brandDocs.map((b) => [String(b._id), b.name]));
  const beforePerBrand = {};
  for (const row of beforeAgg) {
    const name = brandMap.get(String(row._id)) || `<orphan:${row._id}>`;
    beforePerBrand[name] = row.count;
  }
  console.log("[diagnose] per-brand category counts (before):", beforePerBrand);

  // ── CLEANUP: remove orphans ──
  const liveBrandIds = brandDocs.map((b) => b._id);
  const orphanCats = await categories.deleteMany({
    brandId: { $nin: liveBrandIds },
  });
  console.log(
    `[cleanup] removed ${orphanCats.deletedCount} orphaned categories`
  );

  const liveCategoryIds = (
    await categories.find({}, { projection: { _id: 1 } }).toArray()
  ).map((c) => c._id);
  const orphanRates = await rates.deleteMany({
    categoryId: { $nin: liveCategoryIds },
  });
  console.log(`[cleanup] removed ${orphanRates.deletedCount} orphaned rates`);

  // ── UPSERT: brands → categories → rates ──
  let brandsUpserted = 0;
  let catsUpserted = 0;
  let ratesUpserted = 0;
  const now = new Date();

  for (const brandDef of SELL_BRANDS) {
    // Upsert brand
    const brandRes = await brands.findOneAndUpdate(
      { slug: brandDef.slug },
      {
        $set: {
          name: brandDef.name,
          slug: brandDef.slug,
          logoUrl: brandDef.logoUrl,
          description: brandDef.description,
          status: "ACTIVE",
          sortOrder: brandDef.sortOrder,
          isFeatured: brandDef.isFeatured,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true, returnDocument: "after" }
    );
    const brand = brandRes.value || (await brands.findOne({ slug: brandDef.slug }));
    if (!brand) {
      console.error(`[ERROR] failed to upsert brand: ${brandDef.name}`);
      continue;
    }
    brandsUpserted++;

    // Upsert categories for this brand
    for (const catDef of brandDef.categories) {
      const catRes = await categories.findOneAndUpdate(
        { brandId: brand._id, slug: catDef.slug },
        {
          $set: {
            brandId: brand._id,
            name: catDef.name,
            slug: catDef.slug,
            cardType: catDef.cardType,
            country: catDef.country,
            status: "ACTIVE",
            minValue: catDef.minValue,
            maxValue: catDef.maxValue,
            sortOrder: 0,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true, returnDocument: "after" }
      );
      const category =
        catRes.value ||
        (await categories.findOne({ brandId: brand._id, slug: catDef.slug }));
      if (!category) {
        console.error(
          `[ERROR] failed to upsert category: ${catDef.name} for brand ${brand.name}`
        );
        continue;
      }
      catsUpserted++;

      // Upsert rates for this category
      for (const rateDef of catDef.rates) {
        await rates.updateOne(
          {
            categoryId: category._id,
            minValue: rateDef.minValue,
            maxValue: rateDef.maxValue,
          },
          {
            $set: {
              categoryId: category._id,
              minValue: rateDef.minValue,
              maxValue: rateDef.maxValue,
              rate: rateDef.rate,
              status: "ACTIVE",
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true }
        );
        ratesUpserted++;
      }
    }
  }

  console.log(
    `[seed] upserted: brands=${brandsUpserted} categories=${catsUpserted} rates=${ratesUpserted}`
  );

  // ── VERIFY ──
  const afterB = await brands.countDocuments();
  const afterC = await categories.countDocuments();
  const afterR = await rates.countDocuments();
  console.log(
    `[verify] AFTER: brands=${afterB} categories=${afterC} rates=${afterR}`
  );

  const afterAgg = await categories
    .aggregate([{ $group: { _id: "$brandId", count: { $sum: 1 } } }])
    .toArray();
  const afterBrandDocs = await brands.find({}).toArray();
  const afterBrandMap = new Map(afterBrandDocs.map((b) => [String(b._id), b.name]));
  const afterPerBrand = {};
  for (const row of afterAgg) {
    const name = afterBrandMap.get(String(row._id)) || `<orphan:${row._id}>`;
    afterPerBrand[name] = row.count;
  }
  console.log("[verify] per-brand category counts (after):", afterPerBrand);

  // Also check that every brand has an ACTIVE category + rate
  const activeCategories = await categories.countDocuments({ status: "ACTIVE" });
  const activeRates = await rates.countDocuments({ status: "ACTIVE" });
  console.log(
    `[verify] active categories=${activeCategories} active rates=${activeRates}`
  );

  console.log("[done] ✓ repair complete");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[FATAL]", err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
