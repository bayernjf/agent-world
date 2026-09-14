/**
 * Invoice generation CLI (M3 S1, design-monetization-m3-implementation).
 *
 * Generates monthly invoices for all users with an active subscription.
 * Idempotent: users who already have an invoice for the target period are
 * skipped. Run once at the start of each billing month, or on-demand after
 * deploying M3 to backfill invoices for the current period.
 *
 * Usage:
 *   DB_FILE=/path/to/agent-world.sqlite \
 *   pnpm --filter @agent-world/server exec tsx scripts/generate-invoices.ts [--period=<epoch-ms>] [--dry-run]
 */
import { openDb } from "../db.js";
import { generateAllInvoices } from "../invoiceService.js";
import { currentPeriodStart } from "../subscription.js";

const args = process.argv.slice(2);
const dryRun = args.some((a) => a === "--dry-run");
const periodArg = args.find((a) => a.startsWith("--period="))?.slice("--period=".length);
const periodStart = periodArg ? Number(periodArg) : currentPeriodStart();

const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
const db = openDb(dbFile);

try {
  if (dryRun) {
    // Dry run: count what would be generated without writing.
    const allUsers = await db.listUsers();
    let wouldCreate = 0;
    let wouldSkip = 0;
    for (const user of allUsers) {
      const existing = await db.findInvoiceByUserAndPeriod(user.id, periodStart);
      if (existing) {
        wouldSkip++;
      } else {
        wouldCreate++;
      }
    }
    console.log(`[dry-run] source: ${dbFile}`);
    console.log(`[dry-run] period_start: ${periodStart} (${new Date(periodStart).toISOString()})`);
    console.log(`[dry-run] total users: ${allUsers.length}`);
    console.log(`[dry-run] would create: ${wouldCreate}`);
    console.log(`[dry-run] would skip (already exists): ${wouldSkip}`);
    console.log(`[dry-run] no invoices written`);
  } else {
    const result = await generateAllInvoices(db, periodStart);
    console.log(`source: ${dbFile}`);
    console.log(`period_start: ${periodStart} (${new Date(periodStart).toISOString()})`);
    console.log(`invoices created: ${result.created}`);
    console.log(`invoices skipped (already exist): ${result.skipped}`);
    console.log("idempotent: re-running is safe (existing invoices are not duplicated).");
  }
} catch (err) {
  console.error(`invoice generation aborted: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
