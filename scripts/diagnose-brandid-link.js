/**
 * scripts/diagnose-brandid-link.js
 *
 * Prints every category with its stored brandId's BSON type, and shows
 * whether the referenced brand actually exists. Used to diagnose the
 * "created a category under Amazon but the filter shows nothing" symptom
 * where the brandId got saved as a string instead of an ObjectId.
 *
 * Usage:  node scripts/diagnose-brandid-link.js
 */
const path = require('path');
const mongoose = require(path.join(__dirname, '..', 'node_modules', 'mongoose'));
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const brands = await db.collection('giftcardbrands').find({}).toArray();
  const categories = await db.collection('giftcardcategories').find({}).toArray();

  console.log(`\nBrands (${brands.length}):`);
  for (const b of brands) {
    console.log(`  ${b.name.padEnd(20)} _id=${b._id} (${typeof b._id})`);
  }

  console.log(`\nCategories (${categories.length}):`);
  for (const c of categories) {
    const brandIdType = c.brandId?.constructor?.name || typeof c.brandId;
    const brandIdStr = String(c.brandId);
    const matchedByOid = brands.find(
      (b) => String(b._id) === brandIdStr && brandIdType === 'ObjectId',
    );
    const matchedByAny = brands.find((b) => String(b._id) === brandIdStr);
    console.log(
      `  ${c.name.padEnd(30)} brandId=${brandIdStr}  type=${brandIdType.padEnd(8)}  ` +
        `brand-lookup: ${matchedByAny ? `→ ${matchedByAny.name}` : 'NOT FOUND'}` +
        `${matchedByOid ? '' : matchedByAny ? '  ⚠ wrong BSON type!' : ''}`,
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
