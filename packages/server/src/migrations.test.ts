import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_RETENTION, openDb, rollbackLatestMigration, SCHEMA_VERSION } from "./db.js";

function cols(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
}

function tables(db: DatabaseSync): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);
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

  it("baselines a fresh database at the latest version without running ALTERs", async () => {
    const file = join(dir, "fresh.sqlite");
    openDb(file);
    const raw = new DatabaseSync(file);
    expect(await cols(raw, "runs")).toContain("trigger");
    expect(await cols(raw, "node_runs")).toContain("units_json");
    const max = raw.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as {
      v: number;
    };
    expect(max.v).toBe(SCHEMA_VERSION);
    raw.close();
  });

  it("baselines Stripe mirror columns + indexes on a fresh database (migration 39)", () => {
    const file = join(dir, "fresh-stripe.sqlite");
    openDb(file);
    const raw = new DatabaseSync(file);
    expect(cols(raw, "subscriptions")).toEqual(
      expect.arrayContaining([
        "stripe_customer_id",
        "stripe_subscription_id",
        "stripe_price_id",
      ]),
    );
    expect(cols(raw, "invoices")).toContain("stripe_invoice_id");
    for (const idx of [
      "idx_subscriptions_stripe_customer",
      "idx_subscriptions_stripe_sub",
      "idx_invoices_stripe_invoice",
    ]) {
      expect(
        raw
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
          .get(idx),
      ).toBeTruthy();
    }
    raw.close();
  });

  it("baselines the remote_jobs table + open-job partial index on a fresh database (migration 41)", () => {
    const file = join(dir, "fresh-remote-jobs.sqlite");
    openDb(file);
    const raw = new DatabaseSync(file);
    expect(tables(raw)).toContain("remote_jobs");
    expect(cols(raw, "remote_jobs")).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "run_id",
        "graph_id",
        "node_id",
        "attempt",
        "kind",
        "provider",
        "remote_job_id",
        "state",
        "submitted_at",
        "last_polled_at",
        "finished_at",
        "error_code",
        "meta_json",
      ]),
    );
    // Partial index backing the reattach hot path; the WHERE predicate must survive.
    const idx = raw
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_remote_jobs_open'")
      .get() as { name: string; sql: string } | undefined;
    expect(idx).toBeTruthy();
    expect(idx?.sql).toContain("state IN");
    // A fresh database baselines at the latest schema version.
    const max = raw.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    expect(max.v).toBe(SCHEMA_VERSION);
    raw.close();
  });

  it("upgrades a v38 database whose subscriptions/invoices predate the Stripe mirror columns (migration 39)", () => {
    // Regression for an S6 upgrade crash: a DB already at v38 HAS subscriptions
    // (built at v34 without stripe columns) and invoices (built at v38 without
    // stripe_invoice_id). The base DDL runs before migrations and uses
    // CREATE TABLE IF NOT EXISTS, so it skipped those tables — then the inline
    // `CREATE INDEX ... ON subscriptions(stripe_customer_id)` died with
    // "no such column" before migration 39 could ALTER the column in. Those
    // indexes must therefore be (re)built only after migrations settle.
    const file = join(dir, "old-v38-stripe.sqlite");
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE subscriptions (
        user_id TEXT PRIMARY KEY, plan TEXT NOT NULL, status TEXT NOT NULL,
        provider TEXT, external_id TEXT,
        current_period_start INTEGER NOT NULL, current_period_end INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE invoices (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
        period_start INTEGER NOT NULL, period_end INTEGER NOT NULL, plan TEXT NOT NULL,
        amount_usd REAL NOT NULL, status TEXT NOT NULL, line_items TEXT NOT NULL DEFAULT '[]',
        paid_at INTEGER, paid_method TEXT, notes TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO subscriptions (user_id, plan, status, current_period_start, current_period_end, created_at, updated_at)
        VALUES ('u-1', 'pro', 'active', 0, 1, 10, 11);
    `);
    for (let v = 1; v <= 38; v++) {
      old.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(v, 1);
    }
    old.close();

    expect(() => openDb(file)).not.toThrow();
    const raw = new DatabaseSync(file);
    expect(cols(raw, "subscriptions")).toEqual(
      expect.arrayContaining([
        "stripe_customer_id",
        "stripe_subscription_id",
        "stripe_price_id",
      ]),
    );
    expect(cols(raw, "invoices")).toContain("stripe_invoice_id");
    for (const idx of [
      "idx_subscriptions_stripe_customer",
      "idx_subscriptions_stripe_sub",
      "idx_invoices_stripe_invoice",
    ]) {
      expect(
        raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(idx),
      ).toBeTruthy();
    }
    // The pre-existing subscription row survives the upgrade.
    const row = raw.prepare("SELECT plan, stripe_customer_id FROM subscriptions WHERE user_id='u-1'").get() as {
      plan: string;
      stripe_customer_id: null;
    };
    expect(row.plan).toBe("pro");
    expect(row.stripe_customer_id).toBeNull();
    const max = raw.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    expect(max.v).toBe(SCHEMA_VERSION);
    raw.close();
  });

  it("upgrades a pre-variant database whose artifacts table lacks the variant column", async () => {
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
    expect(await cols(raw, "artifacts")).toContain("variant");
    expect(await cols(raw, "node_runs")).toContain("variant");
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

  it("upgrades an old (pre-migration) database by adding missing columns", async () => {
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
    const runsCols = await cols(raw, "runs");
    const nodeCols = await cols(raw, "node_runs");
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

  it("prunes old snapshots beyond the retention window", async () => {
    const file = join(dir, "aw.sqlite");
    let db = openDb(file);
    for (let i = 0; i < BACKUP_RETENTION + 2; i++) {
      await db.close();
      db = openDb(file);
    }
    await db.close();
    const backups = readdirSync(join(dir, "backups")).filter((n) =>
      n.startsWith("pre-migration-"),
    );
    expect(backups.length).toBeLessThanOrEqual(BACKUP_RETENTION);
  });
});

describe("migration rollback (down)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-mig-down-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rolls back the latest migrations in order (41 remote_jobs -> 40 demo flags -> 39 stripe)", () => {
    const file = join(dir, "aw.sqlite");
    openDb(file).close(); // applies every migration, up to SCHEMA_VERSION

    const raw = new DatabaseSync(file);
    // Pre-rollback: v41 remote_jobs, v40 demo flags, v39 Stripe columns, v38 invoices all present.
    expect(tables(raw)).toContain("remote_jobs");
    expect(cols(raw, "users")).toContain("is_demo");
    expect(cols(raw, "users")).toContain("demo_expires_at");
    expect(cols(raw, "subscriptions")).toContain("stripe_customer_id");
    expect(tables(raw)).toContain("invoices");
    expect(cols(raw, "graphs")).toContain("park_x");
    // Seed a flagged demo row; v40 down must clear the flag without dropping the column.
    raw.exec(
      `INSERT INTO users (id,email,password_hash,role,is_demo,demo_expires_at,created_at)
       VALUES ('u1','d@demo.local','x','user',1,'2026-01-01T00:00:00.000Z',0)`,
    );

    // Step 1 -> v41: drops remote_jobs only; demo flags and Stripe columns survive.
    const step1 = rollbackLatestMigration(raw);
    expect(step1?.version).toBe(SCHEMA_VERSION);
    expect(tables(raw)).not.toContain("remote_jobs");
    expect(cols(raw, "users")).toContain("is_demo");
    const stillFlagged = raw.prepare(`SELECT is_demo FROM users WHERE id='u1'`).get() as { is_demo: number };
    expect(stillFlagged.is_demo).toBe(1);
    expect(cols(raw, "subscriptions")).toContain("stripe_customer_id");

    // Step 2 -> v40: clears demo flags but keeps the columns; Stripe columns survive.
    const step2 = rollbackLatestMigration(raw);
    expect(step2?.version).toBe(SCHEMA_VERSION - 1);
    expect(cols(raw, "users")).toContain("is_demo");
    const cleared = raw.prepare(`SELECT is_demo FROM users WHERE id='u1'`).get() as { is_demo: number };
    expect(cleared.is_demo).toBe(0);
    expect(cols(raw, "subscriptions")).toContain("stripe_customer_id");

    // Step 3 -> v39: drops the Stripe mirror columns; the invoices table and park columns survive.
    const step3 = rollbackLatestMigration(raw);
    expect(step3?.version).toBe(SCHEMA_VERSION - 2);
    expect(cols(raw, "subscriptions")).not.toContain("stripe_customer_id");
    expect(cols(raw, "subscriptions")).not.toContain("stripe_subscription_id");
    expect(cols(raw, "subscriptions")).not.toContain("stripe_price_id");
    expect(cols(raw, "invoices")).not.toContain("stripe_invoice_id");
    expect(tables(raw)).toContain("invoices");
    expect(cols(raw, "graphs")).toContain("park_x");
    expect(cols(raw, "graphs")).toContain("park_z");
    raw.close();
  });
});
