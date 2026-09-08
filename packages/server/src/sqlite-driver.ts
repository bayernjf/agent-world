import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { EVENT_SCHEMA_VERSION, type Graph, type RunEvent } from "@agent-world/core";
import type { StoredArtifact } from "./artifact-store.js";
import { decryptString, encryptString, openDocString, openGraphDoc, sealDocString, sealGraphDoc } from "./at-rest.js";
import { log } from "./logger.js";
import type {
  ABArmReport,
  ABReport,
  BatchItem,
  BatchJob,
  BrandAsset,
  ContentCost,
  ContentCostAggregate,
  ContentMetric,
  ContentPlan,
  PerformanceAggregate,
  Product,
  PublishTarget,
  PublishedContent,
} from "./db.js";

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
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
-- idx_users_owner is NOT here on purpose: the role column is only added by
-- migration 31 for pre-RBAC databases, and an index in this DDL runs before
-- migrations -- an older file dies in db.exec(DDL) with "no such column: role".

CREATE TABLE IF NOT EXISTS graphs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  name       TEXT NOT NULL,
  doc        TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
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
  created_at  INTEGER NOT NULL
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
`;

/**
 * Stable content hash of a graph snapshot (sha256, first 16 hex chars).
 * Used to throttle auto-snapshots and to correlate runs with versions.
 */
export function contentHash(doc: string): string {
  return createHash("sha256").update(doc).digest("hex").slice(0, 16);
}

type ArtifactRow = {
  id: string;
  run_id: string;
  node_id: string;
  attempt: number | null;
  graph_id: string | null;
  role: StoredArtifact["role"];
  graph_name?: string | null;
  kind: StoredArtifact["kind"];
  mime_type: string | null;
  label: string | null;
  size_bytes: number;
  storage: StoredArtifact["storage"];
  uri: string | null;
  created_at: number;
};

function mapArtifact(r: ArtifactRow): StoredArtifact {
  return {
    id: r.id,
    runId: r.run_id,
    nodeId: r.node_id,
    attempt: r.attempt,
    graphId: r.graph_id,
    role: r.role,
    graphName: r.graph_name ?? null,
    kind: r.kind,
    mimeType: r.mime_type ?? "",
    label: r.label,
    sizeBytes: r.size_bytes,
    storage: r.storage,
    uri: r.uri,
    createdAt: r.created_at,
  };
}

function mapArtifacts(rows: ArtifactRow[]): StoredArtifact[] {
  return rows.map(mapArtifact);
}

/** Parse a raw products row (snake_case JSON columns) into a Product. */
function productFromRow(r: Record<string, unknown>): Product {
  let attributes: Record<string, unknown> = {};
  let images: string[] = [];
  try {
    attributes = JSON.parse(String(r.attributes_json ?? "{}"));
  } catch {
    /* keep {} */
  }
  try {
    images = JSON.parse(String(r.images_json ?? "[]"));
  } catch {
    /* keep [] */
  }
  return {
    id: r.id as string,
    sku: (r.sku as string) ?? "",
    name: r.name as string,
    brand: (r.brand as string) ?? "",
    category: (r.category as string) ?? "",
    price: (r.price as number | null) ?? null,
    attributes,
    images,
    status: ((r.status as string) ?? "active") as "active" | "archived",
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

/** Parse a raw batch_jobs row into a BatchJob. */
function batchFromRow(r: Record<string, unknown>): BatchJob {
  return {
    id: String(r.id),
    graphId: String(r.graph_id),
    status: String(r.status) as BatchJob["status"],
    total: Number(r.total ?? 0),
    succeeded: Number(r.succeeded ?? 0),
    failed: Number(r.failed ?? 0),
    sourceName: r.source_name ? String(r.source_name) : null,
    createdAt: Number(r.created_at),
    finishedAt: r.finished_at ? Number(r.finished_at) : null,
  };
}

/** Parse a raw content_plan row into a ContentPlan. */
function planFromRow(r: Record<string, unknown>): ContentPlan {
  return {
    id: String(r.id),
    graphId: r.graph_id ? String(r.graph_id) : null,
    runId: r.run_id ? String(r.run_id) : null,
    artifactId: r.artifact_id ? String(r.artifact_id) : null,
    platform: r.platform ? String(r.platform) : null,
    title: String(r.title ?? ""),
    scheduledAt: Number(r.scheduled_at),
    status: String(r.status ?? "draft") as ContentPlan["status"],
    publishedUrl: r.published_url ? String(r.published_url) : null,
    note: r.note ? String(r.note) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Parse a raw content_metrics row into a ContentMetric. */
function metricFromRow(r: Record<string, unknown>): ContentMetric {
  return {
    id: String(r.id),
    graphId: r.graph_id ? String(r.graph_id) : null,
    runId: r.run_id ? String(r.run_id) : null,
    nodeId: r.node_id ? String(r.node_id) : null,
    variant: r.variant ? String(r.variant) : null,
    artifactId: r.artifact_id ? String(r.artifact_id) : null,
    productId: r.product_id ? String(r.product_id) : null,
    platform: r.platform ? String(r.platform) : null,
    externalContentId: r.external_content_id ? String(r.external_content_id) : null,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    conversions: Number(r.conversions ?? 0),
    gmv: Number(r.gmv ?? 0),
    adSpend: Number(r.ad_spend ?? 0),
    recordedAt: Number(r.recorded_at),
  };
}

/** Parse a raw content_costs row into a ContentCost. */
function costFromRow(r: Record<string, unknown>): ContentCost {
  return {
    id: String(r.id),
    artifactId: r.artifact_id ? String(r.artifact_id) : null,
    productId: r.product_id ? String(r.product_id) : null,
    platform: r.platform ? String(r.platform) : null,
    variant: r.variant ? String(r.variant) : null,
    costUsd: Number(r.cost_usd ?? 0),
    gmv: Number(r.gmv ?? 0),
    roi: Number(r.roi ?? 0),
    capturedAt: Number(r.captured_at),
  };
}

/** Number of startup snapshots to retain alongside the database. */
export const BACKUP_RETENTION = 5;

/**
 * Take a consistent snapshot of an existing on-disk database before migrations
 * run, so a botched upgrade never destroys the only copy of event history.
 * Snapshots live in a `backups/` folder next to the database file and are
 * pruned to the newest BACKUP_RETENTION files. In-memory and first-run databases
 * are skipped — there is nothing worth snapshotting yet.
 */
function backupDatabase(db: DatabaseSync, file: string): void {
  if (file === ":memory:" || !existsSync(file)) return;
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size === 0) return;

    const dir = join(dirname(file), "backups");
    mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = join(dir, `pre-migration-${stamp}.db`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

    // Prune oldest snapshots beyond the retention window.
    const entries = readdirSync(dir)
      .filter((name) => /^pre-migration-.*\.db$/.test(name))
      .map((name) => ({ name, time: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const old of entries.slice(BACKUP_RETENTION)) {
      rmSync(join(dir, old.name), { force: true });
    }
  } catch {
    // Backup failures must never block startup; migrations still run.
  }
}

/**
 * SQLite driver factory: opens the database, runs migrations, and returns the
 * `SqliteDriver` implementation (every method async). Re-exported as `openDb`
 * from `db.ts` for backward compatibility; a future `DB_DRIVER=postgres` switch
 * would return a `PgDriver` here instead.
 * （design-postgres-migration.md §10.2 步骤 1）
 */
export function createSqliteDriver(file: string) {
  const db = new DatabaseSync(file);
  // Snapshot before any schema work. On a brand-new file the size is 0 here
  // (the WAL pragma below would otherwise write a header), so first-run
  // databases correctly produce no backup.
  backupDatabase(db, file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(DDL);
  runMigrations(db);

  return createDriver(createSqliteExecutor(db), {
    close: async () => {
      db.close();
    },
    prepare: (sql: string) => db.prepare(sql),
  }, "sqlite");
}

/**
 * SQL execution abstraction shared by `createSqliteDriver` and the future
 * `PgDriver`. Methods take a raw SQL string plus positional parameters so the
 * driver body can stay identical across backends — only the executor (and its
 * SQL translation) differs. (design-postgres-migration.md §5.2)
 */
export interface Executor {
  get(sql: string, params: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, params: unknown[]): Promise<{ changes: number; lastInsertId: number | bigint }>;
  exec(sql: string): Promise<void>;
}

/** Executor backed by the synchronous `node:sqlite` DatabaseSync (wrapped async). */
function createSqliteExecutor(db: DatabaseSync): Executor {
  return {
    async get(sql, params) {
      return db.prepare(sql).get(...(params as SQLInputValue[])) as Record<string, unknown> | undefined;
    },
    async all(sql, params) {
      return db.prepare(sql).all(...(params as SQLInputValue[])) as Record<string, unknown>[];
    },
    async run(sql, params) {
      const r = db.prepare(sql).run(...(params as SQLInputValue[])) as {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
      };
      return { changes: Number(r.changes), lastInsertId: r.lastInsertRowid };
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}

/**
 * Builds the shared driver body (137 methods) on top of an `Executor`. Hooks
 * cover the two backend-specific capabilities that aren't SQL execution:
 * closing the connection and the raw `prepare` passthrough (SQLite-only FTS5).
 */
export function createDriver(
  exec: Executor,
  hooks: { close: () => Promise<void>; prepare: (sql: string) => unknown },
  dialect: "sqlite" | "postgres",
) {
  // SQL-dialect expressions for the handful of statements that bucket epoch-ms
  // timestamps (design-postgres-migration.md §4 row 3). The SQLite dialect uses
  // strftime; PostgreSQL uses to_char(to_timestamp(...)).
  const weekExpr =
    dialect === "postgres"
      ? `to_char(to_timestamp(r.started_at / 1000.0), 'IYYY-"W"IW')`
      : `strftime('%Y-W%W', r.started_at / 1000, 'unixepoch', 'localtime')`;
  const monthExpr =
    dialect === "postgres"
      ? `to_char(to_timestamp(r.started_at / 1000.0), 'YYYY-MM')`
      : `strftime('%Y-%m', r.started_at / 1000, 'unixepoch', 'localtime')`;
  const stmts = {
    createUser: `INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)`,
    countOwners: `SELECT COUNT(*) AS n FROM users WHERE role = 'owner'`,
    getSettings: `SELECT data FROM settings WHERE user_id = ?`,
    saveSettings: `INSERT INTO settings (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    insertAudit: `INSERT INTO audit_log (id, user_id, action, object_type, object_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    listAudit: `SELECT id, user_id, action, object_type, object_id, detail, ip, created_at
       FROM audit_log WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`,
    // Slightly different prepared statement: the first page has no "before"
    // cursor, so accept 0 (older than anything).
    listAuditFirst: `SELECT id, user_id, action, object_type, object_id, detail, ip, created_at
       FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    // RBAC P3 (design-rbac.md): cross-user audit listing for owner/admin,
    // with the actor email resolved via LEFT JOIN (login_failed rows carry
    // user_id 'unknown' and surface with email = null).
    listAuditAdminFirst: `SELECT a.id, a.user_id, u.email, a.action, a.object_type, a.object_id, a.detail, a.ip, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT ?`,
    listAuditAdmin: `SELECT a.id, a.user_id, u.email, a.action, a.object_type, a.object_id, a.detail, a.ip, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.created_at < ? ORDER BY a.created_at DESC LIMIT ?`,
    listAuditUserFirst: `SELECT a.id, a.user_id, u.email, a.action, a.object_type, a.object_id, a.detail, a.ip, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT ?`,
    listAuditUser: `SELECT a.id, a.user_id, u.email, a.action, a.object_type, a.object_id, a.detail, a.ip, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.user_id = ? AND a.created_at < ? ORDER BY a.created_at DESC LIMIT ?`,
    listActiveAnnouncements: `SELECT * FROM announcements
       WHERE starts_at <= ? AND (ends_at IS NULL OR ends_at >= ?)
       ORDER BY created_at DESC`,
    listAllAnnouncements: `SELECT * FROM announcements ORDER BY created_at DESC`,
    getAnnouncement: `SELECT * FROM announcements WHERE id = ?`,
    insertAnnouncement: `INSERT INTO announcements (id, title_zh, title_en, body_zh, body_en, level, starts_at, ends_at, target, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    updateAnnouncement: `UPDATE announcements SET title_zh = ?, title_en = ?, body_zh = ?, body_en = ?,
        level = ?, starts_at = ?, ends_at = ?, target = ? WHERE id = ?`,
    deleteAnnouncement: `DELETE FROM announcements WHERE id = ?`,
    insertAnnouncementRead: `INSERT INTO announcement_reads (user_id, announcement_id, read_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, announcement_id) DO NOTHING`,
    listAnnouncementReads: `SELECT announcement_id FROM announcement_reads WHERE user_id = ?`,
    // P3 targeting: does this user "use" a template? Owned graphs…
    templateGraphOwned: `SELECT 1 AS hit FROM graphs WHERE user_id = ? AND origin_template_id = ? LIMIT 1`,
    // …and graphs shared to them (stale ACL rows are harmless here — the join
    // requires the graph to still exist and carry that origin_template_id).
    templateGraphShared: `SELECT 1 AS hit
       FROM resource_access ra JOIN graphs g ON g.id = ra.resource_id
       WHERE ra.resource_type = 'graph' AND ra.user_id = ? AND g.origin_template_id = ?
       LIMIT 1`,
    // User feedback (design-feedback.md). Attachment bytes stay in sqlite
    // (≤1MB, single image); the list queries never select the BLOB itself —
    // `has_attachment` lets the admin UI lazy-load via the attachment route.
    insertFeedback: `INSERT INTO feedback (id, user_id, message, category, context, attachment, attachment_mime, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    countFeedbackSince: `SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at >= ?`,
    listFeedbackAll: `SELECT f.id, f.user_id, u.email, f.message, f.category, f.context,
              f.attachment IS NOT NULL AS has_attachment, f.status, f.created_at
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC LIMIT ?`,
    listFeedbackByStatus: `SELECT f.id, f.user_id, u.email, f.message, f.category, f.context,
              f.attachment IS NOT NULL AS has_attachment, f.status, f.created_at
       FROM feedback f LEFT JOIN users u ON u.id = f.user_id
       WHERE f.status = ? ORDER BY f.created_at DESC LIMIT ?`,
    getFeedback: `SELECT * FROM feedback WHERE id = ?`,
    updateFeedbackStatus: `UPDATE feedback SET status = ? WHERE id = ?`,
    findUserByEmail: `SELECT id, email, role, created_at FROM users WHERE email = ?`,
    findUserById: `SELECT id, email, role, created_at FROM users WHERE id = ?`,
    findUserPasswordHash: `SELECT password_hash FROM users WHERE id = ?`,
    // RBAC P3 (design-rbac.md): full account list for the owner's admin panel.
    // Same ordering as the v31 owner bootstrap — the owner always sorts first.
    listUsers: `SELECT id, email, role, created_at FROM users ORDER BY created_at ASC, rowid ASC`,
    updateUserRole: `UPDATE users SET role = ? WHERE id = ?`,
    // Resource sharing (design-rbac P1). Only editor/viewer rows live here —
    // the resource owner is resolved from the owning table's user_id.
    saveResourceAccess: `INSERT INTO resource_access (resource_type, resource_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(resource_type, resource_id, user_id) DO UPDATE SET role = excluded.role`,
    deleteResourceAccess: `DELETE FROM resource_access WHERE resource_type = ? AND resource_id = ? AND user_id = ?`,
    getResourceAccess: `SELECT role, created_at FROM resource_access WHERE resource_type = ? AND resource_id = ? AND user_id = ?`,
    listResourceAccess: `SELECT user_id, role, created_at FROM resource_access WHERE resource_type = ? AND resource_id = ? ORDER BY created_at`,
    listResourceAccessForUser: `SELECT resource_id, role FROM resource_access WHERE resource_type = ? AND user_id = ?`,
    deleteResourceAccessForResource: `DELETE FROM resource_access WHERE resource_type = ? AND resource_id = ?`,
    getRunGraphRef: `SELECT user_id, graph_id FROM runs WHERE id = ?`,
    getArtifactGraphRef: `SELECT user_id, graph_id, run_id FROM artifacts WHERE id = ?`,
    countUsers: `SELECT COUNT(*) AS n FROM users`,
    updateUserPasswordHash: `UPDATE users SET password_hash = ? WHERE id = ?`,
    insertGraph: `INSERT INTO graphs (id, user_id, name, doc, origin_template_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, doc = excluded.doc, version = version + 1, updated_at = excluded.updated_at
       WHERE graphs.user_id = excluded.user_id`,
    // Conditional update: only succeeds when the row's current version matches
    // the If-Match value, so a stale tab can't silently clobber a newer save.
    updateGraphIfVersion: `UPDATE graphs SET name = ?, doc = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ? AND user_id = ?`,
    getGraphVersion: `SELECT version FROM graphs WHERE id = ? AND user_id = ?`,
    getGraph: `SELECT doc, version, origin_template_id FROM graphs WHERE id = ? AND user_id = ?`,
    listGraphs: `SELECT id, name, version, updated_at, origin_template_id FROM graphs WHERE user_id = ? ORDER BY updated_at DESC`,
    listGraphVariables: `SELECT gv.key AS key, gv.value AS value
       FROM graph_variables gv JOIN graphs g ON g.id = gv.graph_id AND g.user_id = ?
       WHERE gv.graph_id = ?`,
    saveGraphVariable: `INSERT INTO graph_variables (graph_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(graph_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    deleteGraph: `DELETE FROM graphs WHERE id = ? AND user_id = ?`,
    createRun: `INSERT INTO runs (id, user_id, graph_id, snapshot, status, trigger, input, budget_usd, started_at, ab_group, ab_arm, ab_target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    finishRun: `UPDATE runs SET status = ?, ended_at = ?, halted_node_id = ?, halted_reason = ? WHERE id = ? AND user_id = ?`,
    markRunning: `UPDATE runs SET status = 'running', ended_at = NULL, halted_node_id = NULL, halted_reason = NULL WHERE id = ? AND user_id = ?`,
    getRun: `SELECT * FROM runs WHERE id = ? AND user_id = ?`,
    listRuns: `SELECT r.id, r.graph_id, COALESCE(g.name, '(已删除产线)') AS graph_name, r.status, r.trigger, r.budget_usd, r.started_at, r.ended_at
       FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id
       ORDER BY r.started_at DESC LIMIT ? OFFSET ?`,
    insertEvent: `INSERT INTO events (run_id, seq, ts, version, type, payload) VALUES (?, ?, ?, ?, ?, ?)`,
    listEvents: `SELECT payload FROM events WHERE run_id = ? ORDER BY seq`,
    listEventsRange: `SELECT seq, payload FROM events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
    maxSeq: `SELECT COALESCE(MAX(seq), -1) as seq FROM events WHERE run_id = ?`,
    upsertNodeRun: `INSERT INTO node_runs (run_id, node_id, attempt, variant, status) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id, node_id, attempt, variant) DO UPDATE SET status = excluded.status`,
    appendReasoning: `UPDATE node_runs SET reasoning = COALESCE(reasoning, '') || ? WHERE run_id = ? AND node_id = ? AND attempt = ? AND variant = ?`,
    finishNodeRun: `UPDATE node_runs SET status = ?, output = ?, tokens_in = ?, tokens_out = ?,
        cached_tokens = ?, reasoning_tokens = ?, cost_usd = ?, units_json = ?
       WHERE run_id = ? AND node_id = ? AND attempt = ? AND variant = ?`,
    failNodeRun: `UPDATE node_runs SET status = 'failed', error = ?, error_code = ? WHERE run_id = ? AND node_id = ? AND attempt = ? AND variant = ?`,
    setNodeScore: `UPDATE node_runs SET score = ? WHERE run_id = ? AND node_id = ? AND attempt = ? AND variant = ?`,
    markInterrupted: `UPDATE runs SET status = 'interrupted', ended_at = ? WHERE status = 'running'`,
    /** Snapshots needed to group runs by prompt version (eval report). */
    evalSnapshots: `SELECT id, graph_id, snapshot FROM runs WHERE status != 'running' AND user_id = ? ORDER BY started_at DESC LIMIT 1000`,
        deleteRun: `DELETE FROM runs WHERE id = ? AND user_id = ?`,
    deleteEvents: `DELETE FROM events WHERE run_id = ?`,
    deleteNodeRuns: `DELETE FROM node_runs WHERE run_id = ?`,
    insertArtifact: `INSERT INTO artifacts (id, run_id, user_id, node_id, attempt, variant, graph_id, role, kind, mime_type, label, size_bytes, storage, uri, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    listArtifactsByRun: `SELECT a.id, a.run_id, a.node_id, a.attempt, a.graph_id, a.role, a.kind, a.mime_type, a.label, a.size_bytes, a.storage, a.uri, a.created_at,
              COALESCE(g.name, '(未知流水线)') AS graph_name
       FROM artifacts a LEFT JOIN graphs g ON g.id = a.graph_id
       WHERE a.run_id = ? AND a.user_id = ?
       ORDER BY a.created_at`,
    listArtifactsByRunUnscoped: `SELECT a.id, a.run_id, a.node_id, a.attempt, a.graph_id, a.role, a.kind, a.mime_type, a.label, a.size_bytes, a.storage, a.uri, a.created_at,
              COALESCE(g.name, '(未知流水线)') AS graph_name
       FROM artifacts a LEFT JOIN graphs g ON g.id = a.graph_id
       WHERE a.run_id = ?
       ORDER BY a.created_at`,
    getArtifact: `SELECT a.id, a.run_id, a.node_id, a.attempt, a.graph_id, a.role, a.kind, a.mime_type, a.label, a.size_bytes, a.storage, a.uri, a.created_at,
              COALESCE(g.name, '(未知流水线)') AS graph_name
       FROM artifacts a LEFT JOIN graphs g ON g.id = a.graph_id
       WHERE a.id = ? AND a.user_id = ?`,
    getArtifactUnscoped: `SELECT a.id, a.run_id, a.node_id, a.attempt, a.graph_id, a.role, a.kind, a.mime_type, a.label, a.size_bytes, a.storage, a.uri, a.created_at,
              COALESCE(g.name, '(未知流水线)') AS graph_name
       FROM artifacts a LEFT JOIN graphs g ON g.id = a.graph_id
       WHERE a.id = ?`,
    listArtifacts: `SELECT a.id, a.run_id, a.node_id, a.attempt, a.graph_id, a.role, a.kind, a.mime_type, a.label, a.size_bytes, a.storage, a.uri, a.created_at,
              COALESCE(g.name, '(未知流水线)') AS graph_name
       FROM artifacts a LEFT JOIN graphs g ON g.id = a.graph_id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC, a.rowid DESC LIMIT ? OFFSET ?`,
    deleteArtifactsForRun: `DELETE FROM artifacts WHERE run_id = ?`,
    getGraphById: `SELECT doc, version FROM graphs WHERE id = ?`,
    getGraphMeta: `SELECT id, name, version, updated_at, origin_template_id FROM graphs WHERE id = ?`,
    listAllGraphs: `SELECT id, name, version, updated_at FROM graphs ORDER BY updated_at DESC`,
    getGraphOwnerId: `SELECT user_id FROM graphs WHERE id = ?`,
    finishRunById: `UPDATE runs SET status = ?, ended_at = ? WHERE id = ?`,
    markRunningById: `UPDATE runs SET status = 'running', ended_at = NULL, halted_node_id = NULL, halted_reason = NULL WHERE id = ?`,
    getRunById: `SELECT * FROM runs WHERE id = ?`,
    listRunsUnscoped: `SELECT r.id, r.graph_id, COALESCE(g.name, '(已删除产线)') AS graph_name, r.status, r.trigger, r.budget_usd, r.started_at, r.ended_at
       FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id
       ORDER BY r.started_at DESC LIMIT ? OFFSET ?`,
    listRunsByGraphUnscoped: `SELECT r.id, r.graph_id, COALESCE(g.name, '(已删除产线)') AS graph_name, r.status, r.trigger, r.budget_usd, r.started_at, r.ended_at
       FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id
       WHERE r.graph_id = ?
       ORDER BY r.started_at DESC LIMIT ?`,
    // Monetization (design-monetization): subscriptions + usage ledger.
    getSubscription: `SELECT plan, status, provider, external_id, current_period_start, current_period_end
       FROM subscriptions WHERE user_id = ?`,
    upsertSubscription: `INSERT INTO subscriptions (user_id, plan, status, provider, external_id, current_period_start, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         plan = excluded.plan, status = excluded.status, provider = excluded.provider,
         external_id = excluded.external_id, current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end, updated_at = excluded.updated_at`,
    usageForMetric: `SELECT COALESCE(SUM(amount), 0) AS total FROM usage_ledger WHERE user_id = ? AND period_start = ? AND metric = ?`,
    accumulateUsage: `INSERT INTO usage_ledger (user_id, period_start, metric, amount, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, period_start, metric) DO UPDATE SET amount = amount + excluded.amount, updated_at = excluded.updated_at`,
    countActiveRuns: `SELECT COUNT(*) AS n FROM runs WHERE user_id = ? AND status IN ('running', 'halted')`,
  };

  return {
    /** Lightweight liveness probe for the readiness check: answers whether the
     *  sqlite connection still executes a statement. */
    async ping() {
      return (await exec.get("SELECT 1 AS ok", []) as { ok: number }).ok === 1;
    },
    /** Idempotent run creation: maps (userId, idempotencyKey) → runId. */
    async getIdempotentRun(userId: string, key: string) {
      const row = await exec.get("SELECT run_id FROM idempotency_keys WHERE user_id = ? AND key = ?", [userId, key]) as { run_id: string } | undefined;
      return row?.run_id ?? null;
    },
    async saveIdempotentRun(userId: string, key: string, runId: string) {
      await exec.run("INSERT OR IGNORE INTO idempotency_keys (user_id, key, run_id, created_at) VALUES (?, ?, ?, ?)", [userId, key, runId, Date.now()]);
    },
    /**
     * Prunes events older than the given epoch-millisecond cutoff. Safe because
     * `runs.snapshot` already holds each run's full state (design-scaling §2.1),
     * so archived event history can be reconstructed from the snapshot. Returns
     * the number of rows deleted.
     */
    async pruneOldEvents(before: number) {
      return Number((await exec.run("DELETE FROM events WHERE ts < ?", [before])).changes);
    },
    /** Runs sqlite's own integrity check; true when the database is consistent. */
    async verifyIntegrity() {
      if (dialect === "postgres") {
        // PostgreSQL has no single integrity_check equivalent; a live SELECT
        // confirms the connection and catalog are still readable.
        await exec.get("SELECT 1 AS ok", []);
        return true;
      }
      const rows = await exec.all("PRAGMA integrity_check", []) as Array<{ integrity_check: string }>;
      return rows.length === 1 && rows[0]!.integrity_check === "ok";
    },
    async createUser(id: string, email: string, passwordHash: string) {
      // RBAC P0 (design-rbac.md): the very first account bootstraps the
      // instance owner. The single-owner invariant is enforced by the partial
      // unique index idx_users_owner.
      const role =
        (await exec.get(stmts.countOwners, []) as { n: number }).n === 0 ? "owner" : "user";
      await exec.run(stmts.createUser, [id, email, passwordHash, role]);
      return { id, email, role };
    },
    async findUserByEmail(email: string) {
      return await exec.get(stmts.findUserByEmail, [email]) as
        | { id: string; email: string; role: string; created_at: string }
        | undefined;
    },
    async findUserById(id: string) {
      return await exec.get(stmts.findUserById, [id]) as
        | { id: string; email: string; role: string; created_at: string }
        | undefined;
    },
    async findUserPasswordHash(id: string) {
      const row = await exec.get(stmts.findUserPasswordHash, [id]) as { password_hash: string } | undefined;
      return row?.password_hash;
    },
    /** Total account count — gates self-registration once the first user exists (M3). */
    async countUsers(): Promise<number> {
      return (await exec.get(stmts.countUsers, []) as { n: number }).n;
    },
    async updateUserPasswordHash(id: string, passwordHash: string) {
      await exec.run(stmts.updateUserPasswordHash, [passwordHash, id]);
    },
    /** RBAC P3: full account list for the owner's admin panel. */
    async listUsers(): Promise<Array<{ id: string; email: string; role: string; created_at: string }>> {
      return await exec.all(stmts.listUsers, []) as Array<{ id: string; email: string; role: string; created_at: string }>;
    },
    /** RBAC P3: grant or revoke the global admin role (owner-only route). */
    async updateUserRole(id: string, role: string) {
      await exec.run(stmts.updateUserRole, [role, id]);
    },

    // ---- Monetization (design-monetization §5): subscription + usage ledger ----
    async loadSubscription(userId: string):
      Promise<{
          plan: string;
          status: string;
          provider: string | null;
          externalId: string | null;
          currentPeriodStart: number;
          currentPeriodEnd: number;
        }
      | undefined> {
      const row = await exec.get(stmts.getSubscription, [userId]) as
        | {
            plan: string;
            status: string;
            provider: string | null;
            external_id: string | null;
            current_period_start: number;
            current_period_end: number;
          }
        | undefined;
      if (!row) return undefined;
      return {
        plan: row.plan,
        status: row.status,
        provider: row.provider,
        externalId: row.external_id,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
      };
    },
    async saveSubscription(
      userId: string,
      plan: string,
      status: string,
      opts: { provider?: string; externalId?: string; periodStart?: number; periodEnd?: number } = {},
    ) {
      const now = Date.now();
      const periodStart = opts.periodStart ?? now;
      const periodEnd = opts.periodEnd ?? now + 30 * 24 * 60 * 60 * 1000;
      await exec.run(stmts.upsertSubscription, [userId, plan, status, opts.provider ?? null, opts.externalId ?? null, periodStart, periodEnd, now, now]);
    },
    async usageFor(userId: string, metric: string, periodStart: number): Promise<number> {
      return (await exec.get(stmts.usageForMetric, [userId, periodStart, metric]) as { total: number }).total;
    },
    async accumulateUsage(userId: string, periodStart: number, metric: string, amount: number) {
      await exec.run(stmts.accumulateUsage, [userId, periodStart, metric, amount, Date.now()]);
    },
    async activeRuns(userId: string): Promise<number> {
      return (await exec.get(stmts.countActiveRuns, [userId]) as { n: number }).n;
    },

    /** Grant or overwrite a shared role (editor/viewer) on a resource. */
    async saveResourceAccess(resourceType: string, resourceId: string, userId: string, role: string) {
      await exec.run(stmts.saveResourceAccess, [resourceType, resourceId, userId, role, Date.now()]);
    },
    /** Revoke a user's shared access. Returns true when a row was removed. */
    async deleteResourceAccess(resourceType: string, resourceId: string, userId: string): Promise<boolean> {
      return (await exec.run(stmts.deleteResourceAccess, [resourceType, resourceId, userId])).changes > 0;
    },
    async getResourceAccess(resourceType: string, resourceId: string, userId: string): Promise<{ role: string } | undefined> {
      return await exec.get(stmts.getResourceAccess, [resourceType, resourceId, userId]) as
        | { role: string }
        | undefined;
    },
    /** All shared collaborators on one resource (for the owner's ACL UI). */
    async listResourceAccess(resourceType: string, resourceId: string): Promise<Array<{ user_id: string; role: string; created_at: number }>> {
      return await exec.all(stmts.listResourceAccess, [resourceType, resourceId]) as Array<{
        user_id: string;
        role: string;
        created_at: number;
      }>;
    },
    /** Everything shared TO one user (for list filtering). */
    async listResourceAccessForUser(resourceType: string, userId: string): Promise<Array<{ resource_id: string; role: string }>> {
      return await exec.all(stmts.listResourceAccessForUser, [resourceType, userId]) as Array<{
        resource_id: string;
        role: string;
      }>;
    },
    /** The run row's owner + graph, for resolving a run back to its graph ACL. */
    async getRunGraphRef(runId: string): Promise<{ userId: string; graphId: string } | undefined> {
      const row = await exec.get(stmts.getRunGraphRef, [runId]) as
        | { user_id: string; graph_id: string }
        | undefined;
      return row ? { userId: row.user_id, graphId: row.graph_id } : undefined;
    },
    /** The artifact row's owner + graph, for resolving an artifact back to its graph ACL. */
    async getArtifactGraphRef(artifactId: string): Promise<{ userId: string; graphId: string; runId: string } | undefined> {
      const row = await exec.get(stmts.getArtifactGraphRef, [artifactId]) as
        | { user_id: string; graph_id: string | null; run_id: string }
        | undefined;
      return row
        ? { userId: row.user_id, graphId: row.graph_id ?? "", runId: row.run_id }
        : undefined;
    },
    /** The owning user of a graph, or undefined when the graph does not exist. */
    async graphOwnerId(graphId: string): Promise<string | undefined> {
      const row = await exec.get(stmts.getGraphOwnerId, [graphId]) as { user_id: string } | undefined;
      return row?.user_id;
    },

    /**
     * Persist a graph. When `expectedVersion` is given the update is
     * conditional: it returns { ok:false, conflict:true } if the stored version
     * no longer matches (another tab saved first), instead of overwriting.
     * On success returns the new version.
     */
    async saveGraph(
      graph: Graph,
      at: number,
      userId: string,
      expectedVersion?: number,
      originTemplateId?: string | null,
    ): Promise<{ ok: true; version: number } | { ok: false; conflict: true; serverVersion: number | null } | { ok: false; foreign: true }> {
      const doc = JSON.stringify(sealGraphDoc(graph));
      // Cross-tenant guard (H1): an upsert must never overwrite a graph that
      // shares this id but belongs to another user. Checked in the app layer
      // for a clear error; the UPSERT's WHERE clause is the SQL backstop.
      const ownerRow = await exec.get(stmts.getGraphOwnerId, [graph.id]) as { user_id: string } | undefined;
      if (ownerRow && ownerRow.user_id !== userId) {
        return { ok: false, foreign: true };
      }
      if (expectedVersion != null) {
        const result = await exec.run(stmts.updateGraphIfVersion, [graph.name, doc, at, graph.id, expectedVersion, userId]);
        if (result.changes === 0) {
          const row = await exec.get(stmts.getGraphVersion, [graph.id, userId]) as { version: number } | undefined;
          return { ok: false, conflict: true, serverVersion: row?.version ?? null };
        }
        return { ok: true, version: expectedVersion + 1 };
      }
      await exec.run(stmts.insertGraph, [graph.id, userId, graph.name, doc, originTemplateId ?? null, at]);
      const row = await exec.get(stmts.getGraphVersion, [graph.id, userId]) as { version: number };
      return { ok: true, version: row.version };
    },

    async getGraph(id: string, userId: string): Promise<(Graph & { version: number; originTemplateId: string | null }) | null> {
      const row = await exec.get(stmts.getGraph, [id, userId]) as { doc: string; version: number; origin_template_id: string | null } | undefined;
      return row ? { ...(openGraphDoc(JSON.parse(row.doc) as Graph)), version: row.version, originTemplateId: row.origin_template_id } : null;
    },

    /** Unscoped list-row metadata (id/name/version/updated_at) for one graph —
     *  used to append shared graphs (design-rbac P1) to the caller's list. */
    async getGraphMeta(id: string): Promise<{
      id: string;
      name: string;
      version: number;
      updated_at: number;
      originTemplateId: string | null;
    } | undefined> {
      const row = await exec.get(stmts.getGraphMeta, [id]) as
        | { id: string; name: string; version: number; updated_at: number; origin_template_id: string | null }
        | undefined;
      return row && { id: row.id, name: row.name, version: row.version, updated_at: row.updated_at, originTemplateId: row.origin_template_id };
    },

    async listGraphs(userId: string): Promise<Array<{
      id: string;
      name: string;
      version: number;
      updated_at: number;
      originTemplateId: string | null;
    }>> {
      const rows = await exec.all(stmts.listGraphs, [userId]) as Array<{
        id: string; name: string; version: number; updated_at: number; origin_template_id: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        version: r.version,
        updated_at: r.updated_at,
        originTemplateId: r.origin_template_id,
      }));
    },

    /**
     * Load a graph's persisted variables (cross-run state from prior runs).
     * Tenant-scoped: joins `graphs` so foreign graphs return an empty map.
     */
    async loadGraphVariables(graphId: string, userId: string): Promise<Record<string, unknown>> {
      const rows = await exec.all(stmts.listGraphVariables, [userId, graphId]) as Array<{ key: string; value: string }>;
      const out: Record<string, unknown> = {};
      for (const r of rows) {
        try {
          // decryptString returns legacy plaintext rows unchanged (no enc:
          // prefix), so pre-encryption data still loads.
          out[r.key] = JSON.parse(decryptString(r.value));
        } catch {
          out[r.key] = r.value;
        }
      }
      return out;
    },

    /**
     * Persist a graph's variables after a run (optimistic last-writer-wins,
     * per-key upsert — concurrent runs only overwrite the keys they wrote).
     * Tenant-scoped: silently no-ops when the graph isn't owned by the user.
     */
    async saveGraphVariables(graphId: string, userId: string, vars: Record<string, unknown>): Promise<void> {
      const owner = await exec.get(stmts.getGraphOwnerId, [graphId]) as { user_id: string } | undefined;
      if (!owner || owner.user_id !== userId) return;
      const at = Date.now();
      for (const [key, value] of Object.entries(vars)) {
        // Variables may hold credentials (L5): seal at rest, not plaintext.
        await exec.run(stmts.saveGraphVariable, [graphId, key, encryptString(JSON.stringify(value)), at]);
      }
    },


    async deleteGraph(id: string, userId: string) {
      await exec.run(stmts.deleteGraph, [id, userId]);
      // Drop stale ACL rows so a future graph with the same id can't inherit
      // old shares (and so the collaborator lists don't leak deleted graphs).
      await exec.run(stmts.deleteResourceAccessForResource, ["graph", id]);
    },

    async createRun(args: {
      id: string;
      userId: string;
      graph: Graph;
      budgetUsd: number | null;
      at: number;
      trigger?: string;
      input?: string;
      abGroup?: string | null;
      abArm?: string | null;
      abTarget?: string | null;
    }) {
      await exec.run(stmts.createRun, [args.id, args.userId, args.graph.id, JSON.stringify(sealGraphDoc(args.graph)), "running", args.trigger ?? "manual", args.input ?? null, args.budgetUsd, args.at, args.abGroup ?? null, args.abArm ?? null, args.abTarget ?? null]);
    },

    async finishRun(
      runId: string,
      userId: string,
      status: string,
      at: number,
      halted?: { nodeId: string | null; reason: string | null },
    ) {
      await exec.run(stmts.finishRun, [status, at, halted?.nodeId ?? null, halted?.reason ?? null, runId, userId]);
    },

    async markRunning(runId: string, userId: string) {
      await exec.run(stmts.markRunning, [runId, userId]);
    },

    async runExists(runId: string, userId: string): Promise<boolean> {
      return await exec.get(stmts.getRun, [runId, userId]) !== undefined;
    },

    async getRun(runId: string, userId: string) {
      const row = await exec.get(stmts.getRun, [runId, userId]) as
        | {
            id: string;
            graph_id: string;
            snapshot: string;
            status: string;
            trigger: string;
            input: string | null;
            budget_usd: number | null;
            started_at: number;
            ended_at: number | null;
          }
        | undefined;
      return row ? { ...row, snapshot: openDocString(row.snapshot) } : undefined;
    },

    async listRuns(
      userId: string,
      opts: { limit?: number; offset?: number; graphId?: string; status?: string; graphIds?: string[] } = {},
    ) {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
      const offset = Math.max(opts.offset ?? 0, 0);
      // When `graphIds` is supplied (shared-graph visibility, design-rbac P1),
      // scope by graph membership instead of run ownership — runs started by
      // collaborators are saved under the graph owner, so user_id scoping
      // would hide them from the collaborator.
      const where: string[] = opts.graphIds ? ["r.graph_id IN (" + opts.graphIds.map(() => "?").join(",") + ")"] : ["r.user_id = ?"];
      const params: (string | number)[] = opts.graphIds ? [...opts.graphIds] : [userId];
      if (opts.graphId) {
        where.push("r.graph_id = ?");
        params.push(opts.graphId);
      }
      if (opts.status) {
        where.push("r.status = ?");
        params.push(opts.status);
      }
      const clause = `WHERE ${where.join(" AND ")}`;
      const rows = await exec.all(`SELECT r.id AS id, r.graph_id AS graph_id, g.name AS graph_name,
                  r.status AS status, r.trigger AS trigger, r.budget_usd AS budget_usd,
                  r.started_at AS started_at, r.ended_at AS ended_at
           FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id
           ${clause}
           ORDER BY r.started_at DESC
           LIMIT ? OFFSET ?`, [...params, limit, offset]) as Array<{
        id: string;
        graph_id: string;
        graph_name: string;
        status: string;
        trigger: string;
        budget_usd: number | null;
        started_at: number;
        ended_at: number | null;
      }>;
      const total = (
        await exec.get(`SELECT COUNT(*) AS n FROM runs r ${clause}`, [...params]) as { n: number }
      ).n;
      return { rows, total };
    },

    /**
     * Runs waiting on a human decision, oldest first so the longest-blocked item
     * surfaces at the top of the review queue.
     */
    async pendingReviews(userId: string, opts: { limit?: number; offset?: number; graphId?: string; graphIds?: string[] } = {}) {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
      const offset = Math.max(opts.offset ?? 0, 0);
      // With graphIds (shared-graph visibility), scope by graph membership
      // instead of run ownership — halted runs on shared graphs belong to the
      // graph owner but must surface to editors who can decide on them.
      const where: string[] = opts.graphIds
        ? ["r.graph_id IN (" + opts.graphIds.map(() => "?").join(",") + ")", "r.status = 'halted'"]
        : ["r.user_id = ?", "r.status = 'halted'"];
      const params: (string | number)[] = opts.graphIds ? [...opts.graphIds] : [userId];
      if (opts.graphId) {
        where.push("r.graph_id = ?");
        params.push(opts.graphId);
      }
      const clause = `WHERE ${where.join(" AND ")}`;
      const rows = await exec.all(`SELECT r.id AS id, r.graph_id AS graph_id, COALESCE(g.name, '(已删除产线)') AS graph_name,
                  r.halted_node_id AS halted_node_id, r.halted_reason AS halted_reason,
                  r.trigger AS trigger, r.ab_group AS ab_group, r.ab_arm AS ab_arm,
                  r.started_at AS started_at, COALESCE(r.ended_at, r.started_at) AS halted_at
           FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id
           ${clause}
           ORDER BY COALESCE(r.ended_at, r.started_at) ASC
           LIMIT ? OFFSET ?`, [...params, limit, offset]) as Array<{
        id: string;
        graph_id: string;
        graph_name: string;
        halted_node_id: string | null;
        halted_reason: string | null;
        trigger: string;
        ab_group: string | null;
        ab_arm: string | null;
        started_at: number;
        halted_at: number;
      }>;
      const total = (
        await exec.get(`SELECT COUNT(*) AS n FROM runs r ${clause}`, [...params]) as { n: number }
      ).n;
      return { rows, total };
    },

    /** Node-level cost/token aggregates for a single run, used by comparison views. */
    async runStats(runId: string) {
      const row = await exec.get(`SELECT COUNT(*) AS nodes,
                  COALESCE(SUM(tokens_in), 0) AS tokens_in,
                  COALESCE(SUM(tokens_out), 0) AS tokens_out,
                  COALESCE(SUM(cost_usd), 0) AS cost_usd
           FROM node_runs WHERE run_id = ?`, [runId]) as {
        nodes: number;
        tokens_in: number;
        tokens_out: number;
        cost_usd: number;
      };
      return {
        nodes: row.nodes,
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        costUsd: row.cost_usd,
      };
    },

    /** Persists the event and folds it into the node_runs projection. */
    async record(runId: string, event: RunEvent) {
      await exec.run(stmts.insertEvent, [runId, event.seq, event.ts, EVENT_SCHEMA_VERSION, event.type, JSON.stringify(event)]);

      switch (event.type) {
        case "node.started":
          await exec.run(stmts.upsertNodeRun, [runId, event.nodeId, event.attempt, event.variant ?? "main", "running"]);
          break;
        case "node.reasoning":
          // Ensure the row exists then append.
          await exec.run(stmts.upsertNodeRun, [runId, event.nodeId, event.attempt, event.variant ?? "main", "running"]);
          await exec.run(stmts.appendReasoning, [event.text, runId, event.nodeId, event.attempt, event.variant ?? "main"]);
          break;
        case "node.finished":
          await exec.run(stmts.upsertNodeRun, [runId, event.nodeId, event.attempt, event.variant ?? "main", "done"]);
          await exec.run(stmts.finishNodeRun, ["done", event.output, event.usage.tokensIn, event.usage.tokensOut, event.usage.cachedTokens ?? 0, event.usage.reasoningTokens ?? 0, event.usage.costUsd, event.usage.units ? JSON.stringify(event.usage.units) : null, runId, event.nodeId, event.attempt, event.variant ?? "main"]);
          break;
        case "node.failed":
          await exec.run(stmts.upsertNodeRun, [runId, event.nodeId, event.attempt, event.variant ?? "main", "failed"]);
          await exec.run(stmts.failNodeRun, [event.error, event.errorCode ?? null, runId, event.nodeId, event.attempt, event.variant ?? "main"]);
          break;
        case "gate.verdict":
          // Persist the judge's quality score so the eval report can aggregate
          // it per prompt version (the "evaluation linkage").
          if (typeof event.score === "number") {
            await exec.run(stmts.setNodeScore, [event.score, runId, event.nodeId, event.attempt, event.variant ?? "main"]);
          }
          break;
      }
    },

    async events(runId: string): Promise<RunEvent[]> {
      const rows = await exec.all(stmts.listEvents, [runId]) as { payload: string }[];
      return rows.map((r) => JSON.parse(r.payload) as RunEvent);
    },

    /**
     * Bounded event window for paginated reads. `after` is exclusive (pass -1
     * to start from the beginning). Fetches `limit + 1` rows so the caller can
     * detect `hasMore`; the extra row is not returned.
     */
    async eventsRange(runId: string, after: number, limit: number): Promise<{
      events: RunEvent[];
      nextCursor: number | null;
    }> {
      const rows = await exec.all(stmts.listEventsRange, [runId, after, limit + 1]) as Array<{
        seq: number;
        payload: string;
      }>;
      const page = rows.slice(0, limit);
      const events = page.map((r) => JSON.parse(r.payload) as RunEvent);
      const nextCursor = rows.length > limit ? page.at(-1)!.seq : null;
      return { events, nextCursor };
    },

    async nextSeq(runId: string): Promise<number> {
      const row = await exec.get(stmts.maxSeq, [runId]) as { seq: number };
      return row.seq + 1;
    },

    /** Mark any runs left in 'running' state (e.g. after a server restart) as interrupted. */
    async markZombiesInterrupted(at: number) {
      await exec.run(stmts.markInterrupted, [at]);
    },

    async insertArtifact(a: StoredArtifact, userId: string) {
      await exec.run(stmts.insertArtifact, [a.id, a.runId, userId, a.nodeId, a.attempt, a.variant ?? "main", a.graphId ?? null, a.role ?? null, a.kind, a.mimeType, a.label, a.sizeBytes, a.storage, a.uri, a.createdAt]);
    },

    async listArtifactsForRun(runId: string, userId: string): Promise<StoredArtifact[]> {
      return mapArtifacts(await exec.all(stmts.listArtifactsByRun, [runId, userId]) as ArtifactRow[]);
    },

    /** Unscoped run-artifact list for shared-graph viewers (design-rbac P1).
     *  Callers must have already verified graph-level access via rbac. */
    async listArtifactsForRunUnscoped(runId: string): Promise<StoredArtifact[]> {
      return mapArtifacts(await exec.all(stmts.listArtifactsByRunUnscoped, [runId]) as ArtifactRow[]);
    },

    async getArtifact(id: string, userId: string): Promise<StoredArtifact | null> {
      const row = await exec.get(stmts.getArtifact, [id, userId]) as ArtifactRow | undefined;
      return row ? mapArtifact(row) : null;
    },

    /** Engine-only: resolves an artifact the calling run already owns. Never wire to a route. */
    async getArtifactUnscoped(id: string): Promise<StoredArtifact | null> {
      const row = await exec.get(stmts.getArtifactUnscoped, [id]) as ArtifactRow | undefined;
      return row ? mapArtifact(row) : null;
    },

    async listArtifacts(userId: string, limit = 100, offset = 0, graphIds?: string[]): Promise<StoredArtifact[]> {
      // With `graphIds` (shared-graph visibility), show artifacts whose graph
      // is visible to the caller OR that the caller owns (e.g. uploads not
      // yet attached to a run). Without it, keep the legacy user_id scoping.
      if (!graphIds) {
        return mapArtifacts(await exec.all(stmts.listArtifacts, [userId, limit, offset]) as ArtifactRow[]);
      }
      const placeholders = graphIds.map(() => "?").join(",");
      const rows = await exec.all(`SELECT a.id, a.run_id, a.node_id, a.attempt, a.graph_id, a.role, a.kind, a.mime_type, a.label, a.size_bytes, a.storage, a.uri, a.created_at,
                  COALESCE(g.name, '(未知流水线)') AS graph_name
           FROM artifacts a LEFT JOIN graphs g ON g.id = a.graph_id
           WHERE a.user_id = ? OR a.graph_id IN (${placeholders})
           ORDER BY a.created_at DESC, a.rowid DESC LIMIT ? OFFSET ?`, [userId, ...graphIds, limit, offset]) as ArtifactRow[];
      return mapArtifacts(rows);
    },

    async deleteRun(runId: string, userId: string) {
      await exec.run(stmts.deleteArtifactsForRun, [runId]);
      await exec.run(stmts.deleteEvents, [runId]);
      await exec.run(stmts.deleteNodeRuns, [runId]);
      await exec.run(stmts.deleteRun, [runId, userId]);
    },

    /**
     * Aggregate cost/token usage over completed (non-running) node attempts.
     * `from`/`to` are epoch milliseconds filtering by run start time.
     */
    async costReport(opts: { from?: number; to?: number; userId?: string } = {}) {
      const where: string[] = ["r.status != 'running'"];
      const params: (string | number)[] = [];
      if (opts.userId) {
        where.push("r.user_id = ?");
        params.push(opts.userId);
      }
      if (opts.from !== undefined) {
        where.push("r.started_at >= ?");
        params.push(opts.from);
      }
      if (opts.to !== undefined) {
        where.push("r.started_at <= ?");
        params.push(opts.to);
      }
      const clause = `WHERE ${where.join(" AND ")}`;

      const totals = await exec.get(`SELECT
             COALESCE(SUM(n.cost_usd), 0)      AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)     AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0)    AS tokens_out,
             COALESCE(SUM(n.cached_tokens), 0) AS cached_tokens,
             COALESCE(SUM(n.reasoning_tokens), 0) AS reasoning_tokens,
             COUNT(DISTINCT n.run_id)          AS runs
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}`, [...params]) as {
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
        cached_tokens: number;
        reasoning_tokens: number;
        runs: number;
      };

      const byGraph = await exec.all(`SELECT
             r.graph_id AS graph_id,
             COALESCE(g.name, '(已删除产线)') AS graph_name,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out,
             COUNT(DISTINCT n.run_id)       AS runs
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           LEFT JOIN graphs g ON g.id = r.graph_id
           ${clause}
           GROUP BY r.graph_id
           ORDER BY cost_usd DESC`, [...params]) as Array<{
        graph_id: string;
        graph_name: string;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
        runs: number;
      }>;

      const byNode = await exec.all(`SELECT r.graph_id AS graph_id,
             COALESCE(g.name, '(已删除产线)') AS graph_name,
             n.node_id AS node_id,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out,
             COUNT(*) AS attempts,
             SUM(CASE WHEN n.attempt > 1 THEN 1 ELSE 0 END) AS reworks
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           LEFT JOIN graphs g ON g.id = r.graph_id
           ${clause}
           GROUP BY r.graph_id, n.node_id
           ORDER BY cost_usd DESC
           LIMIT 50`, [...params]) as Array<{
        graph_id: string;
        graph_name: string;
        node_id: string;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
        attempts: number;
        reworks: number;
      }>;

      const byAttempt = await exec.all(`SELECT n.attempt AS attempt,
             COUNT(*) AS calls,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}
           GROUP BY n.attempt
           ORDER BY n.attempt`, [...params]) as Array<{
        attempt: number;
        calls: number;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
      }>;

      const byDay = await exec.all(`SELECT date(r.started_at / 1000, 'unixepoch', 'localtime') AS day,
             COUNT(DISTINCT n.run_id) AS runs,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}
           GROUP BY day
           ORDER BY day`, [...params]) as Array<{
        day: string;
        runs: number;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
      }>;

      const byWeek = await exec.all(`SELECT ${weekExpr} AS week,
             COUNT(DISTINCT n.run_id) AS runs,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}
           GROUP BY week
           ORDER BY week`, [...params]) as Array<{
        week: string;
        runs: number;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
      }>;

      const byMonth = await exec.all(`SELECT ${monthExpr} AS month,
             COUNT(DISTINCT n.run_id) AS runs,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}
           GROUP BY month
           ORDER BY month`, [...params]) as Array<{
        month: string;
        runs: number;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
      }>;

      // Resolve node display names from the most recent run snapshot per
      // graph. The live graph may have been renamed/deleted since, but the
      // snapshot frozen on the run always reflects what actually executed.
      const snapshotRows = await exec.all(`SELECT graph_id, snapshot FROM runs r
           WHERE id = (SELECT id FROM runs WHERE graph_id = r.graph_id ORDER BY started_at DESC LIMIT 1)`, []) as Array<{ graph_id: string; snapshot: string }>;
      const nodeNames = new Map<string, string>();
      for (const row of snapshotRows) {
        try {
          const g = JSON.parse(openDocString(row.snapshot)) as { nodes?: Array<{ id: string; name: string }> };
          for (const n of g.nodes ?? []) nodeNames.set(`${row.graph_id}:${n.id}`, n.name);
        } catch {
          // malformed snapshot — fall back to node_id
        }
      }
      const byNodeNamed = byNode.map((n) => ({
        ...n,
        node_name: nodeNames.get(`${n.graph_id}:${n.node_id}`) ?? n.node_id,
      }));

      return { totals, byGraph, byNode: byNodeNamed, byAttempt, byDay, byWeek, byMonth };
    },

    /** Raw rows for CSV export — same aggregation as costReport, flat shape. */
    async costRows(opts: { from?: number; to?: number; userId?: string } = {}) {
      const { byGraph, byNode, byAttempt, byDay } = await this.costReport(opts);
      return { byGraph, byNode, byAttempt, byDay };
    },

    /**
     * Total cost accrued across finished runs that started within the given
     * calendar month (local time). Used to evaluate the monthly budget guard.
     */
    async costForMonth(year: number, month: number, userId?: string): Promise<number> {
      const start = new Date(year, month - 1, 1).getTime();
      const end = new Date(year, month, 1).getTime();
      const where: string[] = ["r.status != 'running'", "r.started_at >= ?", "r.started_at < ?"];
      const params: (string | number)[] = [];
      // Placeholders bind positionally in WHERE order (started_at >= ?, started_at < ?,
      // then user_id = ?), so params must be [start, end, userId] — pushing userId
      // first would shift start/end and return 0 whenever a user is scoped.
      params.push(start, end);
      if (userId) {
        where.push("r.user_id = ?");
        params.push(userId);
      }
      const row = await exec.get(`SELECT COALESCE(SUM(n.cost_usd), 0) AS cost
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           WHERE ${where.join(" AND ")}`, [...params]) as { cost: number };
      return row.cost;
    },

    async evalReport(opts: { graphId?: string; from?: number; to?: number; userId?: string } = {}) {
      const where: string[] = ["r.status != 'running'"];
      const params: (string | number)[] = [];
      if (opts.userId) {
        where.push("r.user_id = ?");
        params.push(opts.userId);
      }
      if (opts.graphId) {
        where.push("r.graph_id = ?");
        params.push(opts.graphId);
      }
      if (opts.from !== undefined) {
        where.push("r.started_at >= ?");
        params.push(opts.from);
      }
      if (opts.to !== undefined) {
        where.push("r.started_at <= ?");
        params.push(opts.to);
      }
      const clause = `WHERE ${where.join(" AND ")}`;

      const runRows = await exec.all(`SELECT
             r.id AS id,
             r.graph_id AS graph_id,
             r.started_at AS started_at,
             r.status = 'done' AS passed,
             (r.ended_at - r.started_at) AS duration_ms,
             COUNT(n.node_id) AS node_attempts,
             COUNT(DISTINCT n.node_id) AS nodes,
             COALESCE((SELECT AVG(score) FROM node_runs WHERE run_id = r.id AND score IS NOT NULL), 0) AS avg_score
           FROM runs r LEFT JOIN node_runs n ON n.run_id = r.id
           ${clause}
           GROUP BY r.id`, [...params]) as Array<{
        id: string;
        graph_id: string;
        started_at: number;
        passed: number;
        duration_ms: number | null;
        node_attempts: number;
        nodes: number;
        avg_score: number;
      }>;

      const summarize = (rows: typeof runRows) => {
        const total = rows.length;
        const passed = rows.reduce((acc, r) => acc + (r.passed ? 1 : 0), 0);
        const ended = rows.filter((r) => r.duration_ms != null);
        const rework = rows.reduce((acc, r) => acc + Math.max(0, r.node_attempts - r.nodes), 0);
        const duration = ended.length
          ? ended.reduce((acc, r) => acc + (r.duration_ms ?? 0), 0) / ended.length
          : 0;
        const scored = rows.filter((r) => r.avg_score > 0);
        const avgScore = scored.length
          ? scored.reduce((acc, r) => acc + r.avg_score, 0) / scored.length
          : 0;
        return {
          runs: total,
          passed,
          passRate: total ? passed / total : 0,
          avgRework: total ? rework / total : 0,
          avgDurationMs: duration,
          avgScore,
        };
      };

      const byGraphMap = new Map<string, typeof runRows>();
      for (const r of runRows) {
        const arr = byGraphMap.get(r.graph_id) ?? [];
        arr.push(r);
        byGraphMap.set(r.graph_id, arr);
      }
      const names = new Map(
        (opts.userId ? await this.listGraphs(opts.userId) : [] as Array<{ id: string; name: string }>)
          .map((g) => [g.id, g.name]),
      );
      const byGraph = [...byGraphMap.entries()].map(([graph_id, rows]) => ({
        graph_id,
        graph_name: names.get(graph_id) ?? "(已删除产线)",
        ...summarize(rows),
      }));

      const dayKey = (ms: number) => {
        const dt = new Date(ms);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      };
      const byDayMap = new Map<string, typeof runRows>();
      for (const r of runRows) {
        const key = dayKey(r.started_at);
        const arr = byDayMap.get(key) ?? [];
        arr.push(r);
        byDayMap.set(key, arr);
      }

      // Prompt-version grouping: each run's snapshot captures the exact prompts
      // that executed. Fingerprint the (model + prompt) of every agent node,
      // sorted, so changing a prompt yields a new version per graph. This lets
      // the user compare pass rate / rework before and after a prompt edit.
      const snapshotRows = (opts.userId ? await exec.all(stmts.evalSnapshots, [opts.userId]) : []) as Array<{
        id: string;
        graph_id: string;
        snapshot: string;
      }>;
      const inScope = new Set(runRows.map((r) => r.id));
      const promptOf = new Map<string, string>();
      for (const row of snapshotRows) {
        if (!inScope.has(row.id)) continue;
        try {
          const g = JSON.parse(openDocString(row.snapshot)) as {
            nodes?: Array<{ kind?: string; textGen?: { model?: string; prompt?: string } }>;
          };
          const sig = (g.nodes ?? [])
            .filter((n) => n.kind === "textGen")
            .map((n) => `${n.textGen?.model ?? ""}\0${n.textGen?.prompt ?? ""}`)
            .sort()
            .join("\n");
          promptOf.set(row.id, createHash("sha1").update(sig).digest("hex").slice(0, 8));
        } catch {
          promptOf.set(row.id, "unknown");
        }
      }

      // Assign a stable per-graph version index (v1, v2, ...) in first-seen order.
      const promptVersions = new Map<string, Map<string, string>>();
      const byPromptMap = new Map<string, Map<string, typeof runRows>>();
      for (const r of runRows) {
        const fp = promptOf.get(r.id) ?? "unknown";
        let versions = promptVersions.get(r.graph_id);
        if (!versions) {
          versions = new Map();
          promptVersions.set(r.graph_id, versions);
        }
        if (!versions.has(fp)) versions.set(fp, `v${versions.size + 1}`);
        let groups = byPromptMap.get(r.graph_id);
        if (!groups) {
          groups = new Map();
          byPromptMap.set(r.graph_id, groups);
        }
        const arr = groups.get(fp) ?? [];
        arr.push(r);
        groups.set(fp, arr);
      }

      const byPrompt = [...byPromptMap.entries()].flatMap(([graph_id, groups]) =>
        [...groups.entries()].map(([fp, rows]) => ({
          graph_id,
          graph_name: names.get(graph_id) ?? "(已删除产线)",
          version: promptVersions.get(graph_id)!.get(fp)!,
          fingerprint: fp,
          ...summarize(rows),
        })),
      );

      return {
        totals: summarize(runRows),
        byGraph,
        byDay: [...byDayMap.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([day, rows]) => ({ day, ...summarize(rows) })),
        byPrompt,
      };
    },

    /** Graph id that an A/B experiment group belongs to (for access checks). */
    async abGroupGraphId(groupId: string): Promise<string | undefined> {
      const row = await exec.get(`SELECT graph_id FROM runs WHERE ab_group = ? LIMIT 1`, [groupId]) as { graph_id: string } | undefined;
      return row?.graph_id;
    },

    async abReport(groupId: string, userId: string): Promise<ABReport | null> {
      const rows = await exec.all(`SELECT
             r.ab_arm AS arm,
             r.ab_target AS target,
             COUNT(*) AS runs,
             SUM(CASE WHEN r.status = 'done' THEN 1 ELSE 0 END) AS done,
             AVG(CASE WHEN r.ended_at IS NOT NULL THEN (r.ended_at - r.started_at) END) AS avgDurationMs,
             AVG((SELECT COALESCE(AVG(score), 0) FROM node_runs nr WHERE nr.run_id = r.id)) AS avgScore,
             AVG((SELECT COUNT(*) FROM node_runs nr WHERE nr.run_id = r.id AND nr.attempt > 1)) AS avgRework,
             SUM((SELECT COALESCE(SUM(cost_usd), 0) FROM node_runs nr WHERE nr.run_id = r.id)) AS totalCost
           FROM runs r
           WHERE r.ab_group = ? AND r.user_id = ?
           GROUP BY r.ab_arm, r.ab_target
           ORDER BY r.ab_arm`, [groupId, userId]) as Array<{
        arm: string;
        target: string | null;
        runs: number;
        done: number;
        avgDurationMs: number | null;
        avgScore: number | null;
        avgRework: number | null;
        totalCost: number | null;
      }>;

      if (rows.length === 0) return null;

      const promptOf = new Map<string, string | null>();
      for (const r of rows) {
        const snap = await exec.get(`SELECT snapshot FROM runs WHERE ab_group = ? AND ab_arm = ? AND user_id = ? AND snapshot IS NOT NULL LIMIT 1`, [groupId, r.arm, userId]) as { snapshot: string } | undefined;
        let prompt: string | null = null;
        if (snap) {
          try {
            const g = JSON.parse(openDocString(snap.snapshot)) as {
              nodes?: Array<{ id: string; textGen?: { prompt?: string } }>;
            };
            const node = (g.nodes ?? []).find((n) => n.id === r.target);
            prompt = node?.textGen?.prompt ?? null;
          } catch {
            /* ignore malformed snapshot */
          }
        }
        promptOf.set(r.arm, prompt);
      }

      const arms: ABArmReport[] = rows.map((r) => {
        const runs = Number(r.runs);
        const done = Number(r.done);
        const totalCost = Number(r.totalCost ?? 0);
        return {
          arm: r.arm,
          target: r.target,
          prompt: promptOf.get(r.arm) ?? null,
          runs,
          done,
          passed: done,
          passRate: runs ? done / runs : 0,
          avgRework: Number(r.avgRework ?? 0),
          avgDurationMs: Math.round(Number(r.avgDurationMs ?? 0)),
          avgScore: Number(r.avgScore ?? 0),
          avgCost: runs ? totalCost / runs : 0,
        };
      });

      const contenders = arms.filter((a) => a.done > 0);
      let recommendedArm: string | null = null;
      if (contenders.length > 0) {
        contenders.sort((a, b) => b.avgScore - a.avgScore || b.passRate - a.passRate);
        recommendedArm = contenders[0]!.arm;
      }

      return { groupId, arms, recommendedArm };
    },

    async listBrandTerms(userId: string) {
      return await exec.all(`SELECT id, term, note, created_at AS createdAt FROM brand_terms WHERE user_id = ? ORDER BY created_at ASC`, [userId]) as Array<{ id: string; term: string; note: string; createdAt: number }>;
    },

    // --- Per-user settings (16) ---
    async getSettings(userId: string): Promise<string | null> {
      const row = await exec.get(stmts.getSettings, [userId]) as { data: string } | undefined;
      return row?.data ?? null;
    },
    async saveSettings(userId: string, data: string): Promise<void> {
      await exec.run(stmts.saveSettings, [userId, data, Date.now()]);
    },
    // --- Audit log (29) ---
    async insertAudit(entry: {
      id: string;
      userId: string;
      action: string;
      objectType?: string;
      objectId?: string;
      detail?: string;
      ip?: string;
    }): Promise<void> {
      await exec.run(stmts.insertAudit, [entry.id, entry.userId, entry.action, entry.objectType ?? null, entry.objectId ?? null, entry.detail ?? null, entry.ip ?? null, Date.now()]);
    },
    async listAudit(
      userId: string,
      opts: { limit?: number; before?: number } = {},
    ): Promise<Array<Record<string, unknown>>> {
      const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
      const rows = (
        opts.before && opts.before > 0
          ? await exec.all(stmts.listAudit, [userId, opts.before, limit])
          : await exec.all(stmts.listAuditFirst, [userId, limit])
      ) as Array<Record<string, unknown>>;
      return rows;
    },
    /** RBAC P3: owner/admin cross-user audit listing, actor email resolved. */
    async listAuditAdmin(
      opts: { limit?: number; before?: number; userId?: string } = {},
    ): Promise<Array<Record<string, unknown>>> {
      const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
      if (opts.userId) {
        return (
          opts.before && opts.before > 0
            ? await exec.all(stmts.listAuditUser, [opts.userId, opts.before, limit])
            : await exec.all(stmts.listAuditUserFirst, [opts.userId, limit])
        ) as Array<Record<string, unknown>>;
      }
      return (
        opts.before && opts.before > 0
          ? await exec.all(stmts.listAuditAdmin, [opts.before, limit])
          : await exec.all(stmts.listAuditAdminFirst, [limit])
      ) as Array<Record<string, unknown>>;
    },
    // --- Announcements (30) ---
    async listActiveAnnouncements(now = Date.now()): Promise<Array<Record<string, unknown>>> {
      return await exec.all(stmts.listActiveAnnouncements, [now, now]) as Array<Record<string, unknown>>;
    },
    async listAnnouncements(): Promise<Array<Record<string, unknown>>> {
      return await exec.all(stmts.listAllAnnouncements, []) as Array<Record<string, unknown>>;
    },
    async getAnnouncement(id: string): Promise<Record<string, unknown> | undefined> {
      return await exec.get(stmts.getAnnouncement, [id]) as Record<string, unknown> | undefined;
    },
    async createAnnouncement(input: {
      id: string;
      titleZh: string;
      titleEn: string;
      bodyZh?: string | null;
      bodyEn?: string | null;
      level: string;
      startsAt: number;
      endsAt?: number | null;
      target?: string | null;
    }): Promise<void> {
      await exec.run(stmts.insertAnnouncement, [input.id, input.titleZh, input.titleEn, input.bodyZh ?? null, input.bodyEn ?? null, input.level, input.startsAt, input.endsAt ?? null, input.target ?? null, Date.now()]);
    },
    async updateAnnouncement(
      id: string,
      patch: {
        titleZh: string;
        titleEn: string;
        bodyZh?: string | null;
        bodyEn?: string | null;
        level: string;
        startsAt: number;
        endsAt?: number | null;
        target?: string | null;
      },
    ): Promise<boolean> {
      const res = await exec.run(stmts.updateAnnouncement, [patch.titleZh, patch.titleEn, patch.bodyZh ?? null, patch.bodyEn ?? null, patch.level, patch.startsAt, patch.endsAt ?? null, patch.target ?? null, id]) as { changes: number };
      return res.changes > 0;
    },
    async deleteAnnouncement(id: string): Promise<boolean> {
      const res = await exec.run(stmts.deleteAnnouncement, [id]) as { changes: number };
      return res.changes > 0;
    },
    async markAnnouncementRead(userId: string, announcementId: string): Promise<void> {
      await exec.run(stmts.insertAnnouncementRead, [userId, announcementId, Date.now()]);
    },
    async announcementReads(userId: string): Promise<Set<string>> {
      const rows = await exec.all(stmts.listAnnouncementReads, [userId]) as Array<{ announcement_id: string }>;
      return new Set(rows.map((r) => r.announcement_id));
    },
    /**
     * P3 targeting: does the user "use" this template? True when they own a
     * graph created from it, or one was shared to them (any role).
     */
    async userUsesTemplate(userId: string, templateId: string): Promise<boolean> {
      return (
        !!await exec.get(stmts.templateGraphOwned, [userId, templateId]) ||
        !!await exec.get(stmts.templateGraphShared, [userId, templateId])
      );
    },
    // --- User feedback (33, design-feedback.md) ---
    async insertFeedback(input: {
      id: string;
      userId: string;
      message: string;
      category: string;
      context: string;
      attachment?: Uint8Array | null;
      attachmentMime?: string | null;
    }): Promise<void> {
      await exec.run(stmts.insertFeedback, [input.id, input.userId, input.message, input.category, input.context, input.attachment ?? null, input.attachmentMime ?? null, "open", Date.now()]);
    },
    async countFeedbackSince(userId: string, since: number): Promise<number> {
      const row = await exec.get(stmts.countFeedbackSince, [userId, since]) as { n: number };
      return row?.n ?? 0;
    },
    async listFeedback(
      opts: { status?: string; limit?: number } = {},
    ): Promise<Array<Record<string, unknown>>> {
      const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
      if (opts.status) {
        return await exec.all(stmts.listFeedbackByStatus, [opts.status, limit]) as Array<Record<string, unknown>>;
      }
      return await exec.all(stmts.listFeedbackAll, [limit]) as Array<Record<string, unknown>>;
    },
    async getFeedback(id: string): Promise<Record<string, unknown> | undefined> {
      return await exec.get(stmts.getFeedback, [id]) as Record<string, unknown> | undefined;
    },
    async updateFeedbackStatus(id: string, status: string): Promise<void> {
      await exec.run(stmts.updateFeedbackStatus, [status, id]);
    },
    async addBrandTerm(userId: string, term: string, note = "") {
      const t = term.trim();
      if (!t) throw new Error("品牌词不能为空");
      const id = randomUUID();
      const now = Date.now();
      await exec.run(`INSERT INTO brand_terms (id, user_id, term, note, created_at) VALUES (?, ?, ?, ?, ?)`, [id, userId, t, note, now]);
      return { id, term: t, note, createdAt: now };
    },
    async deleteBrandTerm(id: string, userId: string) {
      await exec.run(`DELETE FROM brand_terms WHERE id = ? AND user_id = ?`, [id, userId]);
    },

    // --- Banned terms (F3 compliance: per-user supplementary banned words) ---
    async listBannedTerms(userId: string) {
      return await exec.all(`SELECT id, term, note, created_at AS createdAt FROM banned_terms WHERE user_id = ? ORDER BY created_at ASC`, [userId]) as Array<{ id: string; term: string; note: string; createdAt: number }>;
    },

    async addBannedTerm(userId: string, term: string, note = "") {
      const t = term.trim();
      if (!t) throw new Error("违禁词不能为空");
      const id = randomUUID();
      const now = Date.now();
      await exec.run(`INSERT INTO banned_terms (id, user_id, term, note, created_at) VALUES (?, ?, ?, ?, ?)`, [id, userId, t, note, now]);
      return { id, term: t, note, createdAt: now };
    },

    async deleteBannedTerm(id: string, userId: string) {
      await exec.run(`DELETE FROM banned_terms WHERE id = ? AND user_id = ?`, [id, userId]);
    },

    /** All banned terms of a user, comma-joined for the compliance check. */
    async bannedTermsText(userId: string): Promise<string> {
      const rows = await exec.all(`SELECT term FROM banned_terms WHERE user_id = ? ORDER BY created_at ASC`, [userId]) as Array<{ term: string }>;
      return rows.map((r) => r.term).join(",");
    },

    // --- Products (F4: reusable product library) ---
    async listProducts(
      userId: string,
      opts: { search?: string; category?: string; status?: string } = {},
    ): Promise<Product[]> {
      const where = ["user_id = ?"];
      const params: string[] = [userId];
      if (opts.category) {
        where.push("category = ?");
        params.push(opts.category);
      }
      if (opts.status) {
        where.push("status = ?");
        params.push(opts.status);
      }
      if (opts.search) {
        const like = `%${opts.search}%`;
        where.push(
          dialect === "postgres"
            ? "(name ILIKE ? OR brand ILIKE ? OR sku ILIKE ?)"
            : "(name LIKE ? OR brand LIKE ? OR sku LIKE ?)",
        );
        params.push(like, like, like);
      }
      const rows = await exec.all(`SELECT * FROM products WHERE ${where.join(" AND ")} ORDER BY created_at DESC`, [...params]) as Array<Record<string, unknown>>;
      return rows.map(productFromRow);
    },

    /** Active products by id, in the given order — feeds the `product` connector. */
    async getProductsByIds(userId: string, ids: string[]): Promise<Product[]> {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      const rows = await exec.all(`SELECT * FROM products WHERE user_id = ? AND id IN (${placeholders})`, [userId, ...ids]) as Array<Record<string, unknown>>;
      const byId = new Map(rows.map((r) => [r.id as string, productFromRow(r)]));
      return ids.map((id) => byId.get(id)).filter((p): p is Product => p != null);
    },

    async addProduct(
      userId: string,
      input: {
        sku?: string;
        name: string;
        brand?: string;
        category?: string;
        price?: number | null;
        attributes?: Record<string, unknown>;
        images?: string[];
      },
    ): Promise<Product> {
      const name = input.name.trim();
      if (!name) throw new Error("商品名不能为空");
      const id = randomUUID();
      const now = Date.now();
      await exec.run(`INSERT INTO products (id, user_id, sku, name, brand, category, price, attributes_json, images_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`, [id, userId, input.sku ?? "", name, input.brand ?? "", input.category ?? "", input.price ?? null, JSON.stringify(input.attributes ?? {}), JSON.stringify(input.images ?? []), now, now]);
      return (await this.getProductsByIds(userId, [id]))[0]!;
    },

    async updateProduct(
      id: string,
      userId: string,
      patch: {
        sku?: string;
        name?: string;
        brand?: string;
        category?: string;
        price?: number | null;
        attributes?: Record<string, unknown>;
        images?: string[];
        status?: "active" | "archived";
      },
    ): Promise<Product | undefined> {
      const cur = (await this.getProductsByIds(userId, [id]))[0];
      if (!cur) return undefined;
      const next = {
        sku: patch.sku ?? cur.sku,
        name: patch.name ?? cur.name,
        brand: patch.brand ?? cur.brand,
        category: patch.category ?? cur.category,
        price: patch.price !== undefined ? patch.price : cur.price,
        attributes: patch.attributes ?? cur.attributes,
        images: patch.images ?? cur.images,
        status: patch.status ?? cur.status,
      };
      await exec.run(`UPDATE products SET sku = ?, name = ?, brand = ?, category = ?, price = ?, attributes_json = ?, images_json = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [next.sku, next.name, next.brand, next.category, next.price, JSON.stringify(next.attributes), JSON.stringify(next.images), next.status, Date.now(), id, userId]);
      return (await this.getProductsByIds(userId, [id]))[0]!;
    },

    async deleteProduct(id: string, userId: string) {
      await exec.run(`DELETE FROM products WHERE id = ? AND user_id = ?`, [id, userId]);
    },

    // --- Brand assets (F4: reusable brand material) ---
    async listBrandAssets(userId: string): Promise<BrandAsset[]> {
      const rows = await exec.all(`SELECT * FROM brand_assets WHERE user_id = ? ORDER BY created_at DESC`, [userId]) as Array<Record<string, unknown>>;
      return rows.map((r) => {
        let tags: string[] = [];
        try {
          tags = JSON.parse(String(r.tags_json ?? "[]"));
        } catch {
          /* keep [] */
        }
        return {
          id: r.id as string,
          type: r.type as string,
          label: r.label as string,
          uri: (r.uri as string) ?? "",
          tags,
          createdAt: r.created_at as number,
        };
      });
    },

    async addBrandAsset(
      userId: string,
      input: { type: string; label: string; uri?: string; tags?: string[] },
    ): Promise<BrandAsset> {
      const label = input.label.trim();
      if (!label) throw new Error("素材名称不能为空");
      const id = randomUUID();
      const now = Date.now();
      await exec.run(`INSERT INTO brand_assets (id, user_id, type, label, uri, tags_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, userId, input.type, label, input.uri ?? "", JSON.stringify(input.tags ?? []), now]);
      return { id, type: input.type, label, uri: input.uri ?? "", tags: input.tags ?? [], createdAt: now };
    },

    async deleteBrandAsset(id: string, userId: string) {
      await exec.run(`DELETE FROM brand_assets WHERE id = ? AND user_id = ?`, [id, userId]);
    },

    // --- Batch jobs (F5: one run per input row, grouped for progress) ---
    async createBatch(input: {
      id: string;
      userId: string;
      graphId: string;
      sourceName?: string;
      rows: Record<string, unknown>[];
    }): Promise<BatchJob> {
      const now = Date.now();
      await exec.run(`INSERT INTO batch_jobs (id, user_id, graph_id, status, total, succeeded, failed, source_name, created_at)
         VALUES (?, ?, ?, 'pending', ?, 0, 0, ?, ?)`, [input.id, input.userId, input.graphId, input.rows.length, input.sourceName ?? null, now]);
      const insertItemSql = `INSERT INTO batch_items (id, batch_id, row_index, input_json, status) VALUES (?, ?, ?, ?, 'pending')`;
      for (let i = 0; i < input.rows.length; i++) {
        await exec.run(insertItemSql, [randomUUID(), input.id, i, JSON.stringify(input.rows[i])]);
      }
      return {
        id: input.id,
        graphId: input.graphId,
        status: "pending",
        total: input.rows.length,
        succeeded: 0,
        failed: 0,
        sourceName: input.sourceName ?? null,
        createdAt: now,
        finishedAt: null,
      };
    },

    async listBatches(userId: string, graphIds?: string[]): Promise<BatchJob[]> {
      // With graphIds (shared-graph visibility), scope by graph membership
      // instead of batch ownership.
      const rows = graphIds
        ? (await exec.all(`SELECT * FROM batch_jobs WHERE graph_id IN (${graphIds.map(() => "?").join(",")}) ORDER BY created_at DESC`, [...graphIds]) as Array<Record<string, unknown>>)
        : (await exec.all(`SELECT * FROM batch_jobs WHERE user_id = ? ORDER BY created_at DESC`, [userId]) as Array<Record<string, unknown>>);
      return rows.map(batchFromRow);
    },

    async getBatch(id: string, userId: string): Promise<BatchJob | null> {
      const row = await exec.get(`SELECT * FROM batch_jobs WHERE id = ? AND user_id = ?`, [id, userId]) as
        | Record<string, unknown>
        | undefined;
      return row ? batchFromRow(row) : null;
    },

    /** Unscoped batch lookup for shared-graph access (caller verified graph ACL). */
    async getBatchUnscoped(id: string): Promise<BatchJob | null> {
      const row = await exec.get(`SELECT * FROM batch_jobs WHERE id = ?`, [id]) as
        | Record<string, unknown>
        | undefined;
      return row ? batchFromRow(row) : null;
    },

    async listBatchItems(batchId: string): Promise<BatchItem[]> {
      const rows = await exec.all(`SELECT * FROM batch_items WHERE batch_id = ? ORDER BY row_index ASC`, [batchId]) as Array<Record<string, unknown>>;
      return rows.map((r) => {
        let input: Record<string, unknown> = {};
        let artifactIds: string[] = [];
        try {
          input = JSON.parse(String(r.input_json ?? "{}"));
        } catch {
          /* keep {} */
        }
        try {
          artifactIds = JSON.parse(String(r.artifact_ids_json ?? "[]"));
        } catch {
          /* keep [] */
        }
        return {
          id: String(r.id),
          batchId: String(r.batch_id),
          rowIndex: Number(r.row_index),
          input,
          runId: r.run_id ? String(r.run_id) : null,
          status: String(r.status) as BatchItem["status"],
          outputSummary: r.output_summary ? String(r.output_summary) : null,
          artifactIds,
          error: r.error ? String(r.error) : null,
        };
      });
    },

    async markBatchItemRunning(itemId: string, runId: string) {
      await exec.run(`UPDATE batch_items SET status = 'running', run_id = ? WHERE id = ?`, [runId, itemId]);
    },

    async markBatchItemDone(itemId: string, outputSummary: string | null, artifactIds: string[]) {
      await exec.run(`UPDATE batch_items SET status = 'done', output_summary = ?, artifact_ids_json = ?, error = NULL WHERE id = ?`, [outputSummary ?? "", JSON.stringify(artifactIds), itemId]);
    },

    async markBatchItemFailed(itemId: string, error: string) {
      await exec.run(`UPDATE batch_items SET status = 'failed', error = ? WHERE id = ?`, [error, itemId]);
    },

    async setBatchStatus(id: string, status: BatchJob["status"], finishedAt: number | null) {
      await exec.run(`UPDATE batch_jobs SET status = ?, finished_at = ? WHERE id = ?`, [status, finishedAt, id]);
    },

    async updateBatchCounts(id: string, succeeded: number, failed: number) {
      await exec.run(`UPDATE batch_jobs SET succeeded = ?, failed = ? WHERE id = ?`, [succeeded, failed, id]);
    },

    // --- Content calendar (F8: scheduled publishing plan) ---
    async createPlan(input: {
      id: string;
      userId: string;
      graphId?: string | null;
      runId?: string | null;
      artifactId?: string | null;
      platform?: string | null;
      title: string;
      scheduledAt: number;
      note?: string | null;
    }): Promise<ContentPlan> {
      const now = Date.now();
      await exec.run(`INSERT INTO content_plan (id, user_id, graph_id, run_id, artifact_id, platform, title, scheduled_at, status, published_url, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?)`, [input.id, input.userId, input.graphId ?? null, input.runId ?? null, input.artifactId ?? null, input.platform ?? null, input.title, input.scheduledAt, input.note ?? null, now, now]);
      return {
        id: input.id,
        graphId: input.graphId ?? null,
        runId: input.runId ?? null,
        artifactId: input.artifactId ?? null,
        platform: input.platform ?? null,
        title: input.title,
        scheduledAt: input.scheduledAt,
        status: "draft",
        publishedUrl: null,
        note: input.note ?? null,
        createdAt: now,
        updatedAt: now,
      };
    },

    async listPlans(userId: string, from?: number, to?: number): Promise<ContentPlan[]> {
      const rows = (
        from != null && to != null
          ? await exec.all(`SELECT * FROM content_plan WHERE user_id = ? AND scheduled_at >= ? AND scheduled_at <= ? ORDER BY scheduled_at ASC`, [userId, from, to])
          : await exec.all(`SELECT * FROM content_plan WHERE user_id = ? ORDER BY scheduled_at ASC`, [userId])
      ) as Array<Record<string, unknown>>;
      return rows.map(planFromRow);
    },

    async getPlan(id: string, userId: string): Promise<ContentPlan | null> {
      const row = await exec.get(`SELECT * FROM content_plan WHERE id = ? AND user_id = ?`, [id, userId]) as
        | Record<string, unknown>
        | undefined;
      return row ? planFromRow(row) : null;
    },

    async updatePlan(
      id: string,
      userId: string,
      patch: Partial<{
        graphId: string | null;
        runId: string | null;
        artifactId: string | null;
        platform: string | null;
        title: string;
        scheduledAt: number;
        status: ContentPlan["status"];
        publishedUrl: string | null;
        note: string | null;
      }>,
    ): Promise<ContentPlan | null> {
      const existing = await this.getPlan(id, userId);
      if (!existing) return null;
      const next = { ...existing, ...patch, updatedAt: Date.now() };
      await exec.run(`UPDATE content_plan SET graph_id = ?, run_id = ?, artifact_id = ?, platform = ?, title = ?, scheduled_at = ?, status = ?, published_url = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [next.graphId, next.runId, next.artifactId, next.platform, next.title, next.scheduledAt, next.status, next.publishedUrl, next.note, next.updatedAt, id, userId]);
      return next;
    },

    async deletePlan(id: string, userId: string) {
      await exec.run(`DELETE FROM content_plan WHERE id = ? AND user_id = ?`, [id, userId]);
    },

    // --- Performance metrics (F6: content effect feedback loop) ---
    async insertMetric(input: {
      id: string;
      userId: string;
      graphId?: string | null;
      runId?: string | null;
      nodeId?: string | null;
      variant?: string | null;
      artifactId?: string | null;
      productId?: string | null;
      platform?: string | null;
      externalContentId?: string | null;
      impressions?: number;
      clicks?: number;
      conversions?: number;
      gmv?: number;
      adSpend?: number;
      recordedAt: number;
    }): Promise<ContentMetric> {
      await exec.run(`INSERT INTO content_metrics (id, user_id, graph_id, run_id, node_id, variant, artifact_id, product_id, platform, external_content_id, impressions, clicks, conversions, gmv, ad_spend, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.id, input.userId, input.graphId ?? null, input.runId ?? null, input.nodeId ?? null, input.variant ?? null, input.artifactId ?? null, input.productId ?? null, input.platform ?? null, input.externalContentId ?? null, input.impressions ?? 0, input.clicks ?? 0, input.conversions ?? 0, input.gmv ?? 0, input.adSpend ?? 0, input.recordedAt]);
      return metricFromRow({
        id: input.id,
        graph_id: input.graphId,
        run_id: input.runId,
        node_id: input.nodeId,
        variant: input.variant,
        artifact_id: input.artifactId,
        product_id: input.productId,
        platform: input.platform,
        external_content_id: input.externalContentId,
        impressions: input.impressions ?? 0,
        clicks: input.clicks ?? 0,
        conversions: input.conversions ?? 0,
        gmv: input.gmv ?? 0,
        ad_spend: input.adSpend ?? 0,
        recorded_at: input.recordedAt,
      });
    },

    async listMetrics(userId: string): Promise<ContentMetric[]> {
      const rows = await exec.all(`SELECT * FROM content_metrics WHERE user_id = ? ORDER BY recorded_at DESC`, [userId]) as Array<Record<string, unknown>>;
      return rows.map(metricFromRow);
    },

    /** Aggregate metrics by one column (graph_id/run_id/platform/product_id/artifact_id). */
    async aggregatePerformance(userId: string, groupBy: string): Promise<PerformanceAggregate[]> {
      const allowed = new Set(["graph_id", "run_id", "node_id", "variant", "artifact_id", "product_id", "platform", "external_content_id"]);
      const col = allowed.has(groupBy) ? groupBy : "graph_id";
      const rows = await exec.all(`SELECT COALESCE(${col}, '') AS grp, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
                  SUM(conversions) AS conversions, SUM(gmv) AS gmv, SUM(ad_spend) AS ad_spend
           FROM content_metrics WHERE user_id = ? GROUP BY ${col} ORDER BY impressions DESC`, [userId]) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        group: String(r.grp ?? ""),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        conversions: Number(r.conversions ?? 0),
        gmv: Number(r.gmv ?? 0),
        adSpend: Number(r.ad_spend ?? 0),
      }));
    },

    // --- Content costs (F9: content-level cost attribution) ---
    async insertContentCost(input: {
      id: string;
      userId: string;
      artifactId?: string | null;
      productId?: string | null;
      platform?: string | null;
      variant?: string | null;
      costUsd?: number;
      gmv?: number;
      capturedAt: number;
    }): Promise<ContentCost> {
      const costUsd = input.costUsd ?? 0;
      const gmv = input.gmv ?? 0;
      const roi = costUsd > 0 ? gmv / costUsd : 0;
      await exec.run(`INSERT INTO content_costs (id, user_id, artifact_id, product_id, platform, variant, cost_usd, gmv, roi, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.id, input.userId, input.artifactId ?? null, input.productId ?? null, input.platform ?? null, input.variant ?? null, costUsd, gmv, roi, input.capturedAt]);
      return {
        id: input.id,
        artifactId: input.artifactId ?? null,
        productId: input.productId ?? null,
        platform: input.platform ?? null,
        variant: input.variant ?? null,
        costUsd,
        gmv,
        roi,
        capturedAt: input.capturedAt,
      };
    },

    async listContentCosts(userId: string): Promise<ContentCost[]> {
      const rows = await exec.all(`SELECT * FROM content_costs WHERE user_id = ? ORDER BY captured_at DESC`, [userId]) as Array<Record<string, unknown>>;
      return rows.map(costFromRow);
    },

    /** Aggregate content costs by artifact_id/product_id/platform/variant. */
    async aggregateContentCosts(userId: string, groupBy: string): Promise<ContentCostAggregate[]> {
      const allowed = new Set(["artifact_id", "product_id", "platform", "variant"]);
      const col = allowed.has(groupBy) ? groupBy : "artifact_id";
      const rows = await exec.all(`SELECT COALESCE(${col}, '') AS grp, SUM(cost_usd) AS cost_usd, SUM(gmv) AS gmv
           FROM content_costs WHERE user_id = ? GROUP BY ${col} ORDER BY cost_usd DESC`, [userId]) as Array<Record<string, unknown>>;
      return rows.map((r) => {
        const costUsd = Number(r.cost_usd ?? 0);
        const gmv = Number(r.gmv ?? 0);
        return {
          group: String(r.grp ?? ""),
          costUsd,
          gmv,
          roi: costUsd > 0 ? gmv / costUsd : 0,
        };
      });
    },

    // --- Publish targets & published contents (F7-B) ---
    async createPublishTarget(input: {
      id: string;
      userId: string;
      platform: string;
      name?: string | null;
      provider: string;
      configEncrypted: string;
      createdAt: number;
    }): Promise<PublishTarget> {
      await exec.run(`INSERT INTO publish_targets (id, user_id, platform, name, provider, config_encrypted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, [input.id, input.userId, input.platform, input.name ?? null, input.provider, input.configEncrypted, input.createdAt]);
      return {
        id: input.id,
        platform: input.platform,
        name: input.name ?? null,
        provider: input.provider,
        configEncrypted: input.configEncrypted,
        createdAt: input.createdAt,
      };
    },

    async listPublishTargets(userId: string): Promise<PublishTarget[]> {
      return (await exec.all(`SELECT * FROM publish_targets WHERE user_id = ? ORDER BY created_at DESC`, [userId]))
        .map((r) => ({
          id: String(r.id),
          platform: String(r.platform),
          name: r.name ? String(r.name) : null,
          provider: String(r.provider),
          configEncrypted: String(r.config_encrypted),
          createdAt: Number(r.created_at),
        }));
    },

    async deletePublishTarget(id: string, userId: string): Promise<boolean> {
      const r = await exec.run(`DELETE FROM publish_targets WHERE id = ? AND user_id = ?`, [id, userId]);
      return r.changes > 0;
    },

    /** Cross-user lookup for the metrics webhook (no session user in an inbound webhook). */
    async getPublishTarget(id: string): Promise<(PublishTarget & { userId: string }) | null> {
      const r = await exec.get(`SELECT * FROM publish_targets WHERE id = ?`, [id]) as Record<string, unknown> | undefined;
      if (!r) return null;
      return {
        id: String(r.id),
        userId: String(r.user_id),
        platform: String(r.platform),
        name: r.name ? String(r.name) : null,
        provider: String(r.provider),
        configEncrypted: String(r.config_encrypted),
        createdAt: Number(r.created_at),
      };
    },

    async insertPublishedContent(input: {
      id: string;
      userId: string;
      graphId?: string | null;
      runId?: string | null;
      artifactId?: string | null;
      platform?: string | null;
      status: string;
      externalId?: string | null;
      externalUrl?: string | null;
      publishedAt?: number | null;
      detailJson?: string | null;
    }): Promise<PublishedContent> {
      await exec.run(`INSERT INTO published_contents (id, user_id, graph_id, run_id, artifact_id, platform, status, external_id, external_url, published_at, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [input.id, input.userId, input.graphId ?? null, input.runId ?? null, input.artifactId ?? null, input.platform ?? null, input.status, input.externalId ?? null, input.externalUrl ?? null, input.publishedAt ?? null, input.detailJson ?? null]);
      return {
        id: input.id,
        graphId: input.graphId ?? null,
        runId: input.runId ?? null,
        artifactId: input.artifactId ?? null,
        platform: input.platform ?? null,
        status: input.status,
        externalId: input.externalId ?? null,
        externalUrl: input.externalUrl ?? null,
        publishedAt: input.publishedAt ?? null,
        detailJson: input.detailJson ?? null,
      };
    },

    async listPublishedContents(userId: string): Promise<PublishedContent[]> {
      return (await exec.all(`SELECT * FROM published_contents WHERE user_id = ? ORDER BY published_at DESC`, [userId]))
        .map((r) => ({
          id: String(r.id),
          graphId: r.graph_id ? String(r.graph_id) : null,
          runId: r.run_id ? String(r.run_id) : null,
          artifactId: r.artifact_id ? String(r.artifact_id) : null,
          platform: r.platform ? String(r.platform) : null,
          status: String(r.status),
          externalId: r.external_id ? String(r.external_id) : null,
          externalUrl: r.external_url ? String(r.external_url) : null,
          publishedAt: r.published_at != null ? Number(r.published_at) : null,
          detailJson: r.detail_json ? String(r.detail_json) : null,
        }));
    },

    // --- Graph versions (5.6) ---
    async listVersions(graphId: string, userId: string) {
      return await exec.all(`SELECT gv.id, gv.graph_id AS graphId, gv.name, gv.note, gv.content_hash AS contentHash, gv.created_at AS createdAt
                  FROM graph_versions gv JOIN graphs g ON g.id = gv.graph_id
                  WHERE gv.graph_id = ? AND g.user_id = ? ORDER BY gv.created_at DESC, gv.rowid DESC`, [graphId, userId]) as Array<{ id: string; graphId: string; name: string; note: string; contentHash: string; createdAt: number }>;
    },
    /**
     * Content hash of the graph as executed by the most recent run of this
     * graph (runs.snapshot stores the full graph JSON at execution time), or
     * null when the graph has never run. Lets the version panel flag which
     * snapshot matches what actually ran.
     */
    async getLatestRunContentHash(graphId: string, userId: string): Promise<string | null> {
      const row = await exec.get(`SELECT snapshot FROM runs WHERE graph_id = ? AND user_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`, [graphId, userId]) as { snapshot: string } | undefined;
      return row ? contentHash(openDocString(row.snapshot)) : null;
    },
    async getVersion(id: string, userId: string) {
      const row = await exec.get(`SELECT gv.* FROM graph_versions gv JOIN graphs g ON g.id = gv.graph_id
                          WHERE gv.id = ? AND g.user_id = ?`, [id, userId]) as
        | { id: string; graph_id: string; name: string; snapshot: string; note: string; created_at: number }
        | undefined;
      return row ? { ...row, snapshot: openDocString(row.snapshot) } : undefined;
    },
    async saveVersion(graphId: string, name: string, snapshot: string, note = "", contentHash = "") {
      const id = randomUUID();
      const now = Date.now();
      await exec.run(`INSERT INTO graph_versions (id, graph_id, name, snapshot, note, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, graphId, name, sealDocString(snapshot), note, contentHash, now]);
      return { id, graphId, name, note, createdAt: now };
    },
    /**
     * Auto-snapshot taken right before a save overwrites the graph. Throttled:
     * skipped when the latest auto-snapshot for this graph is recent (within
     * `minIntervalMs`) AND captured the same content. Rolling retention: keeps
     * at most `maxKeep` auto-snapshots per graph (manual snapshots are never
     * pruned here). Returns the created version id, or null when skipped.
     */
    async saveAutoSnapshot(graphId: string, snapshot: string, minIntervalMs: number, maxKeep: number): Promise<string | null> {
      const hash = contentHash(snapshot);
      // rowid DESC breaks created_at ties (same-millisecond snapshots) by
      // insertion order, keeping throttle/retention deterministic.
      const last = await exec.get(`SELECT content_hash, created_at FROM graph_versions WHERE graph_id = ? AND note = 'auto' ORDER BY created_at DESC, rowid DESC LIMIT 1`, [graphId]) as { content_hash: string; created_at: number } | undefined;
      if (last && Date.now() - last.created_at < minIntervalMs && last.content_hash === hash) return null;

      const id = randomUUID();
      const now = Date.now();
      await exec.run(`INSERT INTO graph_versions (id, graph_id, name, snapshot, note, content_hash, created_at) VALUES (?, ?, ?, ?, 'auto', ?, ?)`, [id, graphId, `auto-${new Date(now).toISOString().slice(0, 16).replace("T", " ")}`, sealDocString(snapshot), hash, now]);
      // Rolling retention: prune oldest auto-snapshots beyond maxKeep.
      const stale = await exec.all(`SELECT id FROM graph_versions WHERE graph_id = ? AND note = 'auto' ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?`, [graphId, maxKeep]) as Array<{ id: string }>;
      for (const row of stale) {
        await exec.run(`DELETE FROM graph_versions WHERE id = ?`, [row.id]);
      }
      return id;
    },
    async deleteVersion(id: string, userId: string) {
      await exec.run(`DELETE FROM graph_versions WHERE id = ? AND graph_id IN (SELECT id FROM graphs WHERE user_id = ?)`, [id, userId]);
    },

    async getGraphById(id: string): Promise<(Graph & { version: number }) | null> {
      const row = await exec.get(stmts.getGraphById, [id]) as { doc: string; version: number } | undefined;
      return row ? { ...(openGraphDoc(JSON.parse(row.doc) as Graph)), version: row.version } : null;
    },

    async listAllGraphs() {
      return await exec.all(stmts.listAllGraphs, []) as Array<{
        id: string;
        name: string;
        version: number;
        updated_at: number;
      }>;
    },

    async getGraphOwnerId(id: string): Promise<string | undefined> {
      const row = await exec.get(stmts.getGraphOwnerId, [id]) as { user_id: string } | undefined;
      return row?.user_id;
    },

    async finishRunById(runId: string, status: string, at: number) {
      await exec.run(stmts.finishRunById, [status, at, runId]);
    },

    async markRunningById(runId: string) {
      await exec.run(stmts.markRunningById, [runId]);
    },

    async getRunById(runId: string) {
      const row = await exec.get(stmts.getRunById, [runId]) as
        | { id: string; graph_id: string; snapshot: string; status: string; trigger: string; input: string | null; budget_usd: number | null; started_at: number; ended_at: number | null }
        | undefined;
      return row ? { ...row, snapshot: openDocString(row.snapshot) } : undefined;
    },

    async listRunsUnscoped(limit = 50, offset = 0) {
      return await exec.all(stmts.listRunsUnscoped, [limit, offset]) as Array<Record<string, unknown>>;
    },

    async listRunsByGraphUnscoped(graphId: string, limit = 1) {
      return await exec.all(stmts.listRunsByGraphUnscoped, [graphId, limit]) as Array<Record<string, unknown>>;
    },

    async saveGraphUnscoped(graph: Graph, at: number) {
      const doc = JSON.stringify(sealGraphDoc(graph));
      // Preserve template lineage: the upsert's update branch never touches
      // origin_template_id, but the insert branch needs the existing value.
      const row = await exec.get(`SELECT origin_template_id FROM graphs WHERE id = ?`, [graph.id]) as { origin_template_id: string | null } | undefined;
      await exec.run(stmts.insertGraph, [graph.id, null, graph.name, doc, row?.origin_template_id ?? null, at]);
    },

    async close() {
      await hooks.close();
    },

    /** Passthrough to the underlying DatabaseSync.prepare — for modules that
     *  manage their own tables (e.g. knowledge base FTS). */
    async prepare(sql: string) {
      return hooks.prepare(sql);
    },
  };
}

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
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_owner ON users(role) WHERE role = 'owner'");
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
];

const LATEST_VERSION = MIGRATIONS.at(-1)!.version;

/**
 * Run pending migrations inside a transaction. On first encounter of an older
 * database (no `schema_migrations` rows), existing columns are baselined: a
 * migration whose effect is already present is recorded as applied without
 * running, so upgrades from the old try/catch ADD COLUMN era don't break.
 */
function runMigrations(db: DatabaseSync) {
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

/**
 * If the users table is empty but data tables have rows (pre-auth database),
 * create a default user and assign all existing data to it. This ensures
 * zero-downtime migration for dev databases.
 */
export async function backfillExistingData(database: { prepare(sql: string): Promise<{ get(...args: unknown[]): unknown; run(...args: unknown[]): unknown }> }): Promise<void> {
  const userCount = ((await database.prepare("SELECT COUNT(*) as c FROM users")).get() as { c: number }).c;
  if (userCount > 0) return;

  const graphCount = ((await database.prepare("SELECT COUNT(*) as c FROM graphs")).get() as { c: number }).c;
  if (graphCount === 0) return;

  const defaultUserId = randomUUID();
  const defaultEmail = "admin@local.dev";
  const placeholderHash = "__no_login__";

  // The backfilled user is the only account in this scenario — it bootstraps
  // as owner (RBAC P0, design-rbac.md).
  (await database.prepare("INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'owner')")).run(
    defaultUserId,
    defaultEmail,
    placeholderHash,
  );
  (await database.prepare("UPDATE graphs SET user_id = ? WHERE user_id IS NULL")).run(defaultUserId);
  (await database.prepare("UPDATE runs SET user_id = ? WHERE user_id IS NULL")).run(defaultUserId);
  (await database.prepare("UPDATE brand_terms SET user_id = ? WHERE user_id IS NULL")).run(defaultUserId);
  // Migration 15 already attributed run/graph-linked artifacts; whatever is still
  // ownerless here is a pre-auth upload with no link to follow.
  (await database.prepare("UPDATE artifacts SET user_id = ? WHERE user_id IS NULL")).run(defaultUserId);
}
