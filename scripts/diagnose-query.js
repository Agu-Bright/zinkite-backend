/**
 * scripts/diagnose-query.js
 *
 * Reproduces the exact query the backend runs for getActiveCategories,
 * and additionally tests:
 *   - brandId passed as ObjectId (raw)
 *   - brandId passed as string
 *   - raw brandId type stored in the documents
 *
 * Read-only.
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

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const brands = db.collection("giftcardbrands");
  const categories = db.collection("giftcardcategories");

  // Pick iTunes
  const itunes = await brands.findOne({ slug: "itunes" });
  console.log("[iTunes brand]");
  console.log("  _id:", itunes._id, "type:", typeof itunes._id, "ctor:", itunes._id.constructor.name);

  // 1. Query: status ACTIVE + brandId as ObjectId
  const q1 = await categories
    .find({ brandId: itunes._id, status: "ACTIVE" })
    .toArray();
  console.log(`\n[query 1] brandId=ObjectId status=ACTIVE → ${q1.length} results`);

  // 2. Query: status ACTIVE + brandId as string (24-hex)
  const q2 = await categories
    .find({ brandId: String(itunes._id), status: "ACTIVE" })
    .toArray();
  console.log(`[query 2] brandId=STRING status=ACTIVE → ${q2.length} results`);

  // 3. Query: without status filter
  const q3 = await categories.find({ brandId: itunes._id }).toArray();
  console.log(`[query 3] brandId=ObjectId no status → ${q3.length} results`);

  // 4. Sample raw doc — show stored types
  const sample = await categories.findOne({ brandId: itunes._id });
  if (sample) {
    console.log("\n[sample doc] (first iTunes category)");
    console.log("  _id:", sample._id, "ctor:", sample._id.constructor.name);
    console.log(
      "  brandId:",
      sample.brandId,
      "type:",
      typeof sample.brandId,
      "ctor:",
      sample.brandId?.constructor?.name
    );
    console.log(
      "  status:",
      JSON.stringify(sample.status),
      "type:",
      typeof sample.status
    );
    console.log("  name:", sample.name);
    console.log("  slug:", sample.slug);
  }

  // 5. Now try mimicking Mongoose cast: query with brandId as string on _id field type
  // The backend does: categoryModel.find({ brandId: <string> }). If brandId in DB
  // is ObjectId, Mongoose auto-casts the string. If brandId in DB is a STRING,
  // the auto-cast still sends ObjectId — which won't match. That's the failure.
  const stringBrandId = String(itunes._id);
  const stringSearchOnObjIds = await categories
    .find({ brandId: { $eq: stringBrandId } })
    .toArray();
  console.log(
    `\n[test] find brandId == "${stringBrandId}" (string literal) → ${stringSearchOnObjIds.length} results`
  );

  // 6. Total category count per brandId type distribution
  const allCats = await categories.find({}).limit(200).toArray();
  let objIdCount = 0,
    stringCount = 0,
    otherCount = 0;
  for (const c of allCats) {
    const t = c.brandId?.constructor?.name;
    if (t === "ObjectId") objIdCount++;
    else if (typeof c.brandId === "string") stringCount++;
    else otherCount++;
  }
  console.log(
    `\n[brandId storage types] ObjectId=${objIdCount} string=${stringCount} other=${otherCount}`
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
