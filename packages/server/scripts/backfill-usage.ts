/**
 * Usage-ledger backfill CLI (M2 §S3, design-monetization-m2-implementation).
 *
 * Recomputes every (user, billing-period) usage total straight from finished
 * runs and OVERWRITES usage_ledger (idempotent — safe to re-run). Run once
 * after deploying M2 so existing users' past consumption is visible to the
 * gate and the usage panel. Storage is a live snapshot and is not backfilled.
 *
 * Usage:
 *   DB_FILE=/path/to/agent-world.sqlite \
 *   pnpm --filter @agent-world/server exec tsx scripts/backfill-usage.ts [--since=<epoch-ms>] [--dry-run]
 */
import { openDb } from "../src/db.js";
import { backfillUsage } from "../src/usage-backfill.js";

const args = process.argv.slice(2);
const dryRun = args.some((a) => a === "--dry-run");
const sinceArg = args.find((a) => a.startsWith("--since="))?.slice("--since=".length);
const since = sinceArg ? Number(sinceArg) : 0;

const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
const db = openDb(dbFile);

try {
  if (dryRun) {
    // Dry run: aggregate but never write. Reuse the same scan, report counts.
    const runs = await db.listFinishedRunsSince(since);
    console.log(`[dry-run] source: ${dbFile}`);
    console.log(`[dry-run] finished runs since ${since}: ${runs.length}`);
    console.log(`[dry-run] distinct users: ${new Set(runs.map((r) => r.userId)).size}`);
    console.log(`[dry-run] no ledger rows written`);
  } else {
    const result = await backfillUsage(db, {
      since,
      onProgress: (done, total) => {
        if (done % 50 === 0 || done === total) process.stderr.write(`\rbackfilled ${done}/${total} runs`);
      },
    });
    process.stderr.write("\n");
    console.log(`source: ${dbFile}`);
    console.log(
      `runs processed: ${result.runsProcessed} · users: ${result.users} · (user,period) buckets written: ${result.periodsWritten}`,
    );
    console.log("usage_ledger overwritten from node_runs; re-running is safe (idempotent).");
  }
} catch (err) {
  console.error(`usage backfill aborted: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
