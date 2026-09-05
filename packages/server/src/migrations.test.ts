import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_RETENTION, openDb, SCHEMA_VERSION } from "./db.js";

function cols(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
}

describe("migration logging", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-mig-log-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("logs one line per applied migration plus a summary (P3 logging)", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true as never);
    // A pre-migration database forces several migrations to actually run.
    const file = join(dir, "old.sqlite");
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE graphs (id TEXT PRIMARY KEY, name TEXT NOT NULL, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, graph_id TEXT NOT NULL, snapshot TEXT NOT NULL,
        status TEXT NOT NULL, budget_usd REAL, started_at INTEGER NOT NULL, ended_at INTEGER);
      CREATE TABLE events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL,
        version INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (run_id, seq));
      CREATE TABLE node_runs (run_id TEXT NOT NULL, node_id TEXT NOT NULL, attempt INTEGER NOT NULL,
        status TEXT NOT NULL, output TEXT, error TEXT, tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, node_id, attempt));
    `);
    old.close();
    openDb(file).close();

    const lines = write.mock.calls.map((c) => String(c[0])).join("");
    const applied = lines.match(/"msg":"migration applied"/g) ?? [];
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(lines).toContain('"msg":"migrations complete"');
    // Reopening an already-current database logs no migration lines.
    write.mockClear();
    openDb(file).close();
    const reopen = write.mock.calls.map((c) => String(c[0])).join("");
    expect(reopen).not.toContain("migration applied");
    expect(reopen).not.toContain("migrations complete");
  });
});

describe("ordered schema migrations", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-mig-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("baselines a fresh database at the latest version without running ALTERs", () => {
    const file = join(dir, "fresh.sqlite");
    openDb(file);
    const raw = new DatabaseSync(file);
    expect(cols(raw, "runs")).toContain("trigger");
    expect(cols(raw, "node_runs")).toContain("units_json");
    const max = raw.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as {
      v: number;
    };
    expect(max.v).toBe(SCHEMA_VERSION);
    raw.close();
  });

  it("upgrades a pre-variant database whose artifacts table lacks the variant column", () => {
    // Regression for a F1-era upgrade crash: an old DB whose `artifacts` table
    // EXISTED but predated the `variant` column (and whose node_runs predated
    // it too) used to die inside startup DDL — `CREATE TABLE IF NOT EXISTS`
    // skipped the existing table, then `idx_artifacts_variant ON artifacts(...)
    // variant` referenced the missing column → "no such column: variant"
    // before migration 27 could add it. The old-column case is the real one:
    // a database with NO artifacts table is rebuilt fresh and never hits it.
    const file = join(dir, "old-artifacts.sqlite");
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE graphs (id TEXT PRIMARY KEY, name TEXT NOT NULL, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, graph_id TEXT NOT NULL, snapshot TEXT NOT NULL,
        status TEXT NOT NULL, budget_usd REAL, started_at INTEGER NOT NULL, ended_at INTEGER);
      CREATE TABLE events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL,
        version INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (run_id, seq));
      CREATE TABLE node_runs (run_id TEXT NOT NULL, node_id TEXT NOT NULL, attempt INTEGER NOT NULL,
        status TEXT NOT NULL, output TEXT, error TEXT, tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, node_id, attempt));
      -- artifacts predates the variant dimension (migration 27): the table
      -- exists but has NO variant column.
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id TEXT, node_id TEXT NOT NULL,
        attempt INTEGER, kind TEXT NOT NULL, mime_type TEXT, label TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0, storage TEXT NOT NULL, uri TEXT,
        created_at INTEGER NOT NULL);
    `);
    old.close();

    expect(() => openDb(file)).not.toThrow();
    const raw = new DatabaseSync(file);
    expect(cols(raw, "artifacts")).toContain("variant");
    expect(cols(raw, "node_runs")).toContain("variant");
    const idx = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_artifacts_variant'")
      .get();
    expect(idx).toBeTruthy();
    const max = raw.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    expect(max.v).toBe(SCHEMA_VERSION);
    // Data written into the pre-existing artifacts table survives the upgrade
    // (openDb must not drop or rebuild it).
    raw.close();
  });

  it("preserves rows already in a pre-variant artifacts table across the upgrade", () => {
    const file = join(dir, "old-artifacts-rows.sqlite");
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE graphs (id TEXT PRIMARY KEY, name TEXT NOT NULL, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, graph_id TEXT NOT NULL, snapshot TEXT NOT NULL,
        status TEXT NOT NULL, budget_usd REAL, started_at INTEGER NOT NULL, ended_at INTEGER);
      CREATE TABLE events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL,
        version INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (run_id, seq));
      CREATE TABLE node_runs (run_id TEXT NOT NULL, node_id TEXT NOT NULL, attempt INTEGER NOT NULL,
        status TEXT NOT NULL, output TEXT, error TEXT, tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, node_id, attempt));
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id TEXT, node_id TEXT NOT NULL,
        attempt INTEGER, kind TEXT NOT NULL, mime_type TEXT, label TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0, storage TEXT NOT NULL, uri TEXT,
        created_at INTEGER NOT NULL);
      INSERT INTO artifacts (id, run_id, user_id, node_id, kind, storage, created_at)
        VALUES ('a-1', 'r-1', 'u-1', 'n-1', 'text', 'inline', 1000);
      INSERT INTO runs (id, graph_id, snapshot, status, started_at) VALUES ('r-1','g-1','{}','done',1);
    `);
    old.close();

    openDb(file);
    const raw = new DatabaseSync(file);
    const row = raw
      .prepare("SELECT id, run_id, kind, variant FROM artifacts")
      .get() as { id: string; run_id: string; kind: string; variant: string };
    raw.close();
    expect(row).toMatchObject({ id: "a-1", run_id: "r-1", kind: "text" });
    expect(row.variant).toBe("main");
  });

  it("upgrades an old (pre-migration) database by adding missing columns", () => {
    const file = join(dir, "old.sqlite");
    // Simulate a Phase 0 database: runs/node_runs without columns added later.
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE graphs (id TEXT PRIMARY KEY, name TEXT NOT NULL, doc TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, graph_id TEXT NOT NULL, snapshot TEXT NOT NULL,
        status TEXT NOT NULL, budget_usd REAL, started_at INTEGER NOT NULL, ended_at INTEGER);
      CREATE TABLE events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL,
        version INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (run_id, seq));
      CREATE TABLE node_runs (run_id TEXT NOT NULL, node_id TEXT NOT NULL, attempt INTEGER NOT NULL,
        status TEXT NOT NULL, output TEXT, error TEXT, tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, node_id, attempt));
    `);
    old.close();

    openDb(file);
    const raw = new DatabaseSync(file);
    const runsCols = cols(raw, "runs");
    const nodeCols = cols(raw, "node_runs");
    raw.close();
    expect(runsCols).toContain("trigger");
    expect(runsCols).toContain("input");
    expect(nodeCols).toContain("reasoning");
    expect(nodeCols).toContain("error_code");
    expect(nodeCols).toContain("cached_tokens");
    expect(nodeCols).toContain("reasoning_tokens");
    expect(nodeCols).toContain("units_json");
    expect(nodeCols).toContain("variant");

    // Reopening is a no-op (no duplicate columns, no errors).
    expect(() => openDb(file)).not.toThrow();
  });
});

describe("startup database backup", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-backup-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("snapshots an existing database into a backups/ folder on open", () => {
    const file = join(dir, "aw.sqlite");
    openDb(file).close();
    // The first open creates an empty database (nothing to back up); the
    // second open finds an existing file and snapshots it before migrations.
    openDb(file).close();
    const backupDir = join(dir, "backups");
    const first = readdirSync(backupDir);
    expect(first.filter((n) => n.startsWith("pre-migration-"))).toHaveLength(1);
    const snapshot = new DatabaseSync(join(backupDir, first[0]!));
    const tables = snapshot
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("events");
    snapshot.close();
  });

  it("prunes old snapshots beyond the retention window", () => {
    const file = join(dir, "aw.sqlite");
    let db = openDb(file);
    for (let i = 0; i < BACKUP_RETENTION + 2; i++) {
      db.close();
      db = openDb(file);
    }
    db.close();
    const backups = readdirSync(join(dir, "backups")).filter((n) =>
      n.startsWith("pre-migration-"),
    );
    expect(backups.length).toBeLessThanOrEqual(BACKUP_RETENTION);
  });
});
