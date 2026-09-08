/**
 * SQLite → PostgreSQL data migration (design-postgres-migration.md §6.1 方案 A).
 *
 * Reads every user table from the SQLite source, applies the PG schema
 * (derived from the shared DDL via `toPgDdl`), streams rows over as batched
 * parameterized INSERTs, and verifies row counts per table. Before touching
 * anything it takes a `VACUUM INTO` snapshot of the source — that snapshot is
 * the rollback base (§7: the migration is one-way; rollback = restore the
 * snapshot + DB_DRIVER=sqlite).
 *
 * Modes:
 *  - default: snapshot → schema → copy → verify
 *  - --dry-run: no PG connection at all; prints the per-table plan from the
 *    SQLite side (row counts + which tables map to the PG schema and which
 *    are SQLite-only, e.g. FTS5 companions)
 *  - --verify-only: row-count comparison only, no writes
 *
 * Known boundaries (mirrored in the PG driver): the knowledge base FTS5
 * tables are SQLite-only and are skipped loudly; encrypted columns are copied
 * verbatim — decryptability is verified at runtime after the switch (§6.2
 * step 4), not by this script.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Client, type ClientConfig } from "pg";
import { toPgDdl } from "./pg-sql.js";
import { DDL } from "./sqlite-driver.js";

/** Tables created by the DDL constant — the set the PG schema knows about. */
export function ddlTableNames(): string[] {
  const names = [...DDL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!);
  if (names.length === 0) throw new Error("DDL table-name extraction failed — regex out of sync with DDL");
  return names;
}

function isFtsCompanion(name: string): boolean {
  // FTS5 virtual table + its shadow tables (knowledge_fts, knowledge_fts_data,
  // knowledge_fts_idx, knowledge_fts_content, knowledge_fts_docsize,
  // knowledge_fts_config) plus the regular knowledge table they index.
  return name === "knowledge" || name.startsWith("knowledge_fts");
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface TableMigration {
  table: string;
  sqliteRows: number;
  pgRows: number | null;
  copied: number;
  skipped: string | null;
}

export interface MigrationReport {
  sqliteFile: string;
  snapshot: string | null;
  dryRun: boolean;
  verifyOnly: boolean;
  tables: TableMigration[];
}

export interface MigrateOptions {
  dbFile: string;
  pgConfig: ClientConfig;
  dryRun?: boolean;
  verifyOnly?: boolean;
}

/** Snapshot timestamp suffix, e.g. 20260908T101530Z. */
function snapshotStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function sqliteTableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function countSqlite(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`).get() as { c: number }).c;
}

async function pgTableExists(client: Client, table: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return res.rowCount === 1;
}

async function countPg(client: Client, table: string): Promise<number> {
  const res = await client.query(`SELECT COUNT(*)::int AS c FROM ${quoteIdent(table)}`);
  return res.rows[0].c;
}

/** Stream one table's rows into PG in parameterized batches. */
async function copyTable(db: DatabaseSync, client: Client, table: string, chunk = 200): Promise<number> {
  const stmt = db.prepare(`SELECT * FROM ${quoteIdent(table)}`);
  const columns = stmt.columns().map((c) => c.name);
  const quotedCols = columns.map(quoteIdent).join(", ");
  let copied = 0;
  let batch: unknown[][] = [];
  for (const row of stmt.iterate() as IterableIterator<Record<string, unknown>>) {
    batch.push(columns.map((c) => row[c]));
    if (batch.length >= chunk) {
      copied += await insertBatch(client, table, quotedCols, columns.length, batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    copied += await insertBatch(client, table, quotedCols, columns.length, batch);
  }
  return copied;
}

async function insertBatch(
  client: Client,
  table: string,
  quotedCols: string,
  colCount: number,
  batch: unknown[][],
): Promise<number> {
  // Multi-row VALUES with flattened $n placeholders: one round trip per chunk.
  const values: string[] = [];
  const params: unknown[] = [];
  batch.forEach((row, i) => {
    const ph = row.map((_, j) => `$${i * colCount + j + 1}`);
    values.push(`(${ph.join(", ")})`);
    params.push(...row);
  });
  const sql = `INSERT INTO ${quoteIdent(table)} (${quotedCols}) VALUES ${values.join(", ")}`;
  const res = await client.query(sql, params);
  return res.rowCount ?? 0;
}

export async function migrateToPostgres(opts: MigrateOptions): Promise<MigrationReport> {
  const { dbFile, dryRun = false, verifyOnly = false } = opts;
  if (!existsSync(dbFile)) throw new Error(`SQLite source not found: ${dbFile}`);
  if (statSync(dbFile).size === 0) throw new Error(`SQLite source is empty (0 bytes): ${dbFile}`);

  const db = new DatabaseSync(dbFile);
  const report: MigrationReport = { sqliteFile: dbFile, snapshot: null, dryRun, verifyOnly, tables: [] };
  const pgTables = new Set(ddlTableNames());

  try {
    if (dryRun) {
      for (const table of sqliteTableNames(db)) {
        const skipped = isFtsCompanion(table)
          ? "SQLite-only FTS5 knowledge base (no PG backend yet)"
          : pgTables.has(table)
            ? null
            : "not in the PG schema (DDL) — would be skipped";
        report.tables.push({ table, sqliteRows: countSqlite(db, table), pgRows: null, copied: 0, skipped });
      }
      return report;
    }

    // Rollback base first (§7): the snapshot must exist before any PG write.
    const snapshot = join(dirname(dbFile), `agent-world-pre-pg-migration-${snapshotStamp()}.sqlite`);
    db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    report.snapshot = snapshot;

    const client = new Client(opts.pgConfig);
    await client.connect();
    try {
      if (!verifyOnly) await client.query(toPgDdl(DDL));
      for (const table of sqliteTableNames(db)) {
        if (isFtsCompanion(table)) {
          report.tables.push({ table, sqliteRows: countSqlite(db, table), pgRows: null, copied: 0, skipped: "SQLite-only FTS5 knowledge base (no PG backend yet)" });
          continue;
        }
        if (!(await pgTableExists(client, table))) {
          report.tables.push({ table, sqliteRows: countSqlite(db, table), pgRows: null, copied: 0, skipped: "not in the PG schema (DDL)" });
          continue;
        }
        const sqliteRows = countSqlite(db, table);
        const copied = verifyOnly ? 0 : await copyTable(db, client, table);
        const pgRows = await countPg(client, table);
        report.tables.push({ table, sqliteRows, pgRows, copied, skipped: null });
      }
    } finally {
      await client.end();
    }
    return report;
  } finally {
    db.close();
  }
}
