/**
 * READ-ONLY diagnostic: shows brands and their active category counts,
 * grouped by brandId type (string vs ObjectId).
 *
 * Does NOT modify any data.
 */
const path = require("path");
const mongoose = require(path.join(__dirname, "..", "node_modules", "mongoose"));
require(path.join(__dirname, "..", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", ".env"),
});

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const brands = db.collection("giftcardbrands");
  const categories = db.collection("giftcardcategories");

  const allBrands = await brands.find({}).toArray();
  console.log(`\nTotal brands: ${allBrands.length}\n`);
  console.log('BRAND'.padEnd(28) + 'ACTIVE_CATS  STRING_BRANDID  OBJECTID_BRANDID  STATUS');
  console.log('─'.repeat(95));

  for (const b of allBrands) {
    const oid = b._id;
    const sid = b._id.toString();

    const allCats = await categories.find({
      $or: [{ brandId: oid }, { brandId: sid }],
    }).toArray();

    const activeCats = allCats.filter((c) => c.status === 'active');
    const stringForm = allCats.filter((c) => typeof c.brandId === 'string').length;
    const objectIdForm = allCats.filter((c) => typeof c.brandId === 'object').length;

    const name = (b.name || '(no name)').padEnd(26).slice(0, 26);
    console.log(
      name.padEnd(28) +
      String(activeCats.length).padEnd(13) +
      String(stringForm).padEnd(16) +
      String(objectIdForm).padEnd(18) +
      (b.status || '?')
    );
  }

  // Also show any orphan categories (brandId pointing to non-existent brand)
  const allCatBrandIds = await categories.distinct('brandId');
  const liveBrandOids = allBrands.map((b) => b._id.toString());
  const orphans = allCatBrandIds.filter((bid) => {
    const s = bid?.toString();
    return s && !liveBrandOids.includes(s);
  });
  if (orphans.length) {
    console.log(`\n⚠ Categories with orphan brandId (brand doesn't exist): ${orphans.length}`);
    orphans.slice(0, 5).forEach((o) => console.log('  -', o));
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
