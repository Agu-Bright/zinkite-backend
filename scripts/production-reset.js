/**
 * scripts/production-reset.js
 *
 * PRE-PRODUCTION RESET — irreversibly wipes user transactional history and
 * the gift-card catalog so the database starts clean for the go-live cutover.
 *
 * WHAT IT CLEARS
 * ─────────────────────────────────────────────────────────────
 *   Wallet ledger:
 *     • wallettransactions   — every credit/debit row
 *     • wallets.balance      — set to 0 on every user's wallet
 *     • wallets.lastTransactionAt — cleared
 *
 *   Payment provider transaction records:
 *     • korapaytransactions
 *     • paystacktransactions
 *
 *   Money-movement records:
 *     • withdrawals           — all rows
 *     • walletcreditrequests  — admin credit requests
 *
 *   Gift card sell/trade:
 *     • giftcardtrades        — sell history
 *
 *   Gift card catalog (as requested — will be rebuilt in the admin):
 *     • giftcardbrands
 *     • giftcardcategories
 *     • giftcardrates
 *
 * WHAT IT DOES NOT TOUCH
 * ─────────────────────────────────────────────────────────────
 *   • users                            — user accounts stay
 *   • bankaccounts, virtualaccounts    — user identity/payout endpoints stay
 *   • adminusers, adminroles           — admin identity stays
 *   • appsettings                      — admin settings stay
 *   • referrals, referralchallenges    — referral state stays
 *   • usertasks*, promobanners, otps, auditlogs, notification*, supporttickets
 *   • giftcard-buy, giftcard-shop      — buy-side collections untouched
 *                                        (add manually if you want them too)
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────
 *   Preview only (no writes):
 *     node scripts/production-reset.js --dry-run
 *
 *   Apply (prompts for a typed "RESET" confirmation):
 *     node scripts/production-reset.js
 *
 *   Apply without prompt (CI / non-interactive):
 *     node scripts/production-reset.js --yes
 *
 * The script prints counts before AND after so you can verify what changed.
 * Safe to re-run — once empty, subsequent runs are a no-op.
 */
const path = require('path');
const readline = require('readline');
const mongoose = require(path.join(__dirname, '..', 'node_modules', 'mongoose'));
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', '.env'),
});

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_CONFIRM = process.argv.includes('--yes');

// Collections that get their documents deleted entirely.
// Add/remove entries here to tune scope.
const COLLECTIONS_TO_EMPTY = [
  // Wallet ledger
  'wallettransactions',
  // Payment provider ledgers
  'korapaytransactions',
  'paystacktransactions',
  // Money movement
  'withdrawals',
  'walletcreditrequests',
  // Sell / trade
  'giftcardtrades',
  // Gift card catalog
  'giftcardbrands',
  'giftcardcategories',
  'giftcardrates',
];

function maskUri(uri) {
  if (!uri) return '(unset)';
  try {
    return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/, '$1$2:***@');
  } catch {
    return '(unparseable)';
  }
}

async function promptConfirm(dbLabel) {
  if (SKIP_CONFIRM || DRY_RUN) return true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(
      `\nType "RESET" to wipe transactional data on ${dbLabel}: `,
      (answer) => {
        rl.close();
        resolve(answer.trim() === 'RESET');
      },
    );
  });
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI (or MONGO_URI) is not set in .env');
    process.exit(1);
  }

  console.log('─'.repeat(60));
  console.log(`Mode:   ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY (writes DB)'}`);
  console.log(`Target: ${maskUri(uri)}`);
  console.log('─'.repeat(60));

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error('❌ Failed to obtain a database handle');
    process.exit(1);
  }
  const dbLabel = db.databaseName;
  console.log(`Connected to database: ${dbLabel}`);

  // ─── BEFORE snapshot ──────────────────────────────
  console.log('\nCounts BEFORE:');
  const before = {};
  for (const name of COLLECTIONS_TO_EMPTY) {
    try {
      before[name] = await db.collection(name).countDocuments({});
    } catch {
      before[name] = 0; // collection may not exist yet — treat as empty
    }
    console.log(`  ${name.padEnd(28)} ${before[name]}`);
  }

  const walletCol = db.collection('wallets');
  const totalWallets = await walletCol.countDocuments({});
  const walletsWithBalance = await walletCol.countDocuments({
    balance: { $gt: 0 },
  });
  console.log(
    `  wallets (with balance>0)     ${walletsWithBalance} / ${totalWallets} total`,
  );

  // ─── Confirmation ────────────────────────────────
  const proceed = await promptConfirm(dbLabel);
  if (!proceed) {
    console.log('\nAborted. Nothing was changed.');
    await mongoose.disconnect();
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log('\n(dry-run — skipping writes)');
    await mongoose.disconnect();
    return;
  }

  // ─── Deletes ─────────────────────────────────────
  console.log('\nDeleting…');
  for (const name of COLLECTIONS_TO_EMPTY) {
    try {
      const res = await db.collection(name).deleteMany({});
      console.log(`  ${name.padEnd(28)} deleted ${res.deletedCount}`);
    } catch (err) {
      console.warn(`  ${name.padEnd(28)} SKIPPED (${err.message})`);
    }
  }

  // ─── Wallet balance reset ─────────────────────────
  // Keeps the wallet document itself (userId, currency, status, timestamps)
  // — only zeros the balance and clears lastTransactionAt.
  const resetRes = await walletCol.updateMany(
    {},
    { $set: { balance: 0, lastTransactionAt: null } },
  );
  console.log(
    `  wallets                       balance→0 on ${resetRes.modifiedCount} of ${resetRes.matchedCount}`,
  );

  // ─── AFTER snapshot ──────────────────────────────
  console.log('\nCounts AFTER:');
  for (const name of COLLECTIONS_TO_EMPTY) {
    let count = 0;
    try {
      count = await db.collection(name).countDocuments({});
    } catch {
      /* collection doesn't exist */
    }
    console.log(`  ${name.padEnd(28)} ${count}`);
  }
  const walletsStillWithBalance = await walletCol.countDocuments({
    balance: { $gt: 0 },
  });
  console.log(
    `  wallets (with balance>0)     ${walletsStillWithBalance} / ${totalWallets} total`,
  );

  console.log('\n✅ Done.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\n❌ Reset failed:', err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
