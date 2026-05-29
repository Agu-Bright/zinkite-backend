/**
 * scripts/fix-string-brandids.js
 *
 * Finds any gift card category whose brandId is stored as a string
 * (legacy data from before the schema was enforced) and converts it
 * to a proper ObjectId reference, OR deletes it if the string doesn't
 * parse as a valid ObjectId or points to a nonexistent brand.
 *
 * Safe to re-run.
 */
const path = require("path");
const mongoose = require(path.join(__dirname, "..", "node_modules", "mongoose"));
require(path.join(__dirname, "..", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", ".env"),
});

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const categories = db.collection("giftcardcategories");
  const brands = db.collection("giftcardbrands");
  const { ObjectId } = mongoose.Types;

  const allCats = await categories.find({}).toArray();
  let fixed = 0;
  let deleted = 0;

  for (const cat of allCats) {
    if (typeof cat.brandId === "string") {
      console.log(`[found] category ${cat._id} (${cat.name}) has string brandId="${cat.brandId}"`);
      if (ObjectId.isValid(cat.brandId)) {
        const oid = new ObjectId(cat.brandId);
        const brandExists = await brands.findOne({ _id: oid });
        if (brandExists) {
          await categories.updateOne(
            { _id: cat._id },
            { $set: { brandId: oid } }
          );
          console.log(`  → fixed: brandId cast to ObjectId`);
          fixed++;
        } else {
          await categories.deleteOne({ _id: cat._id });
          console.log(`  → deleted: brand does not exist`);
          deleted++;
        }
      } else {
        await categories.deleteOne({ _id: cat._id });
        console.log(`  → deleted: string is not a valid ObjectId`);
        deleted++;
      }
    }
  }

  console.log(`\n[done] fixed=${fixed} deleted=${deleted}`);

  // Also delete orphan rates that now point to a deleted category
  const liveCategoryIds = (
    await categories.find({}, { projection: { _id: 1 } }).toArray()
  ).map((c) => c._id);
  const rates = db.collection("giftcardrates");
  const orphanRates = await rates.deleteMany({
    categoryId: { $nin: liveCategoryIds },
  });
  console.log(`[done] removed ${orphanRates.deletedCount} orphan rates`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[FATAL]", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
