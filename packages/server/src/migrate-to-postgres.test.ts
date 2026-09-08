import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.js";
import { ddlTableNames, migrateToPostgres } from "./migrate-to-postgres.js";

/**
 * Dry-run plan tests (no PostgreSQL needed — design-postgres-migration.md §6.1):
 * the plan is derived purely from the SQLite side, so we can guard table
 * discovery, the FTS skip, and the empty-source fail-closed without a server.
 */

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-migrate-pg-"));
  tmpDirs.push(dir);
  return dir;
}

describe("migrate-to-postgres dry-run plan", () => {
  it("ddlTableNames extracts the full schema (sanity: 20+ tables)", () => {
    const names = ddlTableNames();
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(names).toContain("users");
    expect(names).toContain("graphs");
    expect(names).toContain("runs");
  });

  it("dry-run plans every DDL table as migratable with zero rows on a fresh db", async () => {
    const dir = tmpDir();
    const dbFile = join(dir, "db.sqlite");
    const db = openDb(dbFile);
    await db.close();

    const report = await migrateToPostgres({ dbFile, pgConfig: {}, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.snapshot).toBeNull();
    const migratable = report.tables.filter((t) => t.skipped === null);
    // Every table the PG schema knows about is planned for copy.
    for (const name of ddlTableNames()) {
      const entry = report.tables.find((t) => t.table === name);
      expect(entry, `missing table in plan: ${name}`).toBeDefined();
      expect(entry?.skipped).toBeNull();
      expect(entry?.sqliteRows).toBe(0);
    }
    // No FTS companions on a fresh db (memory backend not initialized).
    expect(report.tables.some((t) => t.table.startsWith("knowledge"))).toBe(false);
  });

  it("dry-run skips the knowledge FTS tables loudly when present", async () => {
    const dir = tmpDir();
    const dbFile = join(dir, "db.sqlite");
    const db = openDb(dbFile);
    // Minimal FTS5 companion the memory backend would have created.
    // (parens matter: driver.prepare is async — await must bind to the
    // statement, not to the trailing .run() call)
    (await (db as any).prepare("CREATE VIRTUAL TABLE knowledge_fts USING fts5(title, content, tags)")).run();
    await db.close();

    const report = await migrateToPostgres({ dbFile, pgConfig: {}, dryRun: true });
    const fts = report.tables.find((t) => t.table === "knowledge_fts");
    expect(fts).toBeDefined();
    expect(fts?.skipped).toMatch(/SQLite-only FTS5/);
  });

  it("fails closed on a missing or empty source file", async () => {
    const dir = tmpDir();
    const missing = join(dir, "nope.sqlite");
    await expect(migrateToPostgres({ dbFile: missing, pgConfig: {}, dryRun: true })).rejects.toThrow(/not found/);

    const empty = join(dir, "empty.sqlite");
    writeFileSync(empty, "");
    await expect(migrateToPostgres({ dbFile: empty, pgConfig: {}, dryRun: true })).rejects.toThrow(/empty/);
  });
});
