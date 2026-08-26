import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKUP_RETENTION, openDb, SCHEMA_VERSION } from "./db.js";

function cols(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
}

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
