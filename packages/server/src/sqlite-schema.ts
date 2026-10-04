/** Schema, migrations and migration tooling for the SQLite driver (audit P2 split).
 * DDL always creates the LATEST schema for fresh databases; MIGRATIONS only
 * upgrade older files. Moved verbatim from sqlite-driver.ts. */
import { type DatabaseSync } from "node:sqlite";
import { log } from "./logger.js";

export interface InvoiceRow {
  id: string;
  user_id: string;
  subscription_id: string;
  period_start: number;
  period_end: number;
  plan: string;
  amount_usd: number;
  status: string;
  line_items: string;
  paid_at: number | null;
  paid_method: string | null;
  stripe_invoice_id: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Events are the source of truth and append-only, so they get a plain prepared
 * insert rather than an ORM round trip. `(run_id, seq)` is the primary key, and
 * node runs are keyed by `(run_id, node_id, attempt)` — attempt is identity.
 * Exported so the PgDriver can derive its own schema via `toPgDdl` (see
 * pg-sql.ts).
 */

export const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  is_demo       INTEGER NOT NULL DEFAULT 0,
  demo_expires_at TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
-- idx_users_owner is NOT here on purpose: the role column is only added by
-- migration 31 for pre-RBAC databases, and an index in this DDL runs before
-- migrations -- an older file dies in db.exec(DDL) with "no such column: role".
-- Its one definition is OWNER_UNIQUE_INDEX, executed from POST_MIGRATION_INDEXES
-- (SQLite, after migrations) and by createPgDriver (PG, which runs no migration).

-- NOTE: keep this CREATE TABLE free of inline "--" comments. node:sqlite's
-- ALTER TABLE DROP COLUMN rebuilds the table from the stored sqlite_master SQL
-- and mis-parses a line comment sitting next to the dropped column ("incomplete
-- input"). Put any column notes above the statement, not inside its body.
-- origin_template_id: template-instance reset anchor (migration 18 historically;
-- present in the latest schema so PG DDL derivation sees it).
-- park_x/park_z: RTS stage-B macro-park position (migration 37 historically).
-- NULL = not laid out (frontend auto-layouts); a stored pair is the manual
-- parkLayout() override. View-layer preference only: kept out of
-- doc/version/content_hash and never bumps updated_at (design B1.2/B1.5).
CREATE TABLE IF NOT EXISTS graphs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  name       TEXT NOT NULL,
  doc        TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  origin_template_id TEXT,
  park_x REAL,
  park_z REAL
);

CREATE TABLE IF NOT EXISTS runs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  graph_id   TEXT NOT NULL,
  snapshot   TEXT NOT NULL,
  status     TEXT NOT NULL,
  trigger    TEXT NOT NULL DEFAULT 'manual',
  input      TEXT,
  budget_usd REAL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  ab_group   TEXT,
  ab_arm     TEXT,
  ab_target  TEXT,
  halted_node_id TEXT,
  halted_reason  TEXT,
  batch_id      TEXT,
  batch_item_id TEXT
);

CREATE TABLE IF NOT EXISTS events (
  run_id  TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  ts      INTEGER NOT NULL,
  version INTEGER NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  user_id     TEXT,
  node_id     TEXT NOT NULL,
  attempt     INTEGER,
  variant     TEXT NOT NULL DEFAULT 'main',
  kind        TEXT NOT NULL,
  mime_type   TEXT,
  label       TEXT,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  storage     TEXT NOT NULL,
  uri         TEXT,
  created_at  INTEGER NOT NULL,
  -- pipeline attribution (migration 13 historically; part of the latest
  -- schema so PG derivation sees it). idx_artifacts_graph stays OUT of this
  -- DDL on purpose: DDL runs before migrations and an older file without
  -- graph_id would die in db.exec(DDL) on the index (same reason as
  -- idx_artifacts_variant below).
  graph_id    TEXT,
  role        TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_node ON artifacts(run_id, node_id);
-- idx_artifacts_variant is NOT here on purpose: the variant column is only
-- added by migration 27 for pre-variant databases, and an index in this DDL
-- runs before migrations -- an older file dies in db.exec(DDL) with
-- "no such column: variant" before migration 27 can add it. The index is
-- created in migration 27 (and by its baselining detect for fresh DBs).

CREATE TABLE IF NOT EXISTS node_runs (
  run_id         TEXT NOT NULL,
  node_id        TEXT NOT NULL,
  attempt        INTEGER NOT NULL,
  variant        TEXT NOT NULL DEFAULT 'main',
  status         TEXT NOT NULL,
  output         TEXT,
  reasoning      TEXT,
  error          TEXT,
  error_code     TEXT,
  tokens_in      INTEGER NOT NULL DEFAULT 0,
  tokens_out     INTEGER NOT NULL DEFAULT 0,
  cached_tokens  INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  units_json     TEXT,
  model          TEXT,
  score          REAL,
  PRIMARY KEY (run_id, node_id, attempt, variant)
);

CREATE TABLE IF NOT EXISTS brand_terms (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  term        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS banned_terms (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  term        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  sku             TEXT NOT NULL DEFAULT '',
  name            TEXT NOT NULL,
  brand           TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  price           REAL,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  images_json     TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id, status);

CREATE TABLE IF NOT EXISTS brand_assets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  type        TEXT NOT NULL,
  label       TEXT NOT NULL,
  uri         TEXT NOT NULL DEFAULT '',
  tags_json   TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brand_assets_user ON brand_assets(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS batch_jobs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  graph_id      TEXT NOT NULL,
  status        TEXT NOT NULL,
  total         INTEGER NOT NULL DEFAULT 0,
  succeeded     INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  source_name   TEXT,
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_user ON batch_jobs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS batch_items (
  id                TEXT PRIMARY KEY,
  batch_id          TEXT NOT NULL,
  row_index         INTEGER NOT NULL,
  input_json        TEXT NOT NULL,
  run_id            TEXT,
  status            TEXT NOT NULL,
  output_summary    TEXT,
  artifact_ids_json TEXT,
  error             TEXT
);
CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items(batch_id, row_index);

CREATE TABLE IF NOT EXISTS content_plan (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  graph_id      TEXT,
  run_id        TEXT,
  artifact_id   TEXT,
  platform      TEXT,
  title         TEXT,
  scheduled_at  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  published_url TEXT,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_plan_time ON content_plan(user_id, scheduled_at);

CREATE TABLE IF NOT EXISTS content_metrics (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT,
  graph_id            TEXT,
  run_id              TEXT,
  node_id             TEXT,
  variant             TEXT,
  artifact_id         TEXT,
  product_id          TEXT,
  platform            TEXT,
  external_content_id TEXT,
  impressions         INTEGER DEFAULT 0,
  clicks              INTEGER DEFAULT 0,
  conversions         INTEGER DEFAULT 0,
  gmv                 REAL DEFAULT 0,
  ad_spend            REAL DEFAULT 0,
  recorded_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_content ON content_metrics(artifact_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_metrics_user ON content_metrics(user_id, recorded_at);

CREATE TABLE IF NOT EXISTS content_costs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  artifact_id TEXT,
  product_id  TEXT,
  platform    TEXT,
  variant     TEXT,
  cost_usd    REAL DEFAULT 0,
  gmv         REAL DEFAULT 0,
  roi         REAL DEFAULT 0,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_costs_user ON content_costs(user_id, captured_at);

CREATE TABLE IF NOT EXISTS publish_targets (
  id               TEXT PRIMARY KEY,
  user_id          TEXT,
  platform         TEXT NOT NULL,
  name             TEXT,
  provider         TEXT NOT NULL,
  config_encrypted TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publish_targets_user ON publish_targets(user_id);

CREATE TABLE IF NOT EXISTS published_contents (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  graph_id     TEXT,
  run_id       TEXT,
  artifact_id  TEXT,
  platform     TEXT,
  status       TEXT NOT NULL,
  external_id  TEXT,
  external_url TEXT,
  published_at INTEGER,
  detail_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_published_user ON published_contents(user_id, published_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  object_type TEXT,
  object_id   TEXT,
  detail      TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS announcements (
  id          TEXT PRIMARY KEY,
  title_zh    TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  body_zh     TEXT,
  body_en     TEXT,
  level       TEXT NOT NULL DEFAULT 'info',
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER,
  target      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_window ON announcements(starts_at);

CREATE TABLE IF NOT EXISTS announcement_reads (
  user_id         TEXT NOT NULL,
  announcement_id TEXT NOT NULL,
  read_at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, announcement_id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  message         TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'other',
  context         TEXT NOT NULL,
  attachment      BLOB,
  attachment_mime TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_user_time ON feedback(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at);

CREATE TABLE IF NOT EXISTS graph_versions (
  id           TEXT PRIMARY KEY,
  graph_id     TEXT NOT NULL,
  name         TEXT NOT NULL,
  snapshot     TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graph_versions_graph ON graph_versions(graph_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  user_id    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_variables (
  graph_id   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (graph_id, key)
);
CREATE INDEX IF NOT EXISTS idx_graph_variables_graph ON graph_variables(graph_id);

-- Tables below were originally added by migrations (32-35) without updating
-- this DDL constant. They are part of the LATEST schema and must live here
-- too — the PostgreSQL schema is derived from this constant via toPgDdl, and a
-- fresh PG database created from a DDL missing them would silently lack
-- RBAC resource sharing and the commercialization tables. The corresponding
-- migrations stay (older files still need them); their detect baselines
-- skip fresh databases that already have the tables.
CREATE TABLE IF NOT EXISTS resource_access (
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  role          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (resource_type, resource_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_resource_access_user ON resource_access(user_id, resource_type);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                 TEXT PRIMARY KEY,
  plan                    TEXT NOT NULL,
  status                  TEXT NOT NULL,
  provider                TEXT,
  external_id             TEXT,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  stripe_price_id         TEXT,
  current_period_start    INTEGER NOT NULL,
  current_period_end      INTEGER NOT NULL,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);
-- NOTE: idx_subscriptions_stripe_customer / _sub are created in
-- runMigrations() (POST_MIGRATION_INDEXES), not here. subscriptions predates
-- those columns, and the base DDL runs before the v39 ALTER on an upgraded DB,
-- so an inline index over stripe_customer_id would crash boot ("no such
-- column"). A brand-new DB gets them from the same post-migration step.

-- P1 subscription-quota scaffolding, deliberately not written to yet. Metering
-- truth lives in node_runs; enabling quotas goes through the idempotent
-- backfill described in docs/design-monetization.md §P1. Do not delete.
CREATE TABLE IF NOT EXISTS usage_ledger (
  user_id        TEXT NOT NULL,
  period_start   INTEGER NOT NULL,
  metric         TEXT NOT NULL,
  amount         REAL NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, period_start, metric)
);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_user ON usage_ledger(user_id, period_start);

-- P2 billing invoices. One row per (user, billing-period). line_items is JSON
-- (MVP simplicity; split to invoice_items if line-item complexity grows).
-- status state machine: draft -> open -> paid | void.
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  period_start    INTEGER NOT NULL,
  period_end      INTEGER NOT NULL,
  plan            TEXT NOT NULL,
  amount_usd      REAL NOT NULL,
  status          TEXT NOT NULL,
  line_items      TEXT NOT NULL DEFAULT '[]',
  paid_at         INTEGER,
  paid_method     TEXT,
  stripe_invoice_id TEXT,
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(user_id, period_start);
-- idx_invoices_stripe_invoice is created post-migration too: a DB that
-- applied v38 before S6 has an invoices table without stripe_invoice_id when
-- the base DDL runs, so an inline index would crash the same way.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  run_id     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- G4 long-running async jobs (design-step-trace-and-robustness §3.5): a
-- durable handle to a provider-side job so a timed-out/restarted run can
-- reattach instead of re-submitting (and double-billing). Only video writes
-- today; kind/shape are reserved for image/audio.
CREATE TABLE IF NOT EXISTS remote_jobs (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  run_id         TEXT NOT NULL,
  graph_id       TEXT NOT NULL,
  node_id        TEXT NOT NULL,
  attempt        INTEGER NOT NULL,
  kind           TEXT NOT NULL,              -- 'video'|'image'|'audio'
  provider       TEXT,
  remote_job_id  TEXT NOT NULL,
  state          TEXT NOT NULL,              -- 'submitted'|'running'|'succeeded'|'failed'|'lost'
  submitted_at   INTEGER NOT NULL,
  last_polled_at INTEGER,
  finished_at    INTEGER,
  error_code     TEXT,
  meta_json      TEXT,
  UNIQUE (provider, remote_job_id)           -- idempotent: never register the same remote job twice
);
-- Open-job lookup for reattach (partial index; SQLite and PG both support it).
CREATE INDEX IF NOT EXISTS idx_remote_jobs_open ON remote_jobs (run_id, node_id)
  WHERE state IN ('submitted', 'running');
`;

/**
 * Stable content hash of a graph snapshot (sha256, first 16 hex chars).
 * Used to throttle auto-snapshots and to correlate runs with versions.
 */

interface Migration {
  version: number;
  description: string;
  /**
   * Returns true if this migration's effect is already present in the schema
   * (used only for one-time baselining of databases created before the
   * migration table existed). New migrations should leave this undefined.
   */
  detect?: (db: DatabaseSync) => boolean;
  up: (db: DatabaseSync) => void;
  /**
   * Reverses `up` for a one-step rollback (migration down). Optional: only
   * pure-DDL migrations provide it; data migrations without a safe inverse
   * omit it so rollback refuses rather than guessing.
   */
  down?: (db: DatabaseSync) => void;
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name?: string } | undefined;
  return !!row;
}

function indexExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .get(name) as { name?: string } | undefined;
  return !!row;
}

/**

 * Ordered, versioned migrations. The DDL constant above always creates the
 * LATEST schema for fresh databases; these only run against older files. Each
 * migration runs once and is recorded in `schema_migrations`. Add new entries
 * at the end with an incremented version — never reorder or edit a shipped one.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "runs.trigger",
    detect: (db) => columnExists(db, "runs", "trigger"),
    up: (db) => db.exec("ALTER TABLE runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual'"),
  },
  {
    version: 2,
    description: "runs.input",
    detect: (db) => columnExists(db, "runs", "input"),
    up: (db) => db.exec("ALTER TABLE runs ADD COLUMN input TEXT"),
  },
  {
    version: 3,
    description: "node_runs.reasoning",
    detect: (db) => columnExists(db, "node_runs", "reasoning"),
    up: (db) => db.exec("ALTER TABLE node_runs ADD COLUMN reasoning TEXT"),
  },
  {
    version: 4,
    description: "node_runs.error_code",
    detect: (db) => columnExists(db, "node_runs", "error_code"),
    up: (db) => db.exec("ALTER TABLE node_runs ADD COLUMN error_code TEXT"),
  },
  {
    version: 5,
    description: "node_runs.cached_tokens",
    detect: (db) => columnExists(db, "node_runs", "cached_tokens"),
    up: (db) =>
      db.exec("ALTER TABLE node_runs ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0"),
  },
  {
    version: 6,
    description: "node_runs.reasoning_tokens",
    detect: (db) => columnExists(db, "node_runs", "reasoning_tokens"),
    up: (db) =>
      db.exec("ALTER TABLE node_runs ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0"),
  },
  {
    version: 7,
    description: "node_runs.units_json",
    detect: (db) => columnExists(db, "node_runs", "units_json"),
    up: (db) => db.exec("ALTER TABLE node_runs ADD COLUMN units_json TEXT"),
  },
  {
    version: 8,
    description: "graphs.version optimistic lock",
    detect: (db) => columnExists(db, "graphs", "version"),
    up: (db) => db.exec("ALTER TABLE graphs ADD COLUMN version INTEGER NOT NULL DEFAULT 1"),
  },
  {
    version: 9,
    description: "artifacts table",
    detect: (db) => tableExists(db, "artifacts"),
    up: (db) =>
      db.exec(`CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, node_id TEXT NOT NULL, attempt INTEGER,
        graph_id TEXT, role TEXT, kind TEXT NOT NULL, mime_type TEXT, label TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0, storage TEXT NOT NULL, uri TEXT, created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_artifacts_node ON artifacts(run_id, node_id);
        CREATE INDEX IF NOT EXISTS idx_artifacts_graph ON artifacts(graph_id, created_at);`),
  },
  {
    version: 10,
    description: "node_runs.score for eval linkage",
    detect: (db) => columnExists(db, "node_runs", "score"),
    up: (db) => db.exec("ALTER TABLE node_runs ADD COLUMN score REAL"),
  },
  {
    version: 11,
    description: "runs A/B experiment grouping (ab_group, ab_arm, ab_target)",
    detect: (db) => columnExists(db, "runs", "ab_group"),
    up: (db) => {
      db.exec("ALTER TABLE runs ADD COLUMN ab_group TEXT");
      db.exec("ALTER TABLE runs ADD COLUMN ab_arm TEXT");
      db.exec("ALTER TABLE runs ADD COLUMN ab_target TEXT");
    },
  },
  {
    version: 12,
    description: "brand_terms managed vocabulary library",
    detect: (db) => tableExists(db, "brand_terms"),
    up: (db) =>
      db.exec(`CREATE TABLE IF NOT EXISTS brand_terms (
        id TEXT PRIMARY KEY,
        term TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`),
  },
  {
    version: 13,
    description: "artifacts.graph_id + role for pipeline attribution",
    detect: (db) => columnExists(db, "artifacts", "graph_id"),
    up: (db) => {
      db.exec("ALTER TABLE artifacts ADD COLUMN graph_id TEXT");
      db.exec("ALTER TABLE artifacts ADD COLUMN role TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_artifacts_graph ON artifacts(graph_id, created_at)");
    },
  },
  {
    version: 14,
    description: "users table + per-user data isolation",
    // Check a data column, not the users table: DDL runs before migrations and
    // always creates users with the latest shape, which would otherwise mask
    // the missing user_id columns on pre-migration databases.
    detect: (db) => columnExists(db, "graphs", "user_id"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`);
      // DDL runs before migrations and may already have created some tables
      // with the latest shape, so only add missing columns.
      for (const table of ["graphs", "runs", "brand_terms"] as const) {
        if (!columnExists(db, table, "user_id")) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT`);
        }
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_graphs_user ON graphs(user_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_brand_terms_user ON brand_terms(user_id)");
    },
  },
  {
    version: 15,
    description: "artifacts.user_id so artifact reads are tenant-scoped",
    // No `detect`: fresh databases already carry the column from the base DDL,
    // and baselining would record this as applied without ever creating the index.
    up: (db) => {
      if (!columnExists(db, "artifacts", "user_id")) {
        db.exec("ALTER TABLE artifacts ADD COLUMN user_id TEXT");
      }
      db.exec(`UPDATE artifacts SET user_id = (
                 SELECT r.user_id FROM runs r WHERE r.id = artifacts.run_id
               )
               WHERE user_id IS NULL
                 AND EXISTS (
                   SELECT 1 FROM runs r WHERE r.id = artifacts.run_id AND r.user_id IS NOT NULL
                 )`);
      db.exec(`UPDATE artifacts SET user_id = (
                 SELECT g.user_id FROM graphs g WHERE g.id = artifacts.graph_id
               )
               WHERE user_id IS NULL AND artifacts.graph_id IS NOT NULL`);
      // Pre-auth uploads link to neither a run nor a graph. A single-user
      // database leaves no ambiguity about who made them; with several users
      // the owner is unknowable, so those rows stay unowned and invisible.
      db.exec(`UPDATE artifacts SET user_id = (SELECT id FROM users LIMIT 1)
               WHERE user_id IS NULL AND (SELECT COUNT(*) FROM users) = 1`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_artifacts_user ON artifacts(user_id)");
    },
  },
  {
    version: 16,
    description: "per-user settings table (provider keys are tenant-scoped)",
    detect: (db) => tableExists(db, "settings"),
    up: (db) =>
      db.exec(`CREATE TABLE IF NOT EXISTS settings (
        user_id    TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
  },
  {
    version: 17,
    description: "graph_variables table (cross-run persisted variables)",
    detect: (db) => tableExists(db, "graph_variables"),
    up: (db) =>
      db.exec(`CREATE TABLE IF NOT EXISTS graph_variables (
        graph_id   TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (graph_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_graph_variables_graph ON graph_variables(graph_id);`),
  },
  {
    version: 18,
    description: "graph_versions.content_hash (auto-snapshot throttling + run audit)",
    detect: (db) => columnExists(db, "graph_versions", "content_hash"),
    up: (db) =>
      db.exec("ALTER TABLE graph_versions ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''"),
  },
  {
    version: 19,
    description: "graphs.origin_template_id (template-instance reset anchor)",
    detect: (db) => columnExists(db, "graphs", "origin_template_id"),
    up: (db) =>
      db.exec("ALTER TABLE graphs ADD COLUMN origin_template_id TEXT"),
  },
  {
    version: 20,
    description: "runs.halted_node_id/halted_reason (review queue lists pending decisions)",
    // No `detect`: fresh databases carry both columns from the base DDL, and
    // baselining would record this as applied without creating the index.
    // Runs that halted before this migration keep NULL — the API layer resolves
    // those from the run's event log instead of dropping them from the queue.
    up: (db) => {
      if (!columnExists(db, "runs", "halted_node_id")) {
        db.exec("ALTER TABLE runs ADD COLUMN halted_node_id TEXT");
      }
      if (!columnExists(db, "runs", "halted_reason")) {
        db.exec("ALTER TABLE runs ADD COLUMN halted_reason TEXT");
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_runs_user_status ON runs(user_id, status)");
    },
  },
  {
    version: 21,
    description: "banned_terms per-user compliance vocabulary (F3)",
    detect: (db) => tableExists(db, "banned_terms"),
    up: (db) =>
      db.exec(`CREATE TABLE IF NOT EXISTS banned_terms (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        term TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      )`),
  },
  {
    version: 22,
    description: "products + brand_assets per-user library (F4)",
    detect: (db) => tableExists(db, "products"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        sku TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        brand TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        price REAL,
        attributes_json TEXT NOT NULL DEFAULT '{}',
        images_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id, status)");
      db.exec(`CREATE TABLE IF NOT EXISTS brand_assets (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        uri TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      )`);
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_brand_assets_user ON brand_assets(user_id, created_at DESC)",
      );
    },
  },
  {
    version: 23,
    description: "batch_jobs + batch_items + runs.batch_id/batch_item_id (F5)",
    detect: (db) => tableExists(db, "batch_jobs"),
    up: (db) => {
      db.exec("ALTER TABLE runs ADD COLUMN batch_id TEXT");
      db.exec("ALTER TABLE runs ADD COLUMN batch_item_id TEXT");
      db.exec(`CREATE TABLE IF NOT EXISTS batch_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        graph_id TEXT NOT NULL,
        status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        succeeded INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        source_name TEXT,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_batch_jobs_user ON batch_jobs(user_id, created_at DESC)");
      db.exec(`CREATE TABLE IF NOT EXISTS batch_items (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        input_json TEXT NOT NULL,
        run_id TEXT,
        status TEXT NOT NULL,
        output_summary TEXT,
        artifact_ids_json TEXT,
        error TEXT
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_batch_items_batch ON batch_items(batch_id, row_index)");
    },
  },
  {
    version: 24,
    description: "content_plan per-user scheduling calendar (F8)",
    detect: (db) => tableExists(db, "content_plan"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS content_plan (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        graph_id TEXT,
        run_id TEXT,
        artifact_id TEXT,
        platform TEXT,
        title TEXT,
        scheduled_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        published_url TEXT,
        note TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_content_plan_time ON content_plan(user_id, scheduled_at)");
    },
  },
  {
    version: 25,
    description: "content_metrics per-user performance feedback (F6)",
    detect: (db) => tableExists(db, "content_metrics"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS content_metrics (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        graph_id TEXT,
        run_id TEXT,
        node_id TEXT,
        variant TEXT,
        artifact_id TEXT,
        product_id TEXT,
        platform TEXT,
        external_content_id TEXT,
        impressions INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        gmv REAL DEFAULT 0,
        ad_spend REAL DEFAULT 0,
        recorded_at INTEGER NOT NULL
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_metrics_content ON content_metrics(artifact_id, recorded_at)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_metrics_user ON content_metrics(user_id, recorded_at)");
    },
  },
  {
    version: 26,
    description: "content_costs per-user content-level cost snapshot (F9)",
    detect: (db) => tableExists(db, "content_costs"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS content_costs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        artifact_id TEXT,
        product_id TEXT,
        platform TEXT,
        variant TEXT,
        cost_usd REAL DEFAULT 0,
        gmv REAL DEFAULT 0,
        roi REAL DEFAULT 0,
        captured_at INTEGER NOT NULL
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_content_costs_user ON content_costs(user_id, captured_at)");
    },
  },
  {
    version: 27,
    description: "node_runs/artifacts variant dimension (F1)",
    // Detect on the INDEX, not the node_runs column: the column is already in
    // the fresh-database DDL above, so a fresh DB would detect "done" and skip
    // this migration — but since the DDL no longer creates the artifacts
    // variant index itself (see the comment there), baselining must still run
    // this up() so the index gets built.
    detect: (db) => indexExists(db, "idx_artifacts_variant"),
    up: (db) => {
      // artifacts: single-column `id` PK, so the variant dimension is just an
      // appended column + index — no rebuild needed. Guard with columnExists:
      // `openDb` runs DDL (which already includes variant) before migrations,
      // so a pre-artifacts database can already have the column.
      if (!columnExists(db, "artifacts", "variant")) {
        db.exec("ALTER TABLE artifacts ADD COLUMN variant TEXT NOT NULL DEFAULT 'main'");
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_artifacts_variant ON artifacts(run_id, node_id, variant)");
      // node_runs: fold `variant` into the composite primary key. SQLite cannot
      // alter a PK, so rebuild: create → copy (variant = 'main') → drop → rename.
      db.exec(`
        CREATE TABLE node_runs_new (
          run_id TEXT NOT NULL, node_id TEXT NOT NULL, attempt INTEGER NOT NULL,
          variant TEXT NOT NULL DEFAULT 'main', status TEXT NOT NULL, output TEXT,
          reasoning TEXT, error TEXT, error_code TEXT,
          tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
          cached_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0, units_json TEXT, score REAL,
          PRIMARY KEY (run_id, node_id, attempt, variant)
        );
        INSERT INTO node_runs_new (run_id, node_id, attempt, variant, status, output, reasoning, error, error_code,
          tokens_in, tokens_out, cached_tokens, reasoning_tokens, cost_usd, units_json, score)
          SELECT run_id, node_id, attempt, 'main', status, output, reasoning, error, error_code,
          tokens_in, tokens_out, cached_tokens, reasoning_tokens, cost_usd, units_json, score FROM node_runs;
        DROP TABLE node_runs;
        ALTER TABLE node_runs_new RENAME TO node_runs;
      `);
    },
  },
  {
    version: 28,
    description: "publish_targets/published_contents for open-channel publishing (F7-B)",
    detect: (db) => tableExists(db, "publish_targets"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS publish_targets (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        platform TEXT NOT NULL,
        name TEXT,
        provider TEXT NOT NULL,
        config_encrypted TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS published_contents (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        graph_id TEXT,
        run_id TEXT,
        artifact_id TEXT,
        platform TEXT,
        status TEXT NOT NULL,
        external_id TEXT,
        external_url TEXT,
        published_at INTEGER,
        detail_json TEXT
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_publish_targets_user ON publish_targets(user_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_published_user ON published_contents(user_id, published_at)");
    },
  },
  {
    version: 29,
    description: "audit_log for security/compliance actions (who changed what when)",
    detect: (db) => tableExists(db, "audit_log"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        action      TEXT NOT NULL,
        object_type TEXT,
        object_id   TEXT,
        detail      TEXT,
        ip          TEXT,
        created_at  INTEGER NOT NULL
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at)");
    },
  },
  {
    version: 30,
    description: "announcements/announcement_reads for in-product notices",
    detect: (db) => tableExists(db, "announcements"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS announcements (
        id          TEXT PRIMARY KEY,
        title_zh    TEXT NOT NULL,
        title_en    TEXT NOT NULL,
        body_zh     TEXT,
        body_en     TEXT,
        level       TEXT NOT NULL DEFAULT 'info',
        starts_at   INTEGER NOT NULL,
        ends_at     INTEGER,
        target      TEXT,
        created_at  INTEGER NOT NULL
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_announcements_window ON announcements(starts_at)");
      db.exec(`CREATE TABLE IF NOT EXISTS announcement_reads (
        user_id         TEXT NOT NULL,
        announcement_id TEXT NOT NULL,
        read_at         INTEGER NOT NULL,
        PRIMARY KEY (user_id, announcement_id)
      )`);
    },
  },
  {
    version: 31,
    description: "users.role global RBAC column + single-owner bootstrap (design-rbac P0)",
    // Detect on the INDEX, not the users.role column: the column is already in
    // the fresh-database DDL above, so a fresh DB would detect "done" and skip
    // this migration — but the DDL does not create the partial unique index
    // (see the comment there), so baselining must still run this up() to build
    // it and bootstrap the owner.
    detect: (db) => indexExists(db, "idx_users_owner"),
    up: (db) => {
      if (!columnExists(db, "users", "role")) {
        db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
      }
      db.exec(OWNER_UNIQUE_INDEX);
      // Owner bootstrap: with no owner yet, promote the earliest-registered
      // user (created_at is ISO text, lexicographically ordered; rowid breaks
      // ties within one second). Existing databases therefore keep exactly
      // one owner; fresh ones start empty and createUser assigns it.
      db.exec(`UPDATE users SET role = 'owner' WHERE id = (
        SELECT id FROM users ORDER BY created_at ASC, rowid ASC LIMIT 1
      ) AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner')`);
    },
  },
  {
    version: 32,
    description: "resource_access for resource-level sharing (design-rbac P1)",
    detect: (db) => tableExists(db, "resource_access"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS resource_access (
        resource_type TEXT NOT NULL,
        resource_id   TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        role          TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        PRIMARY KEY (resource_type, resource_id, user_id)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_resource_access_user ON resource_access(user_id, resource_type)`);
    },
  },
  {
    version: 33,
    description: "feedback for in-product user feedback (design-feedback P1)",
    detect: (db) => tableExists(db, "feedback"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS feedback (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL,
        message         TEXT NOT NULL,
        category        TEXT NOT NULL DEFAULT 'other',
        context         TEXT NOT NULL,
        attachment      BLOB,
        attachment_mime TEXT,
        status          TEXT NOT NULL DEFAULT 'open',
        created_at      INTEGER NOT NULL
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_user_time ON feedback(user_id, created_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at)`);
    },
  },
  {
    version: 34,
    // usage_ledger is created empty on purpose: it is P1 quota scaffolding, not
    // a second metering store. Backfill from node_runs when quotas ship.
    description: "subscriptions + usage_ledger for monetization P0/P1 (design-monetization)",
    detect: (db) => tableExists(db, "subscriptions"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS subscriptions (
        user_id              TEXT PRIMARY KEY,
        plan                 TEXT NOT NULL,
        status               TEXT NOT NULL,
        provider             TEXT,
        external_id          TEXT,
        current_period_start INTEGER NOT NULL,
        current_period_end   INTEGER NOT NULL,
        created_at           INTEGER NOT NULL,
        updated_at           INTEGER NOT NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS usage_ledger (
        user_id        TEXT NOT NULL,
        period_start   INTEGER NOT NULL,
        metric         TEXT NOT NULL,
        amount         REAL NOT NULL,
        updated_at     INTEGER NOT NULL,
        PRIMARY KEY (user_id, period_start, metric)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_ledger_user ON usage_ledger(user_id, period_start)`);
    },
  },
  {
    version: 35,
    description: "idempotency_keys for idempotent run creation (engineering-blueprint §2)",
    detect: (db) => tableExists(db, "idempotency_keys"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS idempotency_keys (
        user_id    TEXT NOT NULL,
        key        TEXT NOT NULL,
        run_id     TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      )`);
    },
    down: (db) => {
      db.exec("DROP TABLE IF EXISTS idempotency_keys");
    },
  },
  {
    version: 36,
    // Cost per model is the axis pricing decisions need, and it cannot be
    // recovered from events recorded before this column existed.
    description: "node_runs.model for per-model cost attribution",
    detect: (db) => columnExists(db, "node_runs", "model"),
    up: (db) => db.exec("ALTER TABLE node_runs ADD COLUMN model TEXT"),
    down: (db) => db.exec("ALTER TABLE node_runs DROP COLUMN model"),
  },
  {
    version: 37,
    // RTS stage-B macro-park position. A stored (park_x, park_z) is the manual
    // override of the pure parkLayout() result; NULL means "not laid out" and
    // the frontend auto-layouts. View-layer preference, so it lives beside the
    // graph row rather than inside `doc` (keeps version/content_hash clean).
    description: "graphs.park_x/park_z for RTS stage-B macro park layout",
    detect: (db) => columnExists(db, "graphs", "park_x"),
    up: (db) => {
      if (!columnExists(db, "graphs", "park_x")) db.exec("ALTER TABLE graphs ADD COLUMN park_x REAL");
      if (!columnExists(db, "graphs", "park_z")) db.exec("ALTER TABLE graphs ADD COLUMN park_z REAL");
    },
    down: (db) => {
      db.exec("ALTER TABLE graphs DROP COLUMN park_x");
      db.exec("ALTER TABLE graphs DROP COLUMN park_z");
    },
  },
  {
    version: 38,
    // P2 billing invoices. One row per (user, billing-period). line_items is
    // JSON array of {description, quantity, unit_price, amount}. status state
    // machine: draft -> open -> paid | void. MVP manual payment; S6 Stripe
    // will populate paid_method='stripe' and external_id references.
    description: "invoices table for P2 billing (design-monetization-m3 S1)",
    detect: (db) => tableExists(db, "invoices"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS invoices (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        period_start    INTEGER NOT NULL,
        period_end      INTEGER NOT NULL,
        plan            TEXT NOT NULL,
        amount_usd      REAL NOT NULL,
        status          TEXT NOT NULL,
        line_items      TEXT NOT NULL DEFAULT '[]',
        paid_at         INTEGER,
        paid_method     TEXT,
        notes           TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      )`);
      db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(user_id, period_start)");
    },
    down: (db) => {
      db.exec("DROP TABLE IF EXISTS invoices");
    },
  },
  {
    version: 39,
    // M3 S6 Stripe mirror columns (design-monetization-m3-s6-stripe §2). Stripe
    // is the billing system of record; these reconcile local rows to Stripe
    // objects inside webhooks. Nullable so pre-Stripe manual rows stay valid.
    description: "stripe mirror columns on subscriptions/invoices (M3 S6)",
    detect: (db) => columnExists(db, "subscriptions", "stripe_customer_id"),
    up: (db) => {
      if (!columnExists(db, "subscriptions", "stripe_customer_id")) db.exec("ALTER TABLE subscriptions ADD COLUMN stripe_customer_id TEXT");
      if (!columnExists(db, "subscriptions", "stripe_subscription_id")) db.exec("ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id TEXT");
      if (!columnExists(db, "subscriptions", "stripe_price_id")) db.exec("ALTER TABLE subscriptions ADD COLUMN stripe_price_id TEXT");
      if (!columnExists(db, "invoices", "stripe_invoice_id")) db.exec("ALTER TABLE invoices ADD COLUMN stripe_invoice_id TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_stripe_invoice ON invoices(stripe_invoice_id)");
    },
    down: (db) => {
      db.exec("DROP INDEX IF EXISTS idx_subscriptions_stripe_customer");
      db.exec("DROP INDEX IF EXISTS idx_subscriptions_stripe_sub");
      db.exec("DROP INDEX IF EXISTS idx_invoices_stripe_invoice");
      db.exec("ALTER TABLE subscriptions DROP COLUMN stripe_customer_id");
      db.exec("ALTER TABLE subscriptions DROP COLUMN stripe_subscription_id");
      db.exec("ALTER TABLE subscriptions DROP COLUMN stripe_price_id");
      db.exec("ALTER TABLE invoices DROP COLUMN stripe_invoice_id");
    },
  },
  {
    version: 40,
    // Demo users (design-demo-user §5.1). A demo account is a real users row
    // carrying is_demo=1 plus an ISO-UTC demo_expires_at; real accounts stay
    // 0/NULL. is_demo is orthogonal to role (demo rows are always role='user').
    description: "users.is_demo/demo_expires_at for try-before-signup demo accounts",
    detect: (db) => columnExists(db, "users", "is_demo"),
    up: (db) => {
      if (!columnExists(db, "users", "is_demo")) db.exec("ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0");
      if (!columnExists(db, "users", "demo_expires_at")) db.exec("ALTER TABLE users ADD COLUMN demo_expires_at TEXT");
    },
    down: (db) => {
      // Intentionally no DROP COLUMN: clear the demo flags so a one-step
      // rollback never destroys account rows (design-demo-user §5.1).
      db.exec("UPDATE users SET is_demo = 0, demo_expires_at = NULL WHERE is_demo = 1");
    },
  },
  {
    version: 41,
    // G4 durable remote-job handles for long async tasks (design-step-trace
    // -and-robustness §3.5). Purely additive: a fresh table; no existing row or
    // code path changes until a node writes to it (steps 4/5, not yet built).
    description: "remote_jobs table for G4 long-task reattach",
    detect: (db) => tableExists(db, "remote_jobs"),
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS remote_jobs (
        id             TEXT PRIMARY KEY,
        user_id        TEXT NOT NULL,
        run_id         TEXT NOT NULL,
        graph_id       TEXT NOT NULL,
        node_id        TEXT NOT NULL,
        attempt        INTEGER NOT NULL,
        kind           TEXT NOT NULL,
        provider       TEXT,
        remote_job_id  TEXT NOT NULL,
        state          TEXT NOT NULL,
        submitted_at   INTEGER NOT NULL,
        last_polled_at INTEGER,
        finished_at    INTEGER,
        error_code     TEXT,
        meta_json      TEXT,
        UNIQUE (provider, remote_job_id)
      );`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_remote_jobs_open ON remote_jobs (run_id, node_id)
        WHERE state IN ('submitted', 'running');`);
    },
    down: (db) => {
      db.exec("DROP INDEX IF EXISTS idx_remote_jobs_open");
      db.exec("DROP TABLE IF EXISTS remote_jobs");
    },
  },
  {
    version: 42,
    // Accounts an owner opened for someone else carry a one-time password, so
    // they must be flagged until it is replaced. Purely additive: existing rows
    // get 0, the auth middleware refuses only rows set to 1.
    description: "users.must_change_password for admin-provisioned accounts",
    detect: (db) => columnExists(db, "users", "must_change_password"),
    up: (db) => {
      if (!columnExists(db, "users", "must_change_password"))
        db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
    },
    down: (db) => {
      // Intentionally no DROP COLUMN: clear the flags so a rollback neither
      // destroys accounts nor leaves the middleware refusing a column it no
      // longer has.
      db.exec("UPDATE users SET must_change_password = 0 WHERE must_change_password = 1");
    },
  },
];

const LATEST_VERSION = MIGRATIONS.at(-1)!.version;

/**
 * Indexes over columns added to PRE-EXISTING tables by later migrations. They
 * cannot live in the base `DDL` string: that runs before migrations, and an
 * upgraded DB still has the old table (without the column) at that point, so
 * creating the index there crashes boot with "no such column". They also can't
 * live only inside their migration's `up`, because a brand-new DB baselines
 * (detect() matches and up() is skipped). Creating each once after every
 * migration has settled — when the column exists on both the fresh and upgrade
 * paths — covers both. All statements are idempotent (IF NOT EXISTS).
 *
 * PostgreSQL never runs these migrations: `createPgDriver` builds from `DDL`
 * only. So this list is exported and PG executes it too — that is what carries
 * the owner-singleton invariant onto the PG track (audit 7.1/7.2: without it a
 * fresh PG database let two concurrent first registrations both become owner).
 */
export const OWNER_UNIQUE_INDEX =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_owner ON users(role) WHERE role = 'owner'";

export const POST_MIGRATION_INDEXES: readonly string[] = [
  OWNER_UNIQUE_INDEX,
  "CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id)",
  "CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_stripe_invoice ON invoices(stripe_invoice_id)",
];

/**
 * Run pending migrations inside a transaction. On first encounter of an older
 * database (no `schema_migrations` rows), existing columns are baselined: a
 * migration whose effect is already present is recorded as applied without
 * running, so upgrades from the old try/catch ADD COLUMN era don't break.
 */

export function runMigrations(db: DatabaseSync) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    INTEGER PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const appliedRow = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number };
  const baselining = appliedRow.v === 0;
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map(
      (r) => r.version,
    ),
  );

  const record = db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  const now = Date.now();

  db.exec("BEGIN");
  const migrated: number[] = [];
  try {
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      if (baselining && m.detect?.(db)) {
        record.run(m.version, now);
        migrated.push(m.version);
        continue;
      }
      m.up(db);
      record.run(m.version, now);
      migrated.push(m.version);
    }
    // Columns added to pre-existing tables are guaranteed present only now
    // (base DDL on a fresh DB, v39 ALTER on upgrades); build their indexes here.
    for (const sql of POST_MIGRATION_INDEXES) db.exec(sql);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  // One line per applied migration (baseline skips count too) — schema
  // upgrades are the classic "server boots weird" suspect.
  for (const version of migrated) {
    log.info("migration applied", { version });
  }
  if (migrated.length > 0) {
    log.info("migrations complete", { count: migrated.length, totalMs: Date.now() - now });
  }
}

/**
 * Rolls back the most recently applied migration (one step). Refuses when that
 * migration has no `down` (data migrations without a safe inverse). Deletes the
 * schema_migrations row so a later boot re-applies it. Returns null when no
 * migration has been applied.
 */

export function rollbackLatestMigration(db: DatabaseSync): { version: number; description: string } | null {
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  const version = row.v;
  if (!version) return null;
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) return null;
  if (!migration.down) {
    throw new Error(`migration ${version} (${migration.description}) has no down step — cannot roll back`);
  }
  db.exec("BEGIN");
  try {
    migration.down(db);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(version);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { version, description: migration.description };
}

/** The schema version this build expects. Exposed for diagnostics/backups. */
export const SCHEMA_VERSION = LATEST_VERSION;

