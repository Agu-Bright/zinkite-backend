/**
 * scripts/diagnose-types.js
 *
 * Compare two schema forms:
 *   A. Schema.Types.ObjectId  (mongoose schema type constant)
 *   B. Types.ObjectId          (mongoose constructor function — same as backend)
 *
 * Same brand, same string brandId. Does (B) still auto-cast?
 */
const path = require("path");
const mongoose = require(path.join(__dirname, "..", "node_modules", "mongoose"));
require(path.join(__dirname, "..", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", ".env"),
});

const { Schema, model, Types } = mongoose;

// Form A — matches diagnose-mongoose.js (worked)
const SchemaA = new Schema(
  {
    brandId: { type: Schema.Types.ObjectId, ref: "GiftCardBrand", required: true },
    name: String,
    status: String,
  },
  { timestamps: true, collection: "giftcardcategories" }
);

// Form B — matches the backend file (Types.ObjectId, the constructor)
const SchemaB = new Schema(
  {
    brandId: { type: Types.ObjectId, ref: "GiftCardBrand", required: true },
    name: String,
    status: String,
  },
  { timestamps: true, collection: "giftcardcategories" }
);

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const ModelA = model("CatSchemaA", SchemaA);
  const ModelB = model("CatSchemaB", SchemaB);

  const brands = mongoose.connection.db.collection("giftcardbrands");
  const itunes = await brands.findOne({ slug: "itunes" });
  const brandIdStr = String(itunes._id);
  console.log(`[test] using iTunes brandId as string: "${brandIdStr}"`);

  const resA = await ModelA.find({ brandId: brandIdStr, status: "ACTIVE" });
  console.log(`[A] Schema.Types.ObjectId → ${resA.length} results`);

  const resB = await ModelB.find({ brandId: brandIdStr, status: "ACTIVE" });
  console.log(`[B] Types.ObjectId (constructor) → ${resB.length} results`);

  // Also confirm both report the same brandId.instanceof check
  console.log(
    `[cast check] Types.ObjectId === Schema.Types.ObjectId? ${Types.ObjectId === Schema.Types.ObjectId}`
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
