/**
 * scripts/reset-wallet-balances.js
 *
 * Zeros out every wallet balance so the production DB is clean
 * before flipping to live Kora Pay. Test top-ups (Kora sandbox,
 * Paystack test, manual credits) inflate balances with fake money;
 * this script resets all of them to 0.
 *
 * What it does — for every wallet with balance > 0:
 *   1. Creates an audit WalletTransaction (DEBIT, source=MANUAL_ADJUSTMENT,
 *      narration="Test balance reset before live cutover") so the reset
 *      itself is traceable.
 *   2. Sets the wallet balance to 0 and updates lastTransactionAt.
 *
 * Historical top-up transactions are NOT deleted — audit trail stays.
 *
 * Usage:
 *   node scripts/reset-wallet-balances.js --dry-run      # preview only
 *   node scripts/reset-wallet-balances.js                # apply
 *
 * Safe to re-run (idempotent — once all balances are 0, it's a no-op).
 */
const path = require('path');
const mongoose = require(path.join(__dirname, '..', 'node_modules', 'mongoose'));
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('[FATAL] MONGO_URI not set in .env');
    process.exit(1);
  }

  console.log(`\n${DRY_RUN ? '🔍 DRY RUN — no changes will be made' : '⚠  LIVE RUN — changes will be applied'}`);
  console.log(`Connecting to MongoDB...`);

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const wallets = db.collection('wallets');
  const txns = db.collection('wallettransactions');

  const nonZero = await wallets.find({ balance: { $ne: 0 } }).toArray();
  const totalWallets = await wallets.countDocuments({});

  let totalKobo = 0;
  for (const w of nonZero) totalKobo += w.balance || 0;
  const totalNaira = totalKobo / 100;

  console.log(`\n──────────────────────────────────────────────────────`);
  console.log(`  Wallets in DB:        ${totalWallets}`);
  console.log(`  With non-zero bal:    ${nonZero.length}`);
  console.log(`  Total to clear:       ₦${totalNaira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`──────────────────────────────────────────────────────`);

  if (nonZero.length === 0) {
    console.log('Nothing to do — all wallets already at 0.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Show top 10 biggest balances for sanity
  const top = [...nonZero].sort((a, b) => (b.balance || 0) - (a.balance || 0)).slice(0, 10);
  console.log(`\nTop 10 balances (preview):`);
  for (const w of top) {
    console.log(`  user=${w.userId}  ₦${(w.balance / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`);
  }

  if (DRY_RUN) {
    console.log(`\n✓ DRY RUN complete. Re-run WITHOUT --dry-run to apply.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`\nApplying...`);
  let zeroed = 0;
  for (const w of nonZero) {
    const balanceBefore = w.balance;
    const reference = `RESET_${w._id}_${Date.now()}`;

    // 1. Audit DEBIT transaction
    await txns.insertOne({
      userId: w.userId,
      walletId: w._id,
      type: 'DEBIT',
      category: 'MANUAL',
      source: 'MANUAL_ADJUSTMENT',
      amount: balanceBefore,
      currency: w.currency || 'NGN',
      reference,
      status: 'SUCCESS',
      balanceBefore,
      balanceAfter: 0,
      narration: 'Test balance reset before live cutover',
      meta: { reset: true, reason: 'test_to_live_cutover' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 2. Zero the wallet
    await wallets.updateOne(
      { _id: w._id },
      { $set: { balance: 0, lastTransactionAt: new Date() } },
    );

    zeroed++;
    if (zeroed % 25 === 0) console.log(`  ...${zeroed}/${nonZero.length}`);
  }

  console.log(`\n✓ Done. Zeroed ${zeroed} wallets. ₦${totalNaira.toLocaleString('en-NG')} cleared.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[FATAL]', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
