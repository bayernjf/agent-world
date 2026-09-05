import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { EVENT_SCHEMA_VERSION, type Graph, type RunEvent } from "@agent-world/core";
import type { StoredArtifact } from "./artifact-store.js";
import { openDocString, openGraphDoc, sealDocString, sealGraphDoc } from "./at-rest.js";
import { log } from "./logger.js";

/**
 * Events are the source of truth and append-only, so they get a plain prepared
 * insert rather than an ORM round trip. `(run_id, seq)` is the primary key, and
 * node runs are keyed by `(run_id, node_id, attempt)` — attempt is identity.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

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

export interface ABArmReport {
  arm: string;
  target: string | null;
  prompt: string | null;
  runs: number;
  done: number;
  passed: number;
  passRate: number;
  avgRework: number;
  avgDurationMs: number;
  avgScore: number;
  avgCost: number;
}

export interface ABReport {
  groupId: string;
  arms: ABArmReport[];
  recommendedArm: string | null;
}

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

export type Db = ReturnType<typeof openDb>;

/** A reusable product row from the F4 product library. */
export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number | null;
  attributes: Record<string, unknown>;
  images: string[];
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

/** A reusable brand material (logo/image/snippet/guideline). */
export interface BrandAsset {
  id: string;
  type: string;
  label: string;
  uri: string;
  tags: string[];
  createdAt: number;
}

/** A batch run job (F5): one graph run per input row, grouped for progress tracking. */
export interface BatchJob {
  id: string;
  graphId: string;
  status: "pending" | "running" | "done" | "partial" | "failed" | "cancelled";
  total: number;
  succeeded: number;
  failed: number;
  sourceName: string | null;
  createdAt: number;
  finishedAt: number | null;
}

/** One row of a batch job (F5). */
export interface BatchItem {
  id: string;
  batchId: string;
  rowIndex: number;
  input: Record<string, unknown>;
  runId: string | null;
  status: "pending" | "running" | "done" | "failed";
  outputSummary: string | null;
  artifactIds: string[];
  error: string | null;
}

/** A scheduled content item on the F8 calendar. */
export interface ContentPlan {
  id: string;
  graphId: string | null;
  runId: string | null;
  artifactId: string | null;
  platform: string | null;
  title: string;
  scheduledAt: number;
  status: "draft" | "pending_review" | "scheduled" | "published" | "failed";
  publishedUrl: string | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One performance metric row (F6). */
export interface ContentMetric {
  id: string;
  graphId: string | null;
  runId: string | null;
  nodeId: string | null;
  variant: string | null;
  artifactId: string | null;
  productId: string | null;
  platform: string | null;
  externalContentId: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
  gmv: number;
  adSpend: number;
  recordedAt: number;
}

/** Aggregated performance buckets returned by /api/performance. */
export interface PerformanceAggregate {
  group: string;
  impressions: number;
  clicks: number;
  conversions: number;
  gmv: number;
  adSpend: number;
}

/** A content-level cost snapshot (F9). */
export interface ContentCost {
  id: string;
  artifactId: string | null;
  productId: string | null;
  platform: string | null;
  variant: string | null;
  costUsd: number;
  gmv: number;
  roi: number;
  capturedAt: number;
}

/** Content-level cost/GMV/ROI aggregate bucket. */
export interface ContentCostAggregate {
  group: string;
  costUsd: number;
  gmv: number;
  roi: number;
}

/** An open-channel publish target (F7-B). */
export interface PublishTarget {
  id: string;
  platform: string;
  name: string | null;
  provider: string;
  configEncrypted: string;
  createdAt: number;
}

/** A published-content record (F7-B). */
export interface PublishedContent {
  id: string;
  graphId: string | null;
  runId: string | null;
  artifactId: string | null;
  platform: string | null;
  status: string;
  externalId: string | null;
  externalUrl: string | null;
  publishedAt: number | null;
  detailJson: string | null;
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

export function openDb(file: string) {
  const db = new DatabaseSync(file);
  // Snapshot before any schema work. On a brand-new file the size is 0 here
  // (the WAL pragma below would otherwise write a header), so first-run
  // databases correctly produce no backup.
  backupDatabase(db, file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(DDL);
  runMigrations(db);

  const stmts = {
    createUser: db.prepare(
      `INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)`,
    ),
    getSettings: db.prepare(`SELECT data FROM settings WHERE user_id = ?`),
    saveSettings: db.prepare(
      `INSERT INTO settings (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    ),
    insertAudit: db.prepare(
      `INSERT INTO audit_log (id, user_id, action, object_type, object_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    listAudit: db.prepare(
      `SELECT id, user_id, action, object_type, object_id, detail, ip, created_at
       FROM audit_log WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`,
    ),
    // Slightly different prepared statement: the first page has no "before"
    // cursor, so accept 0 (older than anything).
    listAuditFirst: db.prepare(
      `SELECT id, user_id, action, object_type, object_id, detail, ip, created_at
       FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    ),
    listActiveAnnouncements: db.prepare(
      `SELECT * FROM announcements
       WHERE starts_at <= ? AND (ends_at IS NULL OR ends_at >= ?)
       ORDER BY created_at DESC`,
    ),
    listAllAnnouncements: db.prepare(
      `SELECT * FROM announcements ORDER BY created_at DESC`,
    ),
    getAnnouncement: db.prepare(`SELECT * FROM announcements WHERE id = ?`),
    insertAnnouncement: db.prepare(
      `INSERT INTO announcements (id, title_zh, title_en, body_zh, body_en, level, starts_at, ends_at, target, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    updateAnnouncement: db.prepare(
      `UPDATE announcements SET title_zh = ?, title_en = ?, body_zh = ?, body_en = ?,
        level = ?, starts_at = ?, ends_at = ?, target = ? WHERE id = ?`,
    ),
    deleteAnnouncement: db.prepare(`DELETE FROM announcements WHERE id = ?`),
    insertAnnouncementRead: db.prepare(
      `INSERT INTO announcement_reads (user_id, announcement_id, read_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, announcement_id) DO NOTHING`,
    ),
    listAnnouncementReads: db.prepare(
      `SELECT announcement_id FROM announcement_reads WHERE user_id = ?`,
    ),
    findUserByEmail: db.prepare(
      `SELECT id, email, created_at FROM users WHERE email = ?`,
    ),
    findUserById: db.prepare(
      `SELECT id, email, created_at FROM users WHERE id = ?`,
    ),
    findUserPasswordHash: db.prepare(
      `SELECT password_hash FROM users WHERE id = ?`,
    ),
    countUsers: db.prepare(`SELECT COUNT(*) AS n FROM users`),
    updateUserPasswordHash: db.prepare(
      `UPDATE users SET password_hash = ? WHERE id = ?`,
    ),
    insertGraph: db.prepare(
      `INSERT INTO graphs (id, user_id, name, doc, origin_template_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, doc = excluded.doc, version = version + 1, updated_at = excluded.updated_at
       WHERE graphs.user_id = excluded.user_id`,
    ),
    // Conditional update: only succeeds when the row's current version matches
    // the If-Match value, so a stale tab can't silently clobber a newer save.
    updateGraphIfVersion: db.prepare(
      `UPDATE graphs SET name = ?, doc = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ? AND user_id = ?`,
    ),
    getGraphVersion: db.prepare(`SELECT version FROM graphs WHERE id = ? AND user_id = ?`),
    getGraph: db.prepare(`SELECT doc, version, origin_template_id FROM graphs WHERE id = ? AND user_id = ?`),
    listGraphs: db.prepare(`SELECT id, name, version, updated_at, origin_template_id FROM graphs WHERE user_id = ? ORDER BY updated_at DESC`),
    listGraphVariables: db.prepare(
      `SELECT gv.key AS key, gv.value AS value
       FROM graph_variables gv JOIN graphs g ON g.id = gv.graph_id AND g.user_id = ?
       WHERE gv.graph_id = ?`,
    ),
    saveGraphVariable: db.prepare(
      `INSERT INTO graph_variables (graph_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(graph_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ),
    deleteGraph: db.prepare(`DELETE FROM graphs WHERE id = ? AND user_id = ?`),
    createRun: db.prepare(
      `INSERT INTO runs (id, user_id, graph_id, snapshot, status, trigger, input, budget_usd, started_at, ab_group, ab_arm, ab_target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    finishRun: db.prepare(
      `UPDATE runs SET status = ?, ended_at = ?, halted_node_id = ?, halted_reason = ? WHERE id = ? AND user_id = ?`,
    ),
    markRunning: db.prepare(
      `UPDATE runs SET status = 'running', ended_at = NULL, halted_node_id = NULL, halted_reason = NULL WHERE id = ? AND user_id = ?`,
    ),
    getRun: db.prepare(`SELECT * FROM runs WHERE id = ? AND user_id = ?`),
    listRuns: db.prepare(
      `SELECT r.id, r.graph_id, COALESCE(g.name, '(已删除产线)') AS graph_name, r.status, r.trigger, r.budget_usd, r.started_at, r.ended_at
       FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id
       ORDER BY r.started_at DESC LIMIT ? OFFSET ?`,
    ),
    insertEvent: db.prepare(
      `INSERT INTO events (run_id, seq, ts, version, type, payload) VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    listEvents: db.prepare(`SELECT payload FROM events WHERE run_id = ? ORDER BY seq`),
    listEventsRange: db.prepare(
      `SELECT seq, payload FROM events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
    ),
    maxSeq: db.prepare(`SELECT COALESCE(MAX(seq), -1) as seq FROM events WHERE run_id = ?`),
    upsertNodeRun: db.prepare(
      `INSERT INTO node_runs (run_id, node_id, attempt, variant, status) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id, node_id, attempt, variant) DO UPDATE SET status = excluded.status`,
    ),
    appendReasoning: db.prepare(
      `UPDATE node_runs SET reasoning = COALESCE(reasoning, '') || ? WHERE run_id = ? AND node_id = ? AND attempt = ? AND variant = ?`,
    ),
    finishNodeRun: db.prepare(
      `UPDATE node_runs SET status = ?, output = ?, tokens_in = ?, tokens_out = ?,
        cached_tokens = ?, reasoning_tokens = ?, cost_usd = ?, units_json = ?
       WHERE run_id = ? AND node_id = ? AND attempt = ? AND variant = ?`,
    ),
    failNodeRun: db.prepare(
      `UPDATE node_runs SET status = 'failed', error = ?, error_code = ? WHERE run_id = ? AND node_id = ? AND attempt = ? AND variant = ?`,
    ),
    setNodeScore: db.prepare(
      `UPDATE node_runs SET score = ? WHERE run_id = ? AND node_id = ? AND attempt = ? AND variant = ?`,
    ),
    markInterrupted: db.prepare(
      `UPDATE runs SET status = 'interrupted', ended_at = ? WHERE status = 'running'`,
    ),
    /** Snapshots needed to group runs by prompt version (eval report). */
    evalSnapshots: db.prepare(
      `SELECT id, graph_id, snapshot FROM runs WHERE status != 'running' AND user_id = ? ORDER BY started_at DESC LIMIT 1000`,
    ),
        deleteRun: db.prepare(`DELETE FROM runs WHERE id = ? AND user_id = ?`),
    deleteEvents: db.prepare(`DELETE FROM events WHERE run_id = ?`),
    deleteNodeRuns: db.prepare(`DELETE FROM node_runs WHERE run_id = ?`),
    insertArtifact: db.prepare(
      `INSERT INTO artifacts (id, run_id, user_id, node_id, attempt, variant, graph_id, role, kind, mime_type, label, size_bytes, storage, uri, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ),
    listArtifactsByRun: db.prepare(
      `SELECT a.id, a.run_id, a.node_id, a.attempt, a.graph_id, a.role, a.kind, a.mime_type, a.label, a.size_bytes, a.storage, a.uri, a.created_at,
              COALESCE(g.name, '(未知流水线)') AS graph_name
       FROM artifacts a LEFT JOIN graphs g ON g.id = a.graph_id
       WHERE a.run_id = ? AND a.user_id = ?
       ORDER BY a.created_at`,
    ),
    getArtifact: db.prepare(
      `SELECT a.id, a.run_id, a.node_id, a.attempt, a.graph_id, a.role, a.kind, a.mime_type, a.label, a.size_bytes, a.storage, a.uri, a.created_at,
              COALESCE(g.name, '(未知流水线)') AS graph_name
       FROM artifacts a LEFT JOIN graphs g ON g.id = a.graph_id
       WHERE a.id = ? AND a.user_id = ?`,
    ),
    getArtifactUnscoped: db.prepare(
      `SELECT a.id, a.run_id, a.node_id, a.attempt, a.graph_id, a.role, a.kind, a.mime_type, a.label, a.size_bytes, a.storage, a.uri, a.created_at,
              COALESCE(g.name, '(未知流水线)') AS graph_name
       FROM artifacts a LEFT JOIN graphs g ON g.id = a.graph_id
       WHERE a.id = ?`,
    ),
    listArtifacts: db.prepare(
      `SELECT a.id, a.run_id, a.node_id, a.attempt, a.graph_id, a.role, a.kind, a.mime_type, a.label, a.size_bytes, a.storage, a.uri, a.created_at,
              COALESCE(g.name, '(未知流水线)') AS graph_name
       FROM artifacts a LEFT JOIN graphs g ON g.id = a.graph_id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC, a.rowid DESC LIMIT ? OFFSET ?`,
    ),
    deleteArtifactsForRun: db.prepare(`DELETE FROM artifacts WHERE run_id = ?`),
    getGraphById: db.prepare(`SELECT doc, version FROM graphs WHERE id = ?`),
    listAllGraphs: db.prepare(`SELECT id, name, version, updated_at FROM graphs ORDER BY updated_at DESC`),
    getGraphOwnerId: db.prepare(`SELECT user_id FROM graphs WHERE id = ?`),
    finishRunById: db.prepare(`UPDATE runs SET status = ?, ended_at = ? WHERE id = ?`),
    markRunningById: db.prepare(
      `UPDATE runs SET status = 'running', ended_at = NULL, halted_node_id = NULL, halted_reason = NULL WHERE id = ?`,
    ),
    getRunById: db.prepare(`SELECT * FROM runs WHERE id = ?`),
    listRunsUnscoped: db.prepare(
      `SELECT r.id, r.graph_id, COALESCE(g.name, '(已删除产线)') AS graph_name, r.status, r.trigger, r.budget_usd, r.started_at, r.ended_at
       FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id
       ORDER BY r.started_at DESC LIMIT ? OFFSET ?`,
    ),
    listRunsByGraphUnscoped: db.prepare(
      `SELECT r.id, r.graph_id, COALESCE(g.name, '(已删除产线)') AS graph_name, r.status, r.trigger, r.budget_usd, r.started_at, r.ended_at
       FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id
       WHERE r.graph_id = ?
       ORDER BY r.started_at DESC LIMIT ?`,
    ),
  };

  return {
    createUser(id: string, email: string, passwordHash: string) {
      stmts.createUser.run(id, email, passwordHash);
      return { id, email };
    },
    findUserByEmail(email: string) {
      return stmts.findUserByEmail.get(email) as
        | { id: string; email: string; created_at: string }
        | undefined;
    },
    findUserById(id: string) {
      return stmts.findUserById.get(id) as
        | { id: string; email: string; created_at: string }
        | undefined;
    },
    findUserPasswordHash(id: string) {
      const row = stmts.findUserPasswordHash.get(id) as { password_hash: string } | undefined;
      return row?.password_hash;
    },
    /** Total account count — gates self-registration once the first user exists (M3). */
    countUsers(): number {
      return (stmts.countUsers.get() as { n: number }).n;
    },
    updateUserPasswordHash(id: string, passwordHash: string) {
      stmts.updateUserPasswordHash.run(passwordHash, id);
    },

    /**
     * Persist a graph. When `expectedVersion` is given the update is
     * conditional: it returns { ok:false, conflict:true } if the stored version
     * no longer matches (another tab saved first), instead of overwriting.
     * On success returns the new version.
     */
    saveGraph(
      graph: Graph,
      at: number,
      userId: string,
      expectedVersion?: number,
      originTemplateId?: string | null,
    ): { ok: true; version: number } | { ok: false; conflict: true; serverVersion: number | null } | { ok: false; foreign: true } {
      const doc = JSON.stringify(sealGraphDoc(graph));
      // Cross-tenant guard (H1): an upsert must never overwrite a graph that
      // shares this id but belongs to another user. Checked in the app layer
      // for a clear error; the UPSERT's WHERE clause is the SQL backstop.
      const ownerRow = stmts.getGraphOwnerId.get(graph.id) as { user_id: string } | undefined;
      if (ownerRow && ownerRow.user_id !== userId) {
        return { ok: false, foreign: true };
      }
      if (expectedVersion != null) {
        const result = stmts.updateGraphIfVersion.run(
          graph.name,
          doc,
          at,
          graph.id,
          expectedVersion,
          userId,
        );
        if (result.changes === 0) {
          const row = stmts.getGraphVersion.get(graph.id, userId) as { version: number } | undefined;
          return { ok: false, conflict: true, serverVersion: row?.version ?? null };
        }
        return { ok: true, version: expectedVersion + 1 };
      }
      stmts.insertGraph.run(graph.id, userId, graph.name, doc, originTemplateId ?? null, at);
      const row = stmts.getGraphVersion.get(graph.id, userId) as { version: number };
      return { ok: true, version: row.version };
    },

    getGraph(id: string, userId: string): (Graph & { version: number; originTemplateId: string | null }) | null {
      const row = stmts.getGraph.get(id, userId) as { doc: string; version: number; origin_template_id: string | null } | undefined;
      return row ? { ...(openGraphDoc(JSON.parse(row.doc) as Graph)), version: row.version, originTemplateId: row.origin_template_id } : null;
    },

    listGraphs(userId: string): Array<{
      id: string;
      name: string;
      version: number;
      updated_at: number;
      originTemplateId: string | null;
    }> {
      const rows = stmts.listGraphs.all(userId) as Array<{
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
    loadGraphVariables(graphId: string, userId: string): Record<string, unknown> {
      const rows = stmts.listGraphVariables.all(userId, graphId) as Array<{ key: string; value: string }>;
      const out: Record<string, unknown> = {};
      for (const r of rows) {
        try {
          out[r.key] = JSON.parse(r.value);
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
    saveGraphVariables(graphId: string, userId: string, vars: Record<string, unknown>): void {
      const owner = stmts.getGraphOwnerId.get(graphId) as { user_id: string } | undefined;
      if (!owner || owner.user_id !== userId) return;
      const at = Date.now();
      for (const [key, value] of Object.entries(vars)) {
        stmts.saveGraphVariable.run(graphId, key, JSON.stringify(value), at);
      }
    },


    deleteGraph(id: string, userId: string) {
      stmts.deleteGraph.run(id, userId);
    },

    createRun(args: {
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
      stmts.createRun.run(
        args.id,
        args.userId,
        args.graph.id,
        JSON.stringify(sealGraphDoc(args.graph)),
        "running",
        args.trigger ?? "manual",
        args.input ?? null,
        args.budgetUsd,
        args.at,
        args.abGroup ?? null,
        args.abArm ?? null,
        args.abTarget ?? null,
      );
    },

    finishRun(
      runId: string,
      userId: string,
      status: string,
      at: number,
      halted?: { nodeId: string | null; reason: string | null },
    ) {
      stmts.finishRun.run(status, at, halted?.nodeId ?? null, halted?.reason ?? null, runId, userId);
    },

    markRunning(runId: string, userId: string) {
      stmts.markRunning.run(runId, userId);
    },

    runExists(runId: string, userId: string): boolean {
      return stmts.getRun.get(runId, userId) !== undefined;
    },

    getRun(runId: string, userId: string) {
      const row = stmts.getRun.get(runId, userId) as
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

    listRuns(
      userId: string,
      opts: { limit?: number; offset?: number; graphId?: string; status?: string } = {},
    ) {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
      const offset = Math.max(opts.offset ?? 0, 0);
      const where: string[] = ["r.user_id = ?"];
      const params: (string | number)[] = [userId];
      if (opts.graphId) {
        where.push("r.graph_id = ?");
        params.push(opts.graphId);
      }
      if (opts.status) {
        where.push("r.status = ?");
        params.push(opts.status);
      }
      const clause = `WHERE ${where.join(" AND ")}`;
      const rows = db
        .prepare(
          `SELECT r.id AS id, r.graph_id AS graph_id, g.name AS graph_name,
                  r.status AS status, r.trigger AS trigger, r.budget_usd AS budget_usd,
                  r.started_at AS started_at, r.ended_at AS ended_at
           FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id
           ${clause}
           ORDER BY r.started_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Array<{
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
        db.prepare(`SELECT COUNT(*) AS n FROM runs r ${clause}`).get(...params) as { n: number }
      ).n;
      return { rows, total };
    },

    /**
     * Runs waiting on a human decision, oldest first so the longest-blocked item
     * surfaces at the top of the review queue.
     */
    pendingReviews(userId: string, opts: { limit?: number; offset?: number; graphId?: string } = {}) {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
      const offset = Math.max(opts.offset ?? 0, 0);
      const where: string[] = ["r.user_id = ?", "r.status = 'halted'"];
      const params: (string | number)[] = [userId];
      if (opts.graphId) {
        where.push("r.graph_id = ?");
        params.push(opts.graphId);
      }
      const clause = `WHERE ${where.join(" AND ")}`;
      const rows = db
        .prepare(
          `SELECT r.id AS id, r.graph_id AS graph_id, COALESCE(g.name, '(已删除产线)') AS graph_name,
                  r.halted_node_id AS halted_node_id, r.halted_reason AS halted_reason,
                  r.trigger AS trigger, r.ab_group AS ab_group, r.ab_arm AS ab_arm,
                  r.started_at AS started_at, COALESCE(r.ended_at, r.started_at) AS halted_at
           FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id
           ${clause}
           ORDER BY COALESCE(r.ended_at, r.started_at) ASC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Array<{
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
        db.prepare(`SELECT COUNT(*) AS n FROM runs r ${clause}`).get(...params) as { n: number }
      ).n;
      return { rows, total };
    },

    /** Node-level cost/token aggregates for a single run, used by comparison views. */
    runStats(runId: string) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS nodes,
                  COALESCE(SUM(tokens_in), 0) AS tokens_in,
                  COALESCE(SUM(tokens_out), 0) AS tokens_out,
                  COALESCE(SUM(cost_usd), 0) AS cost_usd
           FROM node_runs WHERE run_id = ?`,
        )
        .get(runId) as {
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
    record(runId: string, event: RunEvent) {
      stmts.insertEvent.run(
        runId,
        event.seq,
        event.ts,
        EVENT_SCHEMA_VERSION,
        event.type,
        JSON.stringify(event),
      );

      switch (event.type) {
        case "node.started":
          stmts.upsertNodeRun.run(runId, event.nodeId, event.attempt, event.variant ?? "main", "running");
          break;
        case "node.reasoning":
          // Ensure the row exists then append.
          stmts.upsertNodeRun.run(runId, event.nodeId, event.attempt, event.variant ?? "main", "running");
          stmts.appendReasoning.run(event.text, runId, event.nodeId, event.attempt, event.variant ?? "main");
          break;
        case "node.finished":
          stmts.upsertNodeRun.run(runId, event.nodeId, event.attempt, event.variant ?? "main", "done");
          stmts.finishNodeRun.run(
            "done",
            event.output,
            event.usage.tokensIn,
            event.usage.tokensOut,
            event.usage.cachedTokens ?? 0,
            event.usage.reasoningTokens ?? 0,
            event.usage.costUsd,
            event.usage.units ? JSON.stringify(event.usage.units) : null,
            runId,
            event.nodeId,
            event.attempt,
            event.variant ?? "main",
          );
          break;
        case "node.failed":
          stmts.upsertNodeRun.run(runId, event.nodeId, event.attempt, event.variant ?? "main", "failed");
          stmts.failNodeRun.run(
            event.error,
            event.errorCode ?? null,
            runId,
            event.nodeId,
            event.attempt,
            event.variant ?? "main",
          );
          break;
        case "gate.verdict":
          // Persist the judge's quality score so the eval report can aggregate
          // it per prompt version (the "evaluation linkage").
          if (typeof event.score === "number") {
            stmts.setNodeScore.run(event.score, runId, event.nodeId, event.attempt, event.variant ?? "main");
          }
          break;
      }
    },

    events(runId: string): RunEvent[] {
      const rows = stmts.listEvents.all(runId) as { payload: string }[];
      return rows.map((r) => JSON.parse(r.payload) as RunEvent);
    },

    /**
     * Bounded event window for paginated reads. `after` is exclusive (pass -1
     * to start from the beginning). Fetches `limit + 1` rows so the caller can
     * detect `hasMore`; the extra row is not returned.
     */
    eventsRange(runId: string, after: number, limit: number): {
      events: RunEvent[];
      nextCursor: number | null;
    } {
      const rows = stmts.listEventsRange.all(runId, after, limit + 1) as Array<{
        seq: number;
        payload: string;
      }>;
      const page = rows.slice(0, limit);
      const events = page.map((r) => JSON.parse(r.payload) as RunEvent);
      const nextCursor = rows.length > limit ? page.at(-1)!.seq : null;
      return { events, nextCursor };
    },

    nextSeq(runId: string): number {
      const row = stmts.maxSeq.get(runId) as { seq: number };
      return row.seq + 1;
    },

    /** Mark any runs left in 'running' state (e.g. after a server restart) as interrupted. */
    markZombiesInterrupted(at: number) {
      stmts.markInterrupted.run(at);
    },

    insertArtifact(a: StoredArtifact, userId: string) {
      stmts.insertArtifact.run(
        a.id, a.runId, userId, a.nodeId, a.attempt, a.variant ?? "main", a.graphId ?? null, a.role ?? null,
        a.kind, a.mimeType, a.label, a.sizeBytes, a.storage, a.uri, a.createdAt,
      );
    },

    listArtifactsForRun(runId: string, userId: string): StoredArtifact[] {
      return mapArtifacts(stmts.listArtifactsByRun.all(runId, userId) as ArtifactRow[]);
    },

    getArtifact(id: string, userId: string): StoredArtifact | null {
      const row = stmts.getArtifact.get(id, userId) as ArtifactRow | undefined;
      return row ? mapArtifact(row) : null;
    },

    /** Engine-only: resolves an artifact the calling run already owns. Never wire to a route. */
    getArtifactUnscoped(id: string): StoredArtifact | null {
      const row = stmts.getArtifactUnscoped.get(id) as ArtifactRow | undefined;
      return row ? mapArtifact(row) : null;
    },

    listArtifacts(userId: string, limit = 100, offset = 0): StoredArtifact[] {
      return mapArtifacts(stmts.listArtifacts.all(userId, limit, offset) as ArtifactRow[]);
    },

    deleteRun(runId: string, userId: string) {
      stmts.deleteArtifactsForRun.run(runId);
      stmts.deleteEvents.run(runId);
      stmts.deleteNodeRuns.run(runId);
      stmts.deleteRun.run(runId, userId);
    },

    /**
     * Aggregate cost/token usage over completed (non-running) node attempts.
     * `from`/`to` are epoch milliseconds filtering by run start time.
     */
    costReport(opts: { from?: number; to?: number; userId?: string } = {}) {
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

      const totals = db
        .prepare(
          `SELECT
             COALESCE(SUM(n.cost_usd), 0)      AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)     AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0)    AS tokens_out,
             COALESCE(SUM(n.cached_tokens), 0) AS cached_tokens,
             COALESCE(SUM(n.reasoning_tokens), 0) AS reasoning_tokens,
             COUNT(DISTINCT n.run_id)          AS runs
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}`,
        )
        .get(...params) as {
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
        cached_tokens: number;
        reasoning_tokens: number;
        runs: number;
      };

      const byGraph = db
        .prepare(
          `SELECT
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
           ORDER BY cost_usd DESC`,
        )
        .all(...params) as Array<{
        graph_id: string;
        graph_name: string;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
        runs: number;
      }>;

      const byNode = db
        .prepare(
          `SELECT r.graph_id AS graph_id,
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
           LIMIT 50`,
        )
        .all(...params) as Array<{
        graph_id: string;
        graph_name: string;
        node_id: string;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
        attempts: number;
        reworks: number;
      }>;

      const byAttempt = db
        .prepare(
          `SELECT n.attempt AS attempt,
             COUNT(*) AS calls,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}
           GROUP BY n.attempt
           ORDER BY n.attempt`,
        )
        .all(...params) as Array<{
        attempt: number;
        calls: number;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
      }>;

      const byDay = db
        .prepare(
          `SELECT date(r.started_at / 1000, 'unixepoch', 'localtime') AS day,
             COUNT(DISTINCT n.run_id) AS runs,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}
           GROUP BY day
           ORDER BY day`,
        )
        .all(...params) as Array<{
        day: string;
        runs: number;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
      }>;

      const byWeek = db
        .prepare(
          `SELECT strftime('%Y-W%W', r.started_at / 1000, 'unixepoch', 'localtime') AS week,
             COUNT(DISTINCT n.run_id) AS runs,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}
           GROUP BY week
           ORDER BY week`,
        )
        .all(...params) as Array<{
        week: string;
        runs: number;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
      }>;

      const byMonth = db
        .prepare(
          `SELECT strftime('%Y-%m', r.started_at / 1000, 'unixepoch', 'localtime') AS month,
             COUNT(DISTINCT n.run_id) AS runs,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}
           GROUP BY month
           ORDER BY month`,
        )
        .all(...params) as Array<{
        month: string;
        runs: number;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
      }>;

      // Resolve node display names from the most recent run snapshot per
      // graph. The live graph may have been renamed/deleted since, but the
      // snapshot frozen on the run always reflects what actually executed.
      const snapshotRows = db
        .prepare(
          `SELECT graph_id, snapshot FROM runs r
           WHERE id = (SELECT id FROM runs WHERE graph_id = r.graph_id ORDER BY started_at DESC LIMIT 1)`,
        )
        .all() as Array<{ graph_id: string; snapshot: string }>;
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
    costRows(opts: { from?: number; to?: number; userId?: string } = {}) {
      const { byGraph, byNode, byAttempt, byDay } = this.costReport(opts);
      return { byGraph, byNode, byAttempt, byDay };
    },

    /**
     * Total cost accrued across finished runs that started within the given
     * calendar month (local time). Used to evaluate the monthly budget guard.
     */
    costForMonth(year: number, month: number, userId?: string): number {
      const start = new Date(year, month - 1, 1).getTime();
      const end = new Date(year, month, 1).getTime();
      const where: string[] = ["r.status != 'running'", "r.started_at >= ?", "r.started_at < ?"];
      const params: (string | number)[] = [];
      if (userId) {
        where.push("r.user_id = ?");
        params.push(userId);
      }
      params.push(start, end);
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(n.cost_usd), 0) AS cost
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           WHERE ${where.join(" AND ")}`,
        )
        .get(...params) as { cost: number };
      return row.cost;
    },

    evalReport(opts: { graphId?: string; from?: number; to?: number; userId?: string } = {}) {
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

      const runRows = db
        .prepare(
          `SELECT
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
           GROUP BY r.id`,
        )
        .all(...params) as Array<{
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
        (opts.userId ? this.listGraphs(opts.userId) : [] as Array<{ id: string; name: string }>)
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
      const snapshotRows = (opts.userId ? stmts.evalSnapshots.all(opts.userId) : []) as Array<{
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

    abReport(groupId: string, userId: string): ABReport | null {
      const rows = db
        .prepare(
          `SELECT
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
           ORDER BY r.ab_arm`,
        )
        .all(groupId, userId) as Array<{
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
        const snap = db
          .prepare(
            `SELECT snapshot FROM runs WHERE ab_group = ? AND ab_arm = ? AND user_id = ? AND snapshot IS NOT NULL LIMIT 1`,
          )
          .get(groupId, r.arm, userId) as { snapshot: string } | undefined;
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

    listBrandTerms(userId: string) {
      return db
        .prepare(
          `SELECT id, term, note, created_at AS createdAt FROM brand_terms WHERE user_id = ? ORDER BY created_at ASC`,
        )
        .all(userId) as Array<{ id: string; term: string; note: string; createdAt: number }>;
    },

    // --- Per-user settings (16) ---
    getSettings(userId: string): string | null {
      const row = stmts.getSettings.get(userId) as { data: string } | undefined;
      return row?.data ?? null;
    },
    saveSettings(userId: string, data: string): void {
      stmts.saveSettings.run(userId, data, Date.now());
    },
    // --- Audit log (29) ---
    insertAudit(entry: {
      id: string;
      userId: string;
      action: string;
      objectType?: string;
      objectId?: string;
      detail?: string;
      ip?: string;
    }): void {
      stmts.insertAudit.run(
        entry.id,
        entry.userId,
        entry.action,
        entry.objectType ?? null,
        entry.objectId ?? null,
        entry.detail ?? null,
        entry.ip ?? null,
        Date.now(),
      );
    },
    listAudit(
      userId: string,
      opts: { limit?: number; before?: number } = {},
    ): Array<Record<string, unknown>> {
      const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
      const rows = (
        opts.before && opts.before > 0
          ? stmts.listAudit.all(userId, opts.before, limit)
          : stmts.listAuditFirst.all(userId, limit)
      ) as Array<Record<string, unknown>>;
      return rows;
    },
    // --- Announcements (30) ---
    listActiveAnnouncements(now = Date.now()): Array<Record<string, unknown>> {
      return stmts.listActiveAnnouncements.all(now, now) as Array<Record<string, unknown>>;
    },
    listAnnouncements(): Array<Record<string, unknown>> {
      return stmts.listAllAnnouncements.all() as Array<Record<string, unknown>>;
    },
    getAnnouncement(id: string): Record<string, unknown> | undefined {
      return stmts.getAnnouncement.get(id) as Record<string, unknown> | undefined;
    },
    createAnnouncement(input: {
      id: string;
      titleZh: string;
      titleEn: string;
      bodyZh?: string | null;
      bodyEn?: string | null;
      level: string;
      startsAt: number;
      endsAt?: number | null;
      target?: string | null;
    }): void {
      stmts.insertAnnouncement.run(
        input.id,
        input.titleZh,
        input.titleEn,
        input.bodyZh ?? null,
        input.bodyEn ?? null,
        input.level,
        input.startsAt,
        input.endsAt ?? null,
        input.target ?? null,
        Date.now(),
      );
    },
    updateAnnouncement(
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
    ): boolean {
      const res = stmts.updateAnnouncement.run(
        patch.titleZh,
        patch.titleEn,
        patch.bodyZh ?? null,
        patch.bodyEn ?? null,
        patch.level,
        patch.startsAt,
        patch.endsAt ?? null,
        patch.target ?? null,
        id,
      ) as { changes: number };
      return res.changes > 0;
    },
    deleteAnnouncement(id: string): boolean {
      const res = stmts.deleteAnnouncement.run(id) as { changes: number };
      return res.changes > 0;
    },
    markAnnouncementRead(userId: string, announcementId: string): void {
      stmts.insertAnnouncementRead.run(userId, announcementId, Date.now());
    },
    announcementReads(userId: string): Set<string> {
      const rows = stmts.listAnnouncementReads.all(userId) as Array<{ announcement_id: string }>;
      return new Set(rows.map((r) => r.announcement_id));
    },
    addBrandTerm(userId: string, term: string, note = "") {
      const t = term.trim();
      if (!t) throw new Error("品牌词不能为空");
      const id = randomUUID();
      const now = Date.now();
      db.prepare(`INSERT INTO brand_terms (id, user_id, term, note, created_at) VALUES (?, ?, ?, ?, ?)`).run(
        id,
        userId,
        t,
        note,
        now,
      );
      return { id, term: t, note, createdAt: now };
    },
    deleteBrandTerm(id: string, userId: string) {
      db.prepare(`DELETE FROM brand_terms WHERE id = ? AND user_id = ?`).run(id, userId);
    },

    // --- Banned terms (F3 compliance: per-user supplementary banned words) ---
    listBannedTerms(userId: string) {
      return db
        .prepare(
          `SELECT id, term, note, created_at AS createdAt FROM banned_terms WHERE user_id = ? ORDER BY created_at ASC`,
        )
        .all(userId) as Array<{ id: string; term: string; note: string; createdAt: number }>;
    },

    addBannedTerm(userId: string, term: string, note = "") {
      const t = term.trim();
      if (!t) throw new Error("违禁词不能为空");
      const id = randomUUID();
      const now = Date.now();
      db.prepare(`INSERT INTO banned_terms (id, user_id, term, note, created_at) VALUES (?, ?, ?, ?, ?)`).run(
        id,
        userId,
        t,
        note,
        now,
      );
      return { id, term: t, note, createdAt: now };
    },

    deleteBannedTerm(id: string, userId: string) {
      db.prepare(`DELETE FROM banned_terms WHERE id = ? AND user_id = ?`).run(id, userId);
    },

    /** All banned terms of a user, comma-joined for the compliance check. */
    bannedTermsText(userId: string): string {
      const rows = db
        .prepare(`SELECT term FROM banned_terms WHERE user_id = ? ORDER BY created_at ASC`)
        .all(userId) as Array<{ term: string }>;
      return rows.map((r) => r.term).join(",");
    },

    // --- Products (F4: reusable product library) ---
    listProducts(
      userId: string,
      opts: { search?: string; category?: string; status?: string } = {},
    ): Product[] {
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
        where.push("(name LIKE ? OR brand LIKE ? OR sku LIKE ?)");
        params.push(like, like, like);
      }
      const rows = db
        .prepare(`SELECT * FROM products WHERE ${where.join(" AND ")} ORDER BY created_at DESC`)
        .all(...params) as Array<Record<string, unknown>>;
      return rows.map(productFromRow);
    },

    /** Active products by id, in the given order — feeds the `product` connector. */
    getProductsByIds(userId: string, ids: string[]): Product[] {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      const rows = db
        .prepare(`SELECT * FROM products WHERE user_id = ? AND id IN (${placeholders})`)
        .all(userId, ...ids) as Array<Record<string, unknown>>;
      const byId = new Map(rows.map((r) => [r.id as string, productFromRow(r)]));
      return ids.map((id) => byId.get(id)).filter((p): p is Product => p != null);
    },

    addProduct(
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
    ): Product {
      const name = input.name.trim();
      if (!name) throw new Error("商品名不能为空");
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO products (id, user_id, sku, name, brand, category, price, attributes_json, images_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      ).run(
        id,
        userId,
        input.sku ?? "",
        name,
        input.brand ?? "",
        input.category ?? "",
        input.price ?? null,
        JSON.stringify(input.attributes ?? {}),
        JSON.stringify(input.images ?? []),
        now,
        now,
      );
      return this.getProductsByIds(userId, [id])[0]!;
    },

    updateProduct(
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
    ): Product | undefined {
      const cur = this.getProductsByIds(userId, [id])[0];
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
      db.prepare(
        `UPDATE products SET sku = ?, name = ?, brand = ?, category = ?, price = ?, attributes_json = ?, images_json = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      ).run(
        next.sku,
        next.name,
        next.brand,
        next.category,
        next.price,
        JSON.stringify(next.attributes),
        JSON.stringify(next.images),
        next.status,
        Date.now(),
        id,
        userId,
      );
      return this.getProductsByIds(userId, [id])[0]!;
    },

    deleteProduct(id: string, userId: string) {
      db.prepare(`DELETE FROM products WHERE id = ? AND user_id = ?`).run(id, userId);
    },

    // --- Brand assets (F4: reusable brand material) ---
    listBrandAssets(userId: string): BrandAsset[] {
      const rows = db
        .prepare(`SELECT * FROM brand_assets WHERE user_id = ? ORDER BY created_at DESC`)
        .all(userId) as Array<Record<string, unknown>>;
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

    addBrandAsset(
      userId: string,
      input: { type: string; label: string; uri?: string; tags?: string[] },
    ): BrandAsset {
      const label = input.label.trim();
      if (!label) throw new Error("素材名称不能为空");
      const id = randomUUID();
      const now = Date.now();
      db.prepare(
        `INSERT INTO brand_assets (id, user_id, type, label, uri, tags_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, userId, input.type, label, input.uri ?? "", JSON.stringify(input.tags ?? []), now);
      return { id, type: input.type, label, uri: input.uri ?? "", tags: input.tags ?? [], createdAt: now };
    },

    deleteBrandAsset(id: string, userId: string) {
      db.prepare(`DELETE FROM brand_assets WHERE id = ? AND user_id = ?`).run(id, userId);
    },

    // --- Batch jobs (F5: one run per input row, grouped for progress) ---
    createBatch(input: {
      id: string;
      userId: string;
      graphId: string;
      sourceName?: string;
      rows: Record<string, unknown>[];
    }): BatchJob {
      const now = Date.now();
      db.prepare(
        `INSERT INTO batch_jobs (id, user_id, graph_id, status, total, succeeded, failed, source_name, created_at)
         VALUES (?, ?, ?, 'pending', ?, 0, 0, ?, ?)`,
      ).run(input.id, input.userId, input.graphId, input.rows.length, input.sourceName ?? null, now);
      const insertItem = db.prepare(
        `INSERT INTO batch_items (id, batch_id, row_index, input_json, status) VALUES (?, ?, ?, ?, 'pending')`,
      );
      for (let i = 0; i < input.rows.length; i++) {
        insertItem.run(randomUUID(), input.id, i, JSON.stringify(input.rows[i]));
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

    listBatches(userId: string): BatchJob[] {
      const rows = db
        .prepare(`SELECT * FROM batch_jobs WHERE user_id = ? ORDER BY created_at DESC`)
        .all(userId) as Array<Record<string, unknown>>;
      return rows.map(batchFromRow);
    },

    getBatch(id: string, userId: string): BatchJob | null {
      const row = db.prepare(`SELECT * FROM batch_jobs WHERE id = ? AND user_id = ?`).get(id, userId) as
        | Record<string, unknown>
        | undefined;
      return row ? batchFromRow(row) : null;
    },

    listBatchItems(batchId: string): BatchItem[] {
      const rows = db
        .prepare(`SELECT * FROM batch_items WHERE batch_id = ? ORDER BY row_index ASC`)
        .all(batchId) as Array<Record<string, unknown>>;
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

    markBatchItemRunning(itemId: string, runId: string) {
      db.prepare(`UPDATE batch_items SET status = 'running', run_id = ? WHERE id = ?`).run(runId, itemId);
    },

    markBatchItemDone(itemId: string, outputSummary: string | null, artifactIds: string[]) {
      db.prepare(
        `UPDATE batch_items SET status = 'done', output_summary = ?, artifact_ids_json = ?, error = NULL WHERE id = ?`,
      ).run(outputSummary ?? "", JSON.stringify(artifactIds), itemId);
    },

    markBatchItemFailed(itemId: string, error: string) {
      db.prepare(`UPDATE batch_items SET status = 'failed', error = ? WHERE id = ?`).run(error, itemId);
    },

    setBatchStatus(id: string, status: BatchJob["status"], finishedAt: number | null) {
      db.prepare(`UPDATE batch_jobs SET status = ?, finished_at = ? WHERE id = ?`).run(status, finishedAt, id);
    },

    updateBatchCounts(id: string, succeeded: number, failed: number) {
      db.prepare(`UPDATE batch_jobs SET succeeded = ?, failed = ? WHERE id = ?`).run(succeeded, failed, id);
    },

    // --- Content calendar (F8: scheduled publishing plan) ---
    createPlan(input: {
      id: string;
      userId: string;
      graphId?: string | null;
      runId?: string | null;
      artifactId?: string | null;
      platform?: string | null;
      title: string;
      scheduledAt: number;
      note?: string | null;
    }): ContentPlan {
      const now = Date.now();
      db.prepare(
        `INSERT INTO content_plan (id, user_id, graph_id, run_id, artifact_id, platform, title, scheduled_at, status, published_url, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?)`,
      ).run(
        input.id,
        input.userId,
        input.graphId ?? null,
        input.runId ?? null,
        input.artifactId ?? null,
        input.platform ?? null,
        input.title,
        input.scheduledAt,
        input.note ?? null,
        now,
        now,
      );
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

    listPlans(userId: string, from?: number, to?: number): ContentPlan[] {
      const rows = (
        from != null && to != null
          ? db
              .prepare(`SELECT * FROM content_plan WHERE user_id = ? AND scheduled_at >= ? AND scheduled_at <= ? ORDER BY scheduled_at ASC`)
              .all(userId, from, to)
          : db
              .prepare(`SELECT * FROM content_plan WHERE user_id = ? ORDER BY scheduled_at ASC`)
              .all(userId)
      ) as Array<Record<string, unknown>>;
      return rows.map(planFromRow);
    },

    getPlan(id: string, userId: string): ContentPlan | null {
      const row = db.prepare(`SELECT * FROM content_plan WHERE id = ? AND user_id = ?`).get(id, userId) as
        | Record<string, unknown>
        | undefined;
      return row ? planFromRow(row) : null;
    },

    updatePlan(
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
    ): ContentPlan | null {
      const existing = this.getPlan(id, userId);
      if (!existing) return null;
      const next = { ...existing, ...patch, updatedAt: Date.now() };
      db.prepare(
        `UPDATE content_plan SET graph_id = ?, run_id = ?, artifact_id = ?, platform = ?, title = ?, scheduled_at = ?, status = ?, published_url = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      ).run(
        next.graphId,
        next.runId,
        next.artifactId,
        next.platform,
        next.title,
        next.scheduledAt,
        next.status,
        next.publishedUrl,
        next.note,
        next.updatedAt,
        id,
        userId,
      );
      return next;
    },

    deletePlan(id: string, userId: string) {
      db.prepare(`DELETE FROM content_plan WHERE id = ? AND user_id = ?`).run(id, userId);
    },

    // --- Performance metrics (F6: content effect feedback loop) ---
    insertMetric(input: {
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
    }): ContentMetric {
      db.prepare(
        `INSERT INTO content_metrics (id, user_id, graph_id, run_id, node_id, variant, artifact_id, product_id, platform, external_content_id, impressions, clicks, conversions, gmv, ad_spend, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.userId,
        input.graphId ?? null,
        input.runId ?? null,
        input.nodeId ?? null,
        input.variant ?? null,
        input.artifactId ?? null,
        input.productId ?? null,
        input.platform ?? null,
        input.externalContentId ?? null,
        input.impressions ?? 0,
        input.clicks ?? 0,
        input.conversions ?? 0,
        input.gmv ?? 0,
        input.adSpend ?? 0,
        input.recordedAt,
      );
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

    listMetrics(userId: string): ContentMetric[] {
      const rows = db
        .prepare(`SELECT * FROM content_metrics WHERE user_id = ? ORDER BY recorded_at DESC`)
        .all(userId) as Array<Record<string, unknown>>;
      return rows.map(metricFromRow);
    },

    /** Aggregate metrics by one column (graph_id/run_id/platform/product_id/artifact_id). */
    aggregatePerformance(userId: string, groupBy: string): PerformanceAggregate[] {
      const allowed = new Set(["graph_id", "run_id", "node_id", "variant", "artifact_id", "product_id", "platform", "external_content_id"]);
      const col = allowed.has(groupBy) ? groupBy : "graph_id";
      const rows = db
        .prepare(
          `SELECT COALESCE(${col}, '') AS grp, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
                  SUM(conversions) AS conversions, SUM(gmv) AS gmv, SUM(ad_spend) AS ad_spend
           FROM content_metrics WHERE user_id = ? GROUP BY ${col} ORDER BY impressions DESC`,
        )
        .all(userId) as Array<Record<string, unknown>>;
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
    insertContentCost(input: {
      id: string;
      userId: string;
      artifactId?: string | null;
      productId?: string | null;
      platform?: string | null;
      variant?: string | null;
      costUsd?: number;
      gmv?: number;
      capturedAt: number;
    }): ContentCost {
      const costUsd = input.costUsd ?? 0;
      const gmv = input.gmv ?? 0;
      const roi = costUsd > 0 ? gmv / costUsd : 0;
      db.prepare(
        `INSERT INTO content_costs (id, user_id, artifact_id, product_id, platform, variant, cost_usd, gmv, roi, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.userId,
        input.artifactId ?? null,
        input.productId ?? null,
        input.platform ?? null,
        input.variant ?? null,
        costUsd,
        gmv,
        roi,
        input.capturedAt,
      );
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

    listContentCosts(userId: string): ContentCost[] {
      const rows = db
        .prepare(`SELECT * FROM content_costs WHERE user_id = ? ORDER BY captured_at DESC`)
        .all(userId) as Array<Record<string, unknown>>;
      return rows.map(costFromRow);
    },

    /** Aggregate content costs by artifact_id/product_id/platform/variant. */
    aggregateContentCosts(userId: string, groupBy: string): ContentCostAggregate[] {
      const allowed = new Set(["artifact_id", "product_id", "platform", "variant"]);
      const col = allowed.has(groupBy) ? groupBy : "artifact_id";
      const rows = db
        .prepare(
          `SELECT COALESCE(${col}, '') AS grp, SUM(cost_usd) AS cost_usd, SUM(gmv) AS gmv
           FROM content_costs WHERE user_id = ? GROUP BY ${col} ORDER BY cost_usd DESC`,
        )
        .all(userId) as Array<Record<string, unknown>>;
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
    createPublishTarget(input: {
      id: string;
      userId: string;
      platform: string;
      name?: string | null;
      provider: string;
      configEncrypted: string;
      createdAt: number;
    }): PublishTarget {
      db.prepare(
        `INSERT INTO publish_targets (id, user_id, platform, name, provider, config_encrypted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.userId, input.platform, input.name ?? null, input.provider, input.configEncrypted, input.createdAt);
      return {
        id: input.id,
        platform: input.platform,
        name: input.name ?? null,
        provider: input.provider,
        configEncrypted: input.configEncrypted,
        createdAt: input.createdAt,
      };
    },

    listPublishTargets(userId: string): PublishTarget[] {
      return db
        .prepare(`SELECT * FROM publish_targets WHERE user_id = ? ORDER BY created_at DESC`)
        .all(userId)
        .map((r) => ({
          id: String(r.id),
          platform: String(r.platform),
          name: r.name ? String(r.name) : null,
          provider: String(r.provider),
          configEncrypted: String(r.config_encrypted),
          createdAt: Number(r.created_at),
        }));
    },

    deletePublishTarget(id: string, userId: string): boolean {
      const r = db.prepare(`DELETE FROM publish_targets WHERE id = ? AND user_id = ?`).run(id, userId);
      return r.changes > 0;
    },

    /** Cross-user lookup for the metrics webhook (no session user in an inbound webhook). */
    getPublishTarget(id: string): (PublishTarget & { userId: string }) | null {
      const r = db.prepare(`SELECT * FROM publish_targets WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
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

    insertPublishedContent(input: {
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
    }): PublishedContent {
      db.prepare(
        `INSERT INTO published_contents (id, user_id, graph_id, run_id, artifact_id, platform, status, external_id, external_url, published_at, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id, input.userId, input.graphId ?? null, input.runId ?? null, input.artifactId ?? null,
        input.platform ?? null, input.status, input.externalId ?? null, input.externalUrl ?? null,
        input.publishedAt ?? null, input.detailJson ?? null,
      );
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

    listPublishedContents(userId: string): PublishedContent[] {
      return db
        .prepare(`SELECT * FROM published_contents WHERE user_id = ? ORDER BY published_at DESC`)
        .all(userId)
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
    listVersions(graphId: string, userId: string) {
      return db
        .prepare(`SELECT gv.id, gv.graph_id AS graphId, gv.name, gv.note, gv.content_hash AS contentHash, gv.created_at AS createdAt
                  FROM graph_versions gv JOIN graphs g ON g.id = gv.graph_id
                  WHERE gv.graph_id = ? AND g.user_id = ? ORDER BY gv.created_at DESC, gv.rowid DESC`)
        .all(graphId, userId) as Array<{ id: string; graphId: string; name: string; note: string; contentHash: string; createdAt: number }>;
    },
    /**
     * Content hash of the graph as executed by the most recent run of this
     * graph (runs.snapshot stores the full graph JSON at execution time), or
     * null when the graph has never run. Lets the version panel flag which
     * snapshot matches what actually ran.
     */
    getLatestRunContentHash(graphId: string, userId: string): string | null {
      const row = db
        .prepare(`SELECT snapshot FROM runs WHERE graph_id = ? AND user_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`)
        .get(graphId, userId) as { snapshot: string } | undefined;
      return row ? contentHash(openDocString(row.snapshot)) : null;
    },
    getVersion(id: string, userId: string) {
      const row = db.prepare(`SELECT gv.* FROM graph_versions gv JOIN graphs g ON g.id = gv.graph_id
                          WHERE gv.id = ? AND g.user_id = ?`).get(id, userId) as
        | { id: string; graph_id: string; name: string; snapshot: string; note: string; created_at: number }
        | undefined;
      return row ? { ...row, snapshot: openDocString(row.snapshot) } : undefined;
    },
    saveVersion(graphId: string, name: string, snapshot: string, note = "", contentHash = "") {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(`INSERT INTO graph_versions (id, graph_id, name, snapshot, note, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id, graphId, name, sealDocString(snapshot), note, contentHash, now,
      );
      return { id, graphId, name, note, createdAt: now };
    },
    /**
     * Auto-snapshot taken right before a save overwrites the graph. Throttled:
     * skipped when the latest auto-snapshot for this graph is recent (within
     * `minIntervalMs`) AND captured the same content. Rolling retention: keeps
     * at most `maxKeep` auto-snapshots per graph (manual snapshots are never
     * pruned here). Returns the created version id, or null when skipped.
     */
    saveAutoSnapshot(graphId: string, snapshot: string, minIntervalMs: number, maxKeep: number): string | null {
      const hash = contentHash(snapshot);
      // rowid DESC breaks created_at ties (same-millisecond snapshots) by
      // insertion order, keeping throttle/retention deterministic.
      const last = db
        .prepare(`SELECT content_hash, created_at FROM graph_versions WHERE graph_id = ? AND note = 'auto' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
        .get(graphId) as { content_hash: string; created_at: number } | undefined;
      if (last && Date.now() - last.created_at < minIntervalMs && last.content_hash === hash) return null;

      const id = randomUUID();
      const now = Date.now();
      db.prepare(`INSERT INTO graph_versions (id, graph_id, name, snapshot, note, content_hash, created_at) VALUES (?, ?, ?, ?, 'auto', ?, ?)`).run(
        id, graphId, `auto-${new Date(now).toISOString().slice(0, 16).replace("T", " ")}`, sealDocString(snapshot), hash, now,
      );
      // Rolling retention: prune oldest auto-snapshots beyond maxKeep.
      const stale = db
        .prepare(`SELECT id FROM graph_versions WHERE graph_id = ? AND note = 'auto' ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?`)
        .all(graphId, maxKeep) as Array<{ id: string }>;
      for (const row of stale) {
        db.prepare(`DELETE FROM graph_versions WHERE id = ?`).run(row.id);
      }
      return id;
    },
    deleteVersion(id: string, userId: string) {
      db.prepare(`DELETE FROM graph_versions WHERE id = ? AND graph_id IN (SELECT id FROM graphs WHERE user_id = ?)`).run(id, userId);
    },

    getGraphById(id: string): (Graph & { version: number }) | null {
      const row = stmts.getGraphById.get(id) as { doc: string; version: number } | undefined;
      return row ? { ...(openGraphDoc(JSON.parse(row.doc) as Graph)), version: row.version } : null;
    },

    listAllGraphs() {
      return stmts.listAllGraphs.all() as Array<{
        id: string;
        name: string;
        version: number;
        updated_at: number;
      }>;
    },

    getGraphOwnerId(id: string): string | undefined {
      const row = stmts.getGraphOwnerId.get(id) as { user_id: string } | undefined;
      return row?.user_id;
    },

    finishRunById(runId: string, status: string, at: number) {
      stmts.finishRunById.run(status, at, runId);
    },

    markRunningById(runId: string) {
      stmts.markRunningById.run(runId);
    },

    getRunById(runId: string) {
      const row = stmts.getRunById.get(runId) as
        | { id: string; graph_id: string; snapshot: string; status: string; budget_usd: number | null; started_at: number; ended_at: number | null }
        | undefined;
      return row ? { ...row, snapshot: openDocString(row.snapshot) } : undefined;
    },

    listRunsUnscoped(limit = 50, offset = 0) {
      return stmts.listRunsUnscoped.all(limit, offset) as Array<Record<string, unknown>>;
    },

    listRunsByGraphUnscoped(graphId: string, limit = 1) {
      return stmts.listRunsByGraphUnscoped.all(graphId, limit) as Array<Record<string, unknown>>;
    },

    saveGraphUnscoped(graph: Graph, at: number) {
      const doc = JSON.stringify(sealGraphDoc(graph));
      // Preserve template lineage: the upsert's update branch never touches
      // origin_template_id, but the insert branch needs the existing value.
      const row = db
        .prepare(`SELECT origin_template_id FROM graphs WHERE id = ?`)
        .get(graph.id) as { origin_template_id: string | null } | undefined;
      stmts.insertGraph.run(graph.id, null, graph.name, doc, row?.origin_template_id ?? null, at);
    },

    close() {
      db.close();
    },

    /** Passthrough to the underlying DatabaseSync.prepare — for modules that
     *  manage their own tables (e.g. knowledge base FTS). */
    prepare(sql: string) {
      return db.prepare(sql);
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

/** The schema version this build expects. Exposed for diagnostics/backups. */
export const SCHEMA_VERSION = LATEST_VERSION;

/**
 * If the users table is empty but data tables have rows (pre-auth database),
 * create a default user and assign all existing data to it. This ensures
 * zero-downtime migration for dev databases.
 */
export function backfillExistingData(database: { prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown } }): void {
  const userCount = (database.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
  if (userCount > 0) return;

  const graphCount = (database.prepare("SELECT COUNT(*) as c FROM graphs").get() as { c: number }).c;
  if (graphCount === 0) return;

  const defaultUserId = randomUUID();
  const defaultEmail = "admin@local.dev";
  const placeholderHash = "__no_login__";

  database.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
    defaultUserId,
    defaultEmail,
    placeholderHash,
  );
  database.prepare("UPDATE graphs SET user_id = ? WHERE user_id IS NULL").run(defaultUserId);
  database.prepare("UPDATE runs SET user_id = ? WHERE user_id IS NULL").run(defaultUserId);
  database.prepare("UPDATE brand_terms SET user_id = ? WHERE user_id IS NULL").run(defaultUserId);
  // Migration 15 already attributed run/graph-linked artifacts; whatever is still
  // ownerless here is a pre-auth upload with no link to follow.
  database.prepare("UPDATE artifacts SET user_id = ? WHERE user_id IS NULL").run(defaultUserId);
}
