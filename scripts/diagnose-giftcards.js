/**
 * scripts/diagnose-giftcards.js
 *
 * Pure read-only diagnostic. Connects using the same MONGO_URI from .env
 * that my fix-giftcards.js script used, and prints:
 *   - DB name
 *   - Brand IDs (to cross-check against what the HTTP API returns)
 *   - Per-brand category count
 *   - Sample category docs for iTunes & Amazon
 *
 * No writes.
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
  const uri = process.env.MONGO_URI;
  console.log(
    "[connect] Using MONGO_URI from .env, host:",
    uri ? new URL(uri.replace("mongodb+srv://", "https://")).host : "MISSING"
  );
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log("[connect] database:", db.databaseName);

  const brands = db.collection("giftcardbrands");
  const categories = db.collection("giftcardcategories");

  const allBrands = await brands.find({}).toArray();
  console.log(`\n[brands] total=${allBrands.length}`);
  for (const b of allBrands) {
    const count = await categories.countDocuments({ brandId: b._id });
    const activeCount = await categories.countDocuments({
      brandId: b._id,
      status: "ACTIVE",
    });
    console.log(
      `  - ${b.name.padEnd(16)} id=${b._id} slug=${b.slug}  total=${count}  active=${activeCount}`
    );
  }

  // Sample: show the ACTUAL category docs for iTunes and Amazon brands
  const itunes = allBrands.find((b) => b.slug === "itunes");
  const amazon = allBrands.find((b) => b.slug === "amazon");

  if (itunes) {
    console.log(`\n[iTunes categories] brandId=${itunes._id}`);
    const cats = await categories.find({ brandId: itunes._id }).toArray();
    cats.forEach((c) =>
      console.log(
        `  - ${c.name} | slug=${c.slug} | status=${c.status} | minValue=${c.minValue}`
      )
    );
    if (cats.length === 0) console.log("  (empty)");
  }

  if (amazon) {
    console.log(`\n[Amazon categories] brandId=${amazon._id}`);
    const cats = await categories.find({ brandId: amazon._id }).toArray();
    cats.forEach((c) =>
      console.log(
        `  - ${c.name} | slug=${c.slug} | status=${c.status} | minValue=${c.minValue}`
      )
    );
    if (cats.length === 0) console.log("  (empty)");
  }

  // Check: does the brandId from the HTTP API (69ddf5302034e3103e727339) exist
  // in this database? If not, the running backend uses a different DB.
  const apiBrandId = "69ddf5302034e3103e727339";
  const match = allBrands.find((b) => String(b._id) === apiBrandId);
  console.log(
    `\n[cross-check] iTunes id from HTTP API (${apiBrandId}) found in this DB? ${match ? "YES" : "NO — DIFFERENT DATABASE"}`
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
