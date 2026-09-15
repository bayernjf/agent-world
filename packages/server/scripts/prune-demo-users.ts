/**
 * Expired demo-user prune CLI (design-demo-user §8, D5).
 *
 * Deletes demo accounts whose demo_expires_at is in the past, cascading every
 * user-scoped row (graphs/runs/artifacts/…). A claimed (converted) account has
 * is_demo=0 and is never selected, and deleteUserCascade re-checks is_demo=1
 * before touching any child table, so real accounts are safe by construction.
 *
 * Safe by default: runs in DRY-RUN unless --apply is passed.
 *
 * Usage:
 *   DB_FILE=/var/lib/agent-world/agent-world.sqlite \
 *   pnpm --filter @agent-world/server exec tsx scripts/prune-demo-users.ts            # dry run
 *   pnpm --filter @agent-world/server exec tsx scripts/prune-demo-users.ts --apply    # really delete
 *   ... --db=/path/to.sqlite                  # explicit file (overrides DB_FILE)
 */
import { openDb } from "../src/db.js";

const args = process.argv.slice(2);
const apply = args.some((a) => a === "--apply");
const dbArg = args.find((a) => a.startsWith("--db="))?.slice("--db=".length);
const dbFile = dbArg ?? process.env.DB_FILE ?? "agent-world.sqlite";

const db = openDb(dbFile);

try {
  const nowIso = new Date().toISOString();
  const expired = await db.listExpiredDemoUsers(nowIso);

  console.log(`source: ${dbFile}`);
  console.log(`mode: ${apply ? "APPLY (deleting)" : "dry-run (no changes; pass --apply to delete)"}`);
  console.log(`expired demo users as of ${nowIso}: ${expired.length}`);

  let deleted = 0;
  for (const u of expired) {
    console.log(`  - ${u.id} ${u.email} expiredAt=${u.demo_expires_at ?? "null"}`);
    if (!apply) continue;
    const changes = await db.deleteUserCascade(u.id);
    if (changes === 1) deleted += 1;
    else console.warn(`    ! skipped: row is no longer a demo account (changes=${changes})`);
  }

  if (apply) {
    console.log(`deleted ${deleted} expired demo account(s) and all their cascaded rows.`);
  } else {
    console.log("dry-run complete; nothing was deleted.");
  }
} catch (err) {
  console.error(`demo prune aborted: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
