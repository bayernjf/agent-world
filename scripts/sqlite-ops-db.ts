/**
 * Shared fail-loud guard for the operator CLIs that only understand SQLite.
 * Users: root scripts (prune-events.ts, migrate-down.ts) and the
 * packages/server ops CLIs (backfill-usage, generate-invoices, prune-demo-users,
 * reset-password, rotate-reencrypt; migrate-to-postgres opts out of the driver
 * check because writing to PostgreSQL is its whole point).
 *
 * Both ways this used to go wrong are silent:
 *   - node:sqlite creates a missing file, so a typo'd path pruned/backfilled 0
 *     rows and reported success — and run from the repo root it hits the empty
 *     ghost DB that already caused a server incident (handoff Known issues).
 *   - these tools cannot work on PostgreSQL (openDb is createSqliteDriver, and
 *     migrations' `down` steps are sqlite DDL), so under DB_DRIVER=postgres
 *     they would quietly operate on the wrong store while a SaaS deployment's
 *     real data stayed untouched. reset-password was the sharpest case: it
 *     printed a one-time password that cannot log into production.
 *
 * Hence: refuse on postgres, and require a file that already exists.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = resolve(import.meta.dirname, "..");

export function resolveSqliteOpsFile(
  purpose: string,
  opts: { explicit?: string | null; requireSqliteDriver?: boolean } = {},
): string {
  const { explicit = null, requireSqliteDriver = true } = opts;

  if (requireSqliteDriver) {
    const driver = process.env.DB_DRIVER?.trim() || "sqlite";
    if (driver !== "sqlite") {
      console.error(
        `${purpose}: DB_DRIVER=${driver} is not supported. This tool is SQLite-only; ` +
          `there is no PostgreSQL equivalent for it yet (see docs/design-postgres-migration.md).`,
      );
      process.exit(1);
    }
  }

  // Precedence: an explicit --db flag, then DB_FILE, then the real database
  // under packages/server (never the repo-root ghost).
  const file = resolve(explicit ?? process.env.DB_FILE ?? join(REPO_ROOT, "packages/server/agent-world.sqlite"));
  if (!existsSync(file)) {
    console.error(
      `${purpose}: no database at ${file}. Set DB_FILE explicitly rather than ` +
        `letting this create an empty database and report a clean no-op.`,
    );
    process.exit(1);
  }
  return file;
}

export function openSqliteOpsDb(purpose: string): { db: DatabaseSync; file: string } {
  const file = resolveSqliteOpsFile(purpose);
  return { db: new DatabaseSync(file), file };
}
