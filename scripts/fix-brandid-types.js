/**
 * scripts/fix-brandid-types.js
 *
 * Migrates giftcardcategories.brandId from string form (BSON type 2) to
 * ObjectId form (BSON type 7). This mirrors what fix-string-brandids.js
 * used to do — separate script so the intent is obvious in git history.
 *
 * Idempotent: rows already stored as ObjectId are skipped.
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

  const col = db.collection('giftcardcategories');
  const all = await col.find({}).toArray();

  let fixed = 0;
  let alreadyOk = 0;
  for (const cat of all) {
    if (cat.brandId && typeof cat.brandId === 'string') {
      const oid = new mongoose.Types.ObjectId(cat.brandId);
      await col.updateOne({ _id: cat._id }, { $set: { brandId: oid } });
      console.log(`  fixed ${cat.name}  (${cat.brandId} → ObjectId)`);
      fixed++;
    } else {
      alreadyOk++;
    }
  }

  console.log(`\nDone. Fixed ${fixed}, already-ok ${alreadyOk}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
