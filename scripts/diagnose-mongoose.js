/**
 * scripts/diagnose-mongoose.js
 *
 * Reproduces the EXACT Mongoose query the backend uses — through the
 * Mongoose ODM layer, not the raw mongodb driver. If this returns 0,
 * we know Mongoose casting is failing. If it returns 3, the issue is
 * elsewhere (cache, wrong process, etc.).
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

const { Schema, model } = mongoose;

// Mirror of src/giftcards/schemas/gift-card-category.schema.ts
const GiftCardCategorySchema = new Schema(
  {
    brandId: {
      type: Schema.Types.ObjectId,
      ref: "GiftCardBrand",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    cardType: { type: String, enum: ["PHYSICAL", "ECODE"], required: true },
    country: { type: String, default: null },
    description: { type: String, default: null },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },
    minValue: { type: Number, required: true, min: 0 },
    maxValue: { type: Number, required: true, min: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "giftcardcategories" }
);

const GiftCardBrandSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    status: { type: String, default: "ACTIVE" },
  },
  { timestamps: true, collection: "giftcardbrands" }
);

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("[connect] database:", mongoose.connection.db.databaseName);

  const CategoryModel = model("GiftCardCategory", GiftCardCategorySchema);
  const BrandModel = model("GiftCardBrand", GiftCardBrandSchema);

  // Get iTunes brand
  const itunes = await BrandModel.findOne({ slug: "itunes" });
  console.log(`[iTunes] _id=${itunes._id} (${itunes._id.constructor.name})`);

  const brandIdStr = String(itunes._id);
  console.log(`\n[test] brandId as string literal: "${brandIdStr}"`);

  // 1. Mongoose query with string brandId (what the backend does)
  const q1 = await CategoryModel.find({
    brandId: brandIdStr,
    status: "ACTIVE",
  });
  console.log(`[q1] Mongoose find({brandId: string, status: 'ACTIVE'}) → ${q1.length} results`);
  q1.slice(0, 3).forEach((c) =>
    console.log(`     - ${c.name} (brandId=${c.brandId}, type=${typeof c.brandId})`)
  );

  // 2. Mongoose query with ObjectId brandId
  const q2 = await CategoryModel.find({
    brandId: itunes._id,
    status: "ACTIVE",
  });
  console.log(`\n[q2] Mongoose find({brandId: ObjectId, status: 'ACTIVE'}) → ${q2.length} results`);
  q2.slice(0, 3).forEach((c) =>
    console.log(`     - ${c.name}`)
  );

  // 3. Mongoose query WITHOUT status filter
  const q3 = await CategoryModel.find({ brandId: brandIdStr });
  console.log(`\n[q3] Mongoose find({brandId: string}) no status filter → ${q3.length} results`);

  // 4. Exact replica of backend's getActiveCategories
  const backendReplica = await CategoryModel.find({
    brandId: brandIdStr,
    status: "ACTIVE",
  }).sort({ sortOrder: 1, name: 1 });
  console.log(
    `\n[q4] backend replica (with sort) → ${backendReplica.length} results`
  );

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
