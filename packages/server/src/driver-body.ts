/** Shared driver body (137 methods) used by both SQLite and PostgreSQL drivers
 * (audit P2 split). Moved verbatim from sqlite-driver.ts; the SQLite-specific
 * glue (createSqliteDriver / createSqliteExecutor) stays in sqlite-driver.ts. */
import { type DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { EVENT_SCHEMA_VERSION, buildTimeline, projectGateVerdict, type Graph, type RunEvent } from "@agent-world/core";
import type { StoredArtifact } from "./artifact-store.js";
import { decryptString, encryptString, openDocString, openGraphDoc, sealDocString, sealGraphDoc } from "./at-rest.js";
import { log } from "./logger.js";
import {
  contentHash, mapArtifact, mapArtifacts, productFromRow, batchFromRow, planFromRow, metricFromRow, costFromRow,
  type ArtifactRow,
} from "./sqlite-mappers.js";
import { DEMO_CASCADE_INDIRECT_TABLES, DEMO_CASCADE_DIRECT_TABLES, DEMO_CASCADE_GLOBAL_TABLES } from "./sqlite-cascade.js";
import type { InvoiceRow } from "./sqlite-schema.js";
import type { Executor } from "./sqlite-driver.js";
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
  GraphRunSummary,
  GraphMetrics,
  PerformanceAggregate,
  OperationsEconomy,
  Product,
  PublishTarget,
  PublishedContent,
  RemoteJob,
  NewRemoteJob,
} from "./db.js";
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
  // Deterministic tie-break for same-millisecond writes: SQLite's implicit
  // rowid becomes PostgreSQL's ctid (physical tuple id) under PG.
  const tie = dialect === "postgres" ? "ctid" : "rowid";
  const stmts = {
    createUser: `INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)`,
    // Demo users are always role='user', is_demo=1 — never reuse createUser's
    // first-account owner inference (design-demo-user §5.2).
    createDemoUser: `INSERT INTO users (id, email, password_hash, role, is_demo, demo_expires_at)
       VALUES (?, ?, ?, 'user', 1, ?)`,
    // Accounts an owner opened for someone else (POST /api/admin/users): always
    // role='user' (never createUser's owner inference) and flagged so the holder
    // of the one-time password must replace it before the account can be used.
    createProvisionedUser: `INSERT INTO users (id, email, password_hash, role, must_change_password)
       VALUES (?, ?, ?, 'user', 1)`,
    claimDemoUser: `UPDATE users SET email = ?, password_hash = ?, is_demo = 0, demo_expires_at = NULL
       WHERE id = ? AND is_demo = 1`,
    listExpiredDemoUsers: `SELECT id, email, role, is_demo, demo_expires_at, must_change_password, created_at FROM users
       WHERE is_demo = 1 AND demo_expires_at IS NOT NULL AND demo_expires_at < ?
       ORDER BY demo_expires_at ASC, ${tie} ASC`,
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
    findUserByEmail: `SELECT id, email, role, is_demo, demo_expires_at, must_change_password, created_at FROM users WHERE email = ?`,
    findUserById: `SELECT id, email, role, is_demo, demo_expires_at, must_change_password, created_at FROM users WHERE id = ?`,
    findUserPasswordHash: `SELECT password_hash FROM users WHERE id = ?`,
    // RBAC P3 (design-rbac.md): full account list for the owner's admin panel.
    // Same ordering as the v31 owner bootstrap — the owner always sorts first.
    listUsers: `SELECT id, email, role, is_demo, demo_expires_at, must_change_password, created_at FROM users ORDER BY created_at ASC, ${tie} ASC`,
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
    // Changing the password IS the fulfilment of must_change_password, so the
    // clear lives here rather than in the route: there is exactly one write path
    // for password_hash (index.ts's /api/auth/password), so it cannot be missed.
    updateUserPasswordHash: `UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
    // Owner-side reset (scripts/reset-password.ts). Unlike the self-service path
    // above, the new hash is a one-time password handed over out-of-band, so it
    // re-arms must_change_password = 1 — same contract as provisioning.
    adminResetUserPassword: `UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`,
    insertGraph: `INSERT INTO graphs (id, user_id, name, doc, origin_template_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, doc = excluded.doc, version = graphs.version + 1, updated_at = excluded.updated_at
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
    // RTS stage-B macro-park coordinates (migration 37). Only laid-out rows are
    // returned (NULL rows are auto-layouted on the client). The write never
    // touches updated_at — a view preference must not reorder the graph list.
    // The shared/membership variant builds its IN(...) placeholders inline.
    parkCoordsOwned: `SELECT id, park_x, park_z FROM graphs WHERE user_id = ? AND park_x IS NOT NULL`,
    setParkCoord: `UPDATE graphs SET park_x = ?, park_z = ? WHERE id = ? AND user_id = ?`,
    clearParkCoord: `UPDATE graphs SET park_x = NULL, park_z = NULL WHERE id = ? AND user_id = ?`,
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
        cached_tokens = ?, reasoning_tokens = ?, cost_usd = ?, units_json = ?, model = ?
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
       ORDER BY a.created_at DESC, a.${tie} DESC LIMIT ? OFFSET ?`,
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
    getSubscription: `SELECT plan, status, provider, external_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_start, current_period_end
       FROM subscriptions WHERE user_id = ?`,
    listAllSubscriptions: `SELECT user_id, plan, status, provider, external_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_start, current_period_end
       FROM subscriptions ORDER BY user_id`,
    findSubscriptionByStripeCustomer: `SELECT user_id, plan, status, provider, external_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_start, current_period_end
       FROM subscriptions WHERE stripe_customer_id = ?`,
    findSubscriptionByStripeSubscription: `SELECT user_id, plan, status, provider, external_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_start, current_period_end
       FROM subscriptions WHERE stripe_subscription_id = ?`,
    upsertSubscription: `INSERT INTO subscriptions (user_id, plan, status, provider, external_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_start, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         plan = excluded.plan, status = excluded.status, provider = excluded.provider,
         external_id = excluded.external_id, stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id, stripe_price_id = excluded.stripe_price_id,
         current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end, updated_at = excluded.updated_at`,
    // usage_ledger statements exist for the P1 quota path and have no caller
    // yet. node_runs remains the metering source of truth; see the table DDL.
    usageForMetric: `SELECT COALESCE(SUM(amount), 0) AS total FROM usage_ledger WHERE user_id = ? AND period_start = ? AND metric = ?`,
    accumulateUsage: `INSERT INTO usage_ledger (user_id, period_start, metric, amount, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, period_start, metric) DO UPDATE SET amount = usage_ledger.amount + excluded.amount, updated_at = excluded.updated_at`,
    // Idempotent overwrite used by the backfill (recompute → replace, never double-count).
    setUsage: `INSERT INTO usage_ledger (user_id, period_start, metric, amount, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, period_start, metric) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at`,
    listUsageLedger: `SELECT user_id, period_start, metric, amount FROM usage_ledger WHERE period_start = ? ORDER BY user_id`,
    // M3 billing invoices (design-monetization-m3 S1): one row per (user, period).
    getInvoice: `SELECT id, user_id, subscription_id, period_start, period_end, plan, amount_usd, status, line_items, paid_at, paid_method, stripe_invoice_id, notes, created_at, updated_at
       FROM invoices WHERE id = ?`,
    listInvoicesByUser: `SELECT id, user_id, subscription_id, period_start, period_end, plan, amount_usd, status, line_items, paid_at, paid_method, stripe_invoice_id, notes, created_at, updated_at
       FROM invoices WHERE user_id = ? ORDER BY period_start DESC`,
    findInvoiceByUserAndPeriod: `SELECT id, user_id, subscription_id, period_start, period_end, plan, amount_usd, status, line_items, paid_at, paid_method, stripe_invoice_id, notes, created_at, updated_at
       FROM invoices WHERE user_id = ? AND period_start = ?`,
    findInvoiceByStripeInvoice: `SELECT id, user_id, subscription_id, period_start, period_end, plan, amount_usd, status, line_items, paid_at, paid_method, stripe_invoice_id, notes, created_at, updated_at
       FROM invoices WHERE stripe_invoice_id = ?`,
    insertInvoice: `INSERT INTO invoices (id, user_id, subscription_id, period_start, period_end, plan, amount_usd, status, line_items, paid_at, paid_method, stripe_invoice_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    updateInvoiceStatus: `UPDATE invoices SET status = ?, paid_at = ?, paid_method = ?, notes = ?, updated_at = ? WHERE id = ?`,
    countActiveRuns: `SELECT COUNT(*) AS n FROM runs WHERE user_id = ? AND status IN ('running', 'halted')`,
    // Stale-halted auto-scrap: halted runs await a human decision; unattended
    // pipelines (cron) can deadlock the concurrency gate if halted runs pile up.
    listStaleHaltedRuns: `SELECT id, ended_at FROM runs WHERE user_id = ? AND status = 'halted' AND ended_at IS NOT NULL AND ended_at < ?`,
    scrapStaleHaltedRun: `UPDATE runs SET status = 'failed', ended_at = ? WHERE id = ? AND user_id = ? AND status = 'halted'`,
    // M2 metering: live storage snapshot + idempotent usage backfill.
    sumArtifactBytes: `SELECT COALESCE(SUM(size_bytes), 0) AS total FROM artifacts WHERE user_id = ?`,
    listFinishedRunsSince: `SELECT id, user_id, started_at, snapshot FROM runs WHERE status = 'done' AND user_id IS NOT NULL AND started_at >= ? ORDER BY started_at`,
    countDistinctUsers: `SELECT COUNT(DISTINCT user_id) AS n FROM runs WHERE user_id IS NOT NULL`,
    // G4 durable remote-job handles (design-step-trace-and-robustness §3.5).
    insertRemoteJob: `INSERT INTO remote_jobs
       (id, user_id, run_id, graph_id, node_id, attempt, kind, provider, remote_job_id, state, submitted_at, last_polled_at, finished_at, error_code, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
       ON CONFLICT DO NOTHING`,
    getOpenRemoteJob: `SELECT id, user_id, run_id, graph_id, node_id, attempt, kind, provider, remote_job_id, state, submitted_at, last_polled_at, finished_at, error_code, meta_json
       FROM remote_jobs
       WHERE run_id = ? AND node_id = ? AND attempt = ? AND state IN ('submitted', 'running')
       ORDER BY submitted_at DESC, ${tie} DESC LIMIT 1`,
    touchRemoteJob: `UPDATE remote_jobs SET state = ?, last_polled_at = ? WHERE id = ?`,
    finishRemoteJob: `UPDATE remote_jobs SET state = ?, finished_at = ?, error_code = ? WHERE id = ?`,
    // G4 admin/ops feed: open (submitted/running) jobs oldest-first so stuck
    // in-flight renders surface first; the all-state view is newest-first. The
    // PG driver inherits these (its executor only translates ? -> $n); LIMIT ?
    // is legal in both dialects.
    listOpenRemoteJobs: `SELECT id, user_id, run_id, graph_id, node_id, attempt, kind, provider, remote_job_id, state, submitted_at, last_polled_at, finished_at, error_code, meta_json
       FROM remote_jobs
       WHERE state IN ('submitted', 'running')
       ORDER BY submitted_at ASC, ${tie} ASC
       LIMIT ?`,
    listAllRemoteJobs: `SELECT id, user_id, run_id, graph_id, node_id, attempt, kind, provider, remote_job_id, state, submitted_at, last_polled_at, finished_at, error_code, meta_json
       FROM remote_jobs
       ORDER BY submitted_at DESC, ${tie} DESC
       LIMIT ?`,
  };

  // M3 S6: subscription rows carry Stripe mirror columns (local DB is a mirror
  // of Stripe, the billing system of record). One mapper keeps the camelCase
  // API shape identical across load/list/find callers.
  type SubscriptionRow = {
    user_id?: string;
    plan: string;
    status: string;
    provider: string | null;
    external_id: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    stripe_price_id: string | null;
    current_period_start: number;
    current_period_end: number;
  };
  // Shared user-row shape (design-demo-user §5): is_demo is 0/1,
  // demo_expires_at is an ISO UTC string for demo accounts and NULL for real
  // accounts. must_change_password is 1 for accounts an owner opened with a
  // one-time password, until that password is replaced.
  // findUser* / listUsers all return this.
  type UserRow = {
    id: string;
    email: string;
    role: string;
    is_demo: number;
    demo_expires_at: string | null;
    must_change_password: number;
    created_at: string;
  };
  const mapSubscriptionRow = (r: SubscriptionRow) => ({
    plan: r.plan,
    status: r.status,
    provider: r.provider,
    externalId: r.external_id,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    stripePriceId: r.stripe_price_id,
    currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end,
  });
  // G4 remote_jobs snake_case row -> camelCase RemoteJob (meta_json is plain JSON).
  type RemoteJobRow = {
    id: string;
    user_id: string;
    run_id: string;
    graph_id: string;
    node_id: string;
    attempt: number;
    kind: string;
    provider: string | null;
    remote_job_id: string;
    state: string;
    submitted_at: number;
    last_polled_at: number | null;
    finished_at: number | null;
    error_code: string | null;
    meta_json: string | null;
  };
  const mapRemoteJob = (r: RemoteJobRow): RemoteJob => ({
    id: r.id,
    userId: r.user_id,
    runId: r.run_id,
    graphId: r.graph_id,
    nodeId: r.node_id,
    attempt: r.attempt,
    kind: r.kind as RemoteJob["kind"],
    provider: r.provider,
    remoteJobId: r.remote_job_id,
    state: r.state as RemoteJob["state"],
    submittedAt: r.submitted_at,
    lastPolledAt: r.last_polled_at,
    finishedAt: r.finished_at,
    errorCode: r.error_code,
    meta: r.meta_json ? (JSON.parse(r.meta_json) as Record<string, unknown>) : null,
  });

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
      // ON CONFLICT DO NOTHING is portable across SQLite (3.24+) and PG —
      // SQLite's INSERT OR IGNORE spelling is dialect-only.
      await exec.run("INSERT INTO idempotency_keys (user_id, key, run_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", [userId, key, runId, Date.now()]);
    },
    /**
     * Generic first-writer-wins claim over idempotency_keys, used to de-duplicate
     * inbound Stripe webhook events (M3 S6). `namespace` is a reserved value
     * (never a real userId) so webhook rows never collide with run creation.
     * Returns true exactly once — the first insert of (namespace,key); a
     * redelivered event gets false. Read with getIdempotentRun(namespace,key).
     */
    async claimIdempotencyKey(namespace: string, key: string, refId: string): Promise<boolean> {
      const res = await exec.run(
        "INSERT INTO idempotency_keys (user_id, key, run_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
        [namespace, key, refId, Date.now()],
      );
      return res.changes === 1;
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
    /**
     * Open an account on someone's behalf (POST /api/admin/users). Never goes
     * through owner bootstrap — always role='user' — and carries
     * must_change_password=1 so the one-time password has to be replaced before
     * the account can reach anything. Mirrors createDemoUser's shape.
     */
    async createProvisionedUser(id: string, email: string, passwordHash: string) {
      await exec.run(stmts.createProvisionedUser, [id, email, passwordHash]);
      return { id, email, role: "user", mustChangePassword: true };
    },
    // Demo account (design-demo-user §5.2): always a plain role='user' row with
    // is_demo=1 and an explicit expiry. Never goes through owner bootstrap.
    async createDemoUser(id: string, email: string, passwordHash: string, expiresAt: string) {
      await exec.run(stmts.createDemoUser, [id, email, passwordHash, expiresAt]);
      return { id, email, role: "user", isDemo: true, demoExpiresAt: expiresAt };
    },
    /**
     * Convert a demo account into a real one in place (design-demo-user §5.4):
     * same userId, so all its graphs/runs/artifacts are retained. Returns the
     * affected-row count — 0 means the row was not a demo account (or already
     * claimed), which the route maps to 409.
     */
    async claimDemoUser(id: string, email: string, passwordHash: string): Promise<number> {
      const res = await exec.run(stmts.claimDemoUser, [email, passwordHash, id]);
      return res.changes;
    },
    /** Demo accounts whose TTL elapsed before `nowIso` (ISO UTC), oldest first. */
    async listExpiredDemoUsers(nowIso: string): Promise<Array<UserRow>> {
      return await exec.all(stmts.listExpiredDemoUsers, [nowIso]) as Array<UserRow>;
    },
    async findUserByEmail(email: string): Promise<UserRow | undefined> {
      return await exec.get(stmts.findUserByEmail, [email]) as UserRow | undefined;
    },
    async findUserById(id: string): Promise<UserRow | undefined> {
      return await exec.get(stmts.findUserById, [id]) as UserRow | undefined;
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
    /**
     * Owner-side reset: set a one-time password AND force a change at next login
     * (scripts/reset-password.ts). Deliberately does not clear must_change_password.
     */
    async adminResetUserPassword(id: string, passwordHash: string) {
      await exec.run(stmts.adminResetUserPassword, [passwordHash, id]);
    },
    /** RBAC P3: full account list for the owner's admin panel. */
    async listUsers(): Promise<Array<UserRow>> {
      return await exec.all(stmts.listUsers, []) as Array<UserRow>;
    },
    /** RBAC P3: grant or revoke the global admin role (owner-only route). */
    async updateUserRole(id: string, role: string) {
      await exec.run(stmts.updateUserRole, [role, id]);
    },
    /**
     * Cascade-delete one EXPIRED DEMO user and every row it owns
     * (design-demo-user §5.5 / prune-demo-users). Runs as one transaction.
     * Order matters: tables reachable only via runs/graphs are deleted first
     * (their subquery needs those parent rows), then direct user_id tables,
     * then the users row itself — guarded by AND is_demo=1 so a real account
     * can never be removed by this path. Returns the deleted users count.
     */
    async deleteUserCascade(id: string): Promise<number> {
      // Short-circuit BEFORE touching any child table: only a still-demo row
      // may be cascaded. Without this, the child DELETEs would run for a real
      // account while only the final users DELETE was guarded by is_demo=1.
      const owner = await exec.get(stmts.findUserById, [id]) as UserRow | undefined;
      if (!owner || owner.is_demo !== 1) return 0;
      // Coverage lists live in module-level DEMO_CASCADE_* constants (a guard
      // test diffs them against the DDL). Indirect children resolve via
      // runs/graphs; direct ones carry a user_id column.
      const run = async (sql: string) => { await exec.run(sql, [id]); };
      await exec.run("BEGIN", []);
      try {
        for (const [table, col] of DEMO_CASCADE_INDIRECT_TABLES) {
          const parent = col === "run_id" ? "runs" : "graphs";
          await run(
            `DELETE FROM ${table} WHERE ${col} IN (SELECT id FROM ${parent} WHERE user_id = ?)`,
          );
        }
        for (const table of DEMO_CASCADE_DIRECT_TABLES) {
          await run(`DELETE FROM ${table} WHERE user_id = ?`);
        }
        const res = await exec.run(
          "DELETE FROM users WHERE id = ? AND is_demo = 1",
          [id],
        );
        await exec.run("COMMIT", []);
        return res.changes;
      } catch (err) {
        await exec.run("ROLLBACK", []);
        throw err;
      }
    },

    // ---- Monetization (design-monetization §5): subscription + usage ledger ----
    async loadSubscription(userId: string):
      Promise<ReturnType<typeof mapSubscriptionRow> | undefined> {
      const row = await exec.get(stmts.getSubscription, [userId]) as SubscriptionRow | undefined;
      return row ? mapSubscriptionRow(row) : undefined;
    },
    async listAllSubscriptions(): Promise<
      Array<{ userId: string } & ReturnType<typeof mapSubscriptionRow>>
    > {
      const rows = await exec.all(stmts.listAllSubscriptions, []) as SubscriptionRow[];
      return rows.map((r) => ({ userId: r.user_id!, ...mapSubscriptionRow(r) }));
    },
    /** M3 S6: resolve a local subscription from its Stripe customer id (webhook path). */
    async findSubscriptionByStripeCustomer(customerId: string):
      Promise<({ userId: string } & ReturnType<typeof mapSubscriptionRow>) | undefined> {
      const row = await exec.get(stmts.findSubscriptionByStripeCustomer, [customerId]) as SubscriptionRow | undefined;
      return row ? { userId: row.user_id!, ...mapSubscriptionRow(row) } : undefined;
    },
    /** M3 S6: resolve a local subscription from its Stripe subscription id (webhook path). */
    async findSubscriptionByStripeSubscription(stripeSubscriptionId: string):
      Promise<({ userId: string } & ReturnType<typeof mapSubscriptionRow>) | undefined> {
      const row = await exec.get(stmts.findSubscriptionByStripeSubscription, [stripeSubscriptionId]) as SubscriptionRow | undefined;
      return row ? { userId: row.user_id!, ...mapSubscriptionRow(row) } : undefined;
    },
    async saveSubscription(
      userId: string,
      plan: string,
      status: string,
      opts: {
        provider?: string;
        externalId?: string;
        stripeCustomerId?: string;
        stripeSubscriptionId?: string;
        stripePriceId?: string;
        periodStart?: number;
        periodEnd?: number;
      } = {},
    ) {
      const now = Date.now();
      const periodStart = opts.periodStart ?? now;
      const periodEnd = opts.periodEnd ?? now + 30 * 24 * 60 * 60 * 1000;
      await exec.run(stmts.upsertSubscription, [
        userId, plan, status,
        opts.provider ?? null, opts.externalId ?? null,
        opts.stripeCustomerId ?? null, opts.stripeSubscriptionId ?? null, opts.stripePriceId ?? null,
        periodStart, periodEnd, now, now,
      ]);
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
    /**
     * Auto-scrap halted runs that exceeded `cutoffMs` without a human decision.
     * Event-stream-consistent: appends a `run.finished(failed)` event per run
     * (replaying it yields the same terminal state), then flips the row to
     * failed while preserving `halted_node_id`/`halted_reason` for audit.
     * Returns how many runs were scrapped.
     */
    async scrapStaleHaltedRuns(userId: string, cutoffMs: number): Promise<number> {
      const stale = await exec.all(stmts.listStaleHaltedRuns, [userId, cutoffMs]) as Array<{ id: string; ended_at: number }>;
      if (stale.length === 0) return 0;
      let scrapped = 0;
      const now = Date.now();
      for (const run of stale) {
        const { seq } = await exec.get(stmts.maxSeq, [run.id]) as { seq: number };
        const event: RunEvent = {
          type: "run.finished",
          runId: run.id,
          status: "failed",
          reason: "Scrapped: halted run exceeded TTL without a human decision",
          seq: seq + 1,
          ts: now,
        };
        await exec.run(stmts.insertEvent, [run.id, event.seq, now, EVENT_SCHEMA_VERSION, event.type, JSON.stringify(event)]);
        await exec.run(stmts.scrapStaleHaltedRun, [now, run.id, userId]);
        scrapped += 1;
      }
      return scrapped;
    },
    /** Idempotent usage overwrite (backfill path); accumulateUsage is the online path. */
    async setUsage(userId: string, periodStart: number, metric: string, amount: number) {
      await exec.run(stmts.setUsage, [userId, periodStart, metric, amount, Date.now()]);
    },
    async listUsageLedger(periodStart: number): Promise<Array<{ userId: string; periodStart: number; metric: string; amount: number }>> {
      const rows = await exec.all(stmts.listUsageLedger, [periodStart]) as Array<{ user_id: string; period_start: number; metric: string; amount: number }>;
      return rows.map((r) => ({ userId: r.user_id, periodStart: r.period_start, metric: r.metric, amount: r.amount }));
    },
    // M3 billing invoices (design-monetization-m3 S1).
    async getInvoice(invoiceId: string): Promise<InvoiceRow | undefined> {
      const row = await exec.get(stmts.getInvoice, [invoiceId]) as InvoiceRow | undefined;
      return row;
    },
    async listInvoicesByUser(userId: string): Promise<InvoiceRow[]> {
      const rows = await exec.all(stmts.listInvoicesByUser, [userId]) as unknown as InvoiceRow[];
      return rows;
    },
    async findInvoiceByUserAndPeriod(userId: string, periodStart: number): Promise<InvoiceRow | undefined> {
      const row = await exec.get(stmts.findInvoiceByUserAndPeriod, [userId, periodStart]) as InvoiceRow | undefined;
      return row;
    },
    /** M3 S6: resolve a local invoice from its Stripe invoice id (invoice.paid webhook). */
    async findInvoiceByStripeInvoice(stripeInvoiceId: string): Promise<InvoiceRow | undefined> {
      const row = await exec.get(stmts.findInvoiceByStripeInvoice, [stripeInvoiceId]) as InvoiceRow | undefined;
      return row;
    },
    async insertInvoice(inv: InvoiceRow): Promise<void> {
      await exec.run(stmts.insertInvoice, [
        inv.id, inv.user_id, inv.subscription_id, inv.period_start, inv.period_end,
        inv.plan, inv.amount_usd, inv.status, inv.line_items, inv.paid_at ?? null,
        inv.paid_method ?? null, inv.stripe_invoice_id ?? null, inv.notes ?? null,
        inv.created_at, inv.updated_at,
      ]);
    },
    async updateInvoiceStatus(invoiceId: string, status: string, paidAt: number | null, paidMethod: string | null, notes: string | null): Promise<void> {
      await exec.run(stmts.updateInvoiceStatus, [status, paidAt, paidMethod, notes, Date.now(), invoiceId]);
    },
    // --- G4 long-running remote jobs (design-step-trace-and-robustness §3.5) ---
    /** Record a newly submitted provider job. Idempotent on (provider, remote_job_id):
     *  a redelivered submit is ignored. Rows with a NULL provider do not dedupe
     *  (SQLite/PG treat NULLs as distinct), which is intended. */
    async insertRemoteJob(job: NewRemoteJob): Promise<void> {
      await exec.run(stmts.insertRemoteJob, [
        job.id, job.userId, job.runId, job.graphId, job.nodeId, job.attempt,
        job.kind, job.provider, job.remoteJobId,
        job.state ?? "submitted", job.submittedAt ?? Date.now(),
        job.meta ? JSON.stringify(job.meta) : null,
      ]);
    },
    /** The still-open (submitted/running) job for a node attempt, newest first, so
     *  a resume/reattach never re-submits. Null when no open job exists. */
    async getOpenRemoteJob(runId: string, nodeId: string, attempt: number): Promise<RemoteJob | null> {
      const row = await exec.get(stmts.getOpenRemoteJob, [runId, nodeId, attempt]) as RemoteJobRow | undefined;
      return row ? mapRemoteJob(row) : null;
    },
    /** Advance state and stamp last_polled_at while polling (e.g. submitted->running). */
    async touchRemoteJob(id: string, state: RemoteJob["state"], lastPolledAt?: number): Promise<void> {
      await exec.run(stmts.touchRemoteJob, [state, lastPolledAt ?? Date.now(), id]);
    },
    /** Move a job to a terminal state (succeeded/failed/lost), stamping finished_at. */
    async finishRemoteJob(id: string, state: "succeeded" | "failed" | "lost", errorCode?: string | null): Promise<void> {
      await exec.run(stmts.finishRemoteJob, [state, Date.now(), errorCode ?? null, id]);
    },
    /** G4 admin/ops listing across users. Open jobs (submitted/running) are
     *  returned oldest-first by default so stuck in-flight renders surface
     *  first; pass openOnly:false for the most recent jobs in any state. Limit
     *  is clamped to [1,500]. Inherited unchanged by the PG driver. */
    async listRemoteJobs(
      limit: number,
      opts: { openOnly?: boolean } = {},
    ): Promise<RemoteJob[]> {
      const truncated = Number.isFinite(limit) ? Math.trunc(limit) : 100;
      const bounded = Math.min(Math.max(truncated, 1), 500);
      const rows = (await exec.all(
        opts.openOnly === false ? stmts.listAllRemoteJobs : stmts.listOpenRemoteJobs,
        [bounded],
      )) as RemoteJobRow[];
      return rows.map(mapRemoteJob);
    },
    /**
     * Count distinct given nodes that finished successfully within a run.
     * Used for video-segment metering: one successful videoGen node = one segment
     * (retries share the node id, so DISTINCT avoids counting attempts).
     */
    async countDoneNodes(runId: string, nodeIds: string[]): Promise<number> {
      if (nodeIds.length === 0) return 0;
      const placeholders = nodeIds.map(() => "?").join(",");
      const row = await exec.get(
        `SELECT COUNT(DISTINCT node_id) AS n FROM node_runs WHERE run_id = ? AND status = 'done' AND node_id IN (${placeholders})`,
        [runId, ...nodeIds],
      ) as { n: number };
      return row.n;
    },
    /** Live storage usage snapshot: total artifact bytes owned by a user. */
    async sumArtifactBytes(userId: string): Promise<number> {
      return (await exec.get(stmts.sumArtifactBytes, [userId]) as { total: number }).total;
    },
    /** Finished runs since an epoch (snapshot included for video-node detection), for backfill. */
    async listFinishedRunsSince(since: number): Promise<Array<{ id: string; userId: string; startedAt: number; snapshot: string }>> {
      const rows = await exec.all(stmts.listFinishedRunsSince, [since]) as Array<{ id: string; user_id: string; started_at: number; snapshot: string }>;
      return rows.map((r) => ({ id: r.id, userId: r.user_id, startedAt: r.started_at, snapshot: openDocString(r.snapshot) }));
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

    // --- RTS stage-B macro-park coordinates (migration 37) ----------------
    // Dual scope mirrors operationsByGraph: no graphIds → owned graphs only;
    // graphIds → the authorized (owned + shared) set. Only laid-out graphs are
    // returned; the client fills the rest with parkLayout() auto-layout.
    async getParkCoords(
      userId: string,
      graphIds?: string[],
    ): Promise<Record<string, { x: number; z: number }>> {
      const shared = !!graphIds && graphIds.length > 0;
      const rows = shared
        ? await exec.all(
            `SELECT id, park_x, park_z FROM graphs WHERE park_x IS NOT NULL AND id IN (${graphIds!.map(() => "?").join(",")})`,
            graphIds!,
          ) as Array<{ id: string; park_x: number; park_z: number }>
        : await exec.all(stmts.parkCoordsOwned, [userId]) as Array<{ id: string; park_x: number; park_z: number }>;
      const out: Record<string, { x: number; z: number }> = {};
      for (const r of rows) out[r.id] = { x: r.park_x, z: r.park_z };
      return out;
    },

    // Owner-only write (the user_id clause is the SQL backstop; routes check
    // the owner role first). Returns false when no owned row matched, so the
    // caller can map it to 404/403. Does NOT bump updated_at (B1.5).
    async setParkCoord(userId: string, graphId: string, x: number, z: number): Promise<boolean> {
      const result = await exec.run(stmts.setParkCoord, [x, z, graphId, userId]);
      return result.changes > 0;
    },

    async clearParkCoord(userId: string, graphId: string): Promise<boolean> {
      const result = await exec.run(stmts.clearParkCoord, [graphId, userId]);
      return result.changes > 0;
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
      opts: { limit?: number; offset?: number; graphId?: string; status?: string; graphIds?: string[]; q?: string } = {},
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
      // Full-text-ish filter across the run history: graph name plus the
      // per-node error/output text. ILIKE on Postgres, case-folded LIKE on
      // SQLite so the two drivers behave identically for ASCII search.
      const q = opts.q?.trim();
      if (q) {
        const like = dialect === "postgres" ? "ILIKE" : "LIKE";
        const pat = `%${q}%`;
        where.push(
          `(g.name ${like} ? OR EXISTS (SELECT 1 FROM node_runs nr WHERE nr.run_id = r.id AND (nr.error ${like} ? OR nr.output ${like} ?)))`,
        );
        params.push(pat, pat, pat);
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
        await exec.get(`SELECT COUNT(*) AS n FROM runs r LEFT JOIN graphs g ON g.id = r.graph_id ${clause}`, [...params]) as { n: number }
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
          await exec.run(stmts.finishNodeRun, ["done", event.output, event.usage.tokensIn, event.usage.tokensOut, event.usage.cachedTokens ?? 0, event.usage.reasoningTokens ?? 0, event.usage.costUsd, event.usage.units ? JSON.stringify(event.usage.units) : null, event.usage.model ?? null, runId, event.nodeId, event.attempt, event.variant ?? "main"]);
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
           ORDER BY a.created_at DESC, a.${tie} DESC LIMIT ? OFFSET ?`, [userId, ...graphIds, limit, offset]) as ArtifactRow[];
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

      // Per-model spend, the axis a built-in-model subscription has to be
      // priced against. Rows predating node_runs.model have NULL and are
      // grouped under '(未记录模型)' rather than silently dropped, so the
      // per-model figures always reconcile with the totals above.
      const byModel = await exec.all(`SELECT COALESCE(n.model, '(未记录模型)') AS model,
             COUNT(*) AS calls,
             COUNT(DISTINCT n.run_id)       AS runs,
             COALESCE(SUM(n.cost_usd), 0)   AS cost_usd,
             COALESCE(SUM(n.tokens_in), 0)  AS tokens_in,
             COALESCE(SUM(n.tokens_out), 0) AS tokens_out
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           ${clause}
           GROUP BY COALESCE(n.model, '(未记录模型)')
           ORDER BY cost_usd DESC`, [...params]) as Array<{
        model: string;
        calls: number;
        runs: number;
        cost_usd: number;
        tokens_in: number;
        tokens_out: number;
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

      // Daily bucket (same family as weekExpr/monthExpr above): SQLite's
      // date(..., 'unixepoch', 'localtime') vs PostgreSQL's to_char(to_timestamp).
      const dayExpr =
        dialect === "postgres"
          ? `to_char(to_timestamp(r.started_at / 1000.0), 'YYYY-MM-DD')`
          : `date(r.started_at / 1000, 'unixepoch', 'localtime')`;
      const byDay = await exec.all(`SELECT ${dayExpr} AS day,
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

      return { totals, byGraph, byNode: byNodeNamed, byModel, byAttempt, byDay, byWeek, byMonth };
    },

    /** Raw rows for CSV export — same aggregation as costReport, flat shape. */
    async costRows(opts: { from?: number; to?: number; userId?: string } = {}) {
      const { byGraph, byNode, byModel, byAttempt, byDay } = await this.costReport(opts);
      return { byGraph, byNode, byModel, byAttempt, byDay };
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

    /**
     * Cross-graph run rollup for the operations dashboard (RTS phase A1).
     * Every owned graph is returned (LEFT JOIN — graphs with zero runs show
     * zero counters, never dropped). Counters + cost honor the optional
     * `since` window; `last*` reflects the most recent run across all time.
     * `graphIds` scopes by graph membership (shared graphs, design-rbac)
     * instead of run/graph ownership, mirroring `listRuns`.
     */
    async operationsByGraph(
      userId: string,
      opts: { since?: number; graphIds?: string[] } = {},
    ): Promise<GraphRunSummary[]> {
      const byMembership = !!opts.graphIds && opts.graphIds.length > 0;
      const scopeIds = byMembership ? opts.graphIds! : [userId];
      const placeholders = scopeIds.map(() => "?").join(",");
      // Graph ownership / membership clause.
      const gClause = byMembership ? `g.id IN (${placeholders})` : "g.user_id = ?";
      // Runs joined per graph (LEFT JOIN ON — window/scope live in ON, never
      // in WHERE, or zero-run graphs get filtered out).
      const rOn = byMembership
        ? ["r.graph_id = g.id"]
        : ["r.graph_id = g.id", "r.user_id = ?"];
      const rParams: (string | number)[] = byMembership ? [] : [userId];
      // Cost subquery: same accounting as costForMonth (running excluded).
      const cWhere = byMembership
        ? ["r2.graph_id = g.id", "r2.status != 'running'"]
        : ["r2.graph_id = g.id", "r2.user_id = ?", "r2.status != 'running'"];
      const cParams: (string | number)[] = byMembership ? [] : [userId];
      if (opts.since !== undefined) {
        rOn.push("r.started_at >= ?");
        rParams.push(opts.since);
        cWhere.splice(cWhere.length - 1, 0, "r2.started_at >= ?");
        cParams.push(opts.since);
      }
      const rows = await exec.all(`SELECT g.id AS graph_id, g.name AS graph_name,
                  g.origin_template_id AS origin_template_id,
                  COUNT(r.id) AS total_runs,
                  SUM(CASE WHEN r.status = 'running'   THEN 1 ELSE 0 END) AS running,
                  SUM(CASE WHEN r.status = 'halted'    THEN 1 ELSE 0 END) AS halted,
                  SUM(CASE WHEN r.status = 'done'      THEN 1 ELSE 0 END) AS done,
                  SUM(CASE WHEN r.status = 'failed'    THEN 1 ELSE 0 END) AS failed,
                  SUM(CASE WHEN r.status = 'tripped'   THEN 1 ELSE 0 END) AS tripped,
                  SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
                  COALESCE((SELECT SUM(n.cost_usd) FROM node_runs n
                            JOIN runs r2 ON r2.id = n.run_id
                            WHERE ${cWhere.join(" AND ")}), 0) AS cost_usd
           FROM graphs g
           LEFT JOIN runs r ON ${rOn.join(" AND ")}
           WHERE ${gClause}
           GROUP BY g.id, g.name, g.origin_template_id
           ORDER BY MAX(r.started_at) DESC, g.name ASC`,
        [...rParams, ...cParams, ...scopeIds]) as Array<{
          graph_id: string;
          graph_name: string | null;
          origin_template_id: string | null;
          total_runs: number;
          running: number; halted: number; done: number;
          failed: number; tripped: number; cancelled: number;
          cost_usd: number;
        }>;
      // Most-recent run per graph across ALL time (window does not apply).
      const latest = await exec.all(
        byMembership
          ? `SELECT graph_id, id, status, started_at, ended_at FROM runs
             WHERE graph_id IN (${placeholders}) ORDER BY started_at DESC, id DESC LIMIT 1000`
          : `SELECT graph_id, id, status, started_at, ended_at FROM runs
             WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT 1000`,
        [...scopeIds],
      ) as Array<{
        graph_id: string; id: string; status: string;
        started_at: number; ended_at: number | null;
      }>;
      const lastByGraph = new Map<string, { id: string; status: string; started_at: number; ended_at: number | null }>();
      for (const r of latest) {
        if (!lastByGraph.has(r.graph_id)) lastByGraph.set(r.graph_id, r);
      }
      return rows.map((r) => {
        const last = lastByGraph.get(r.graph_id) ?? null;
        return {
          graphId: r.graph_id,
          graphName: r.graph_name,
          originTemplateId: r.origin_template_id,
          totalRuns: Number(r.total_runs ?? 0),
          running: Number(r.running ?? 0),
          halted: Number(r.halted ?? 0),
          done: Number(r.done ?? 0),
          failed: Number(r.failed ?? 0),
          tripped: Number(r.tripped ?? 0),
          cancelled: Number(r.cancelled ?? 0),
          lastRunId: last?.id ?? null,
          lastStatus: last?.status ?? null,
          lastStartedAt: last ? Number(last.started_at) : null,
          lastEndedAt: last ? Number(last.ended_at) : null,
          costUsd: Number(r.cost_usd ?? 0),
        };
      });
    },

    // RTS stage-C C4: account-wide monthly economy (cost + token usage), scoped
    // to owned or visible graphs. Cost accounting matches costForMonth (running
    // excluded); the caller computes monthStart/monthEnd so the boundary rule is
    // identical to costForMonth. Standard SQL — shared by the PG driver body.
    async operationsEconomy(
      userId: string,
      opts: { monthStart: number; monthEnd: number; graphIds?: string[] },
    ): Promise<OperationsEconomy> {
      const byMembership = !!opts.graphIds && opts.graphIds.length > 0;
      const scope = byMembership ? opts.graphIds! : [userId];
      const placeholders = scope.map(() => "?").join(",");
      const where = byMembership
        ? ["r.status != 'running'", "r.started_at >= ?", "r.started_at < ?", `r.graph_id IN (${placeholders})`]
        : ["r.status != 'running'", "r.started_at >= ?", "r.started_at < ?", "r.user_id = ?"];
      const row = await exec.get(`SELECT COALESCE(SUM(n.cost_usd),0) AS cost,
                  COALESCE(SUM(n.tokens_in),0) AS tokens_in,
                  COALESCE(SUM(n.tokens_out),0) AS tokens_out
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           WHERE ${where.join(" AND ")}`,
        [opts.monthStart, opts.monthEnd, ...scope]) as
        { cost: number; tokens_in: number; tokens_out: number };
      return {
        monthCostUsd: Number(row.cost ?? 0),
        tokensIn: Number(row.tokens_in ?? 0),
        tokensOut: Number(row.tokens_out ?? 0),
      };
    },

    // RTS stage-C C6: F6 effect metrics per graph (same SUM accounting as
    // aggregatePerformance grouped by graph_id). A graph with no metrics row is
    // absent from the map; the overview caller fills an all-zero GraphMetrics.
    async metricsByGraph(
      userId: string,
      graphIds?: string[],
    ): Promise<Record<string, GraphMetrics>> {
      const byMembership = !!graphIds && graphIds.length > 0;
      const scope = byMembership ? graphIds! : [userId];
      const placeholders = scope.map(() => "?").join(",");
      const where = byMembership
        ? `user_id = ? AND graph_id IN (${placeholders})`
        : "user_id = ?";
      const params = byMembership ? [userId, ...scope] : [userId];
      const rows = await exec.all(`SELECT graph_id AS graph_id,
                  SUM(impressions) AS impressions, SUM(clicks) AS clicks,
                  SUM(conversions) AS conversions, SUM(gmv) AS gmv, SUM(ad_spend) AS ad_spend
           FROM content_metrics WHERE ${where} GROUP BY graph_id`, params) as Array<Record<string, unknown>>;
      const out: Record<string, GraphMetrics> = {};
      for (const r of rows) {
        const gid = r.graph_id == null ? "" : String(r.graph_id);
        if (!gid) continue; // null-graph bucket is not tied to a factory
        out[gid] = {
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
          conversions: Number(r.conversions ?? 0),
          gmv: Number(r.gmv ?? 0),
          adSpend: Number(r.ad_spend ?? 0),
        };
      }
      return out;
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
          promptOf.set(row.id, createHash("sha256").update(sig).digest("hex").slice(0, 8));
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
             AVG(CASE WHEN r.ended_at IS NOT NULL THEN (r.ended_at - r.started_at) END) AS "avgDurationMs",
             AVG((SELECT COALESCE(AVG(score), 0) FROM node_runs nr WHERE nr.run_id = r.id)) AS "avgScore",
             AVG((SELECT COUNT(*) FROM node_runs nr WHERE nr.run_id = r.id AND nr.attempt > 1)) AS "avgRework",
             SUM((SELECT COALESCE(SUM(cost_usd), 0) FROM node_runs nr WHERE nr.run_id = r.id)) AS "totalCost"
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

      // Pick one representative run per arm (latest, prefer done) to read the
      // arm prompt and project the downstream quality-gate verdict (G5.2).
      const repOf = new Map<string, { runId: string; graph: Graph | null; prompt: string | null }>();
      const repRunIds: string[] = [];
      for (const r of rows) {
        const rep = await exec.get(
          `SELECT id, snapshot FROM runs
           WHERE ab_group = ? AND ab_arm = ? AND user_id = ? AND snapshot IS NOT NULL
           ORDER BY (status = 'done') DESC, started_at DESC LIMIT 1`,
          [groupId, r.arm, userId],
        ) as { id: string; snapshot: string } | undefined;
        let repGraph: Graph | null = null;
        let prompt: string | null = null;
        if (rep) {
          repRunIds.push(rep.id);
          try {
            const g = JSON.parse(openDocString(rep.snapshot)) as Graph;
            repGraph = g;
            const node = g.nodes?.find((n) => n.id === r.target);
            prompt = node?.textGen?.prompt ?? null;
          } catch {
            /* ignore malformed snapshot */
          }
        }
        repOf.set(r.arm, { runId: rep?.id ?? "", graph: repGraph, prompt });
      }

      // Batch-load events for every representative run in one query, then fold
      // them with buildTimeline so the gate verdict comes from the same
      // projection as the step timeline (no hand-rolled event scanning).
      const eventsByRun = new Map<string, RunEvent[]>();
      if (repRunIds.length > 0) {
        const placeholders = repRunIds.map(() => "?").join(",");
        const evRows = await exec.all(
          `SELECT run_id AS "runId", payload FROM events WHERE run_id IN (${placeholders}) ORDER BY seq`,
          repRunIds,
        ) as Array<{ runId: string; payload: string }>;
        for (const ev of evRows) {
          try {
            const parsed = JSON.parse(ev.payload) as RunEvent;
            const list = eventsByRun.get(ev.runId);
            if (list) list.push(parsed);
            else eventsByRun.set(ev.runId, [parsed]);
          } catch {
            /* skip malformed event payload */
          }
        }
      }

      const arms: ABArmReport[] = rows.map((r) => {
        const runs = Number(r.runs);
        const done = Number(r.done);
        const totalCost = Number(r.totalCost ?? 0);
        const rep = repOf.get(r.arm);
        let gate: ABArmReport["gate"] = null;
        if (rep?.graph && r.target && rep.runId) {
          try {
            gate = projectGateVerdict(
              rep.graph,
              buildTimeline(eventsByRun.get(rep.runId) ?? []),
              r.target,
            );
          } catch {
            gate = null;
          }
        }
        return {
          arm: r.arm,
          target: r.target,
          prompt: rep?.prompt ?? null,
          runs,
          done,
          passed: done,
          passRate: runs ? done / runs : 0,
          avgRework: Number(r.avgRework ?? 0),
          avgDurationMs: Math.round(Number(r.avgDurationMs ?? 0)),
          avgScore: Number(r.avgScore ?? 0),
          avgCost: runs ? totalCost / runs : 0,
          gate,
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
      return await exec.all(`SELECT id, term, note, created_at AS "createdAt" FROM brand_terms WHERE user_id = ? ORDER BY created_at ASC`, [userId]) as Array<{ id: string; term: string; note: string; createdAt: number }>;
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
    /**
     * Retention prune (design-audit-log §5): drops audit rows created before the
     * epoch-millisecond cutoff and returns how many went. Serves
     * `idx_audit_log_time`, so the scan stays bounded as the table grows.
     */
    async pruneAuditOlder(before: number): Promise<number> {
      return Number((await exec.run("DELETE FROM audit_log WHERE created_at < ?", [before])).changes);
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
      return await exec.all(`SELECT id, term, note, created_at AS "createdAt" FROM banned_terms WHERE user_id = ? ORDER BY created_at ASC`, [userId]) as Array<{ id: string; term: string; note: string; createdAt: number }>;
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
      return await exec.all(`SELECT gv.id, gv.graph_id AS "graphId", gv.name, gv.note, gv.content_hash AS "contentHash", gv.created_at AS "createdAt"
                  FROM graph_versions gv JOIN graphs g ON g.id = gv.graph_id
                  WHERE gv.graph_id = ? AND g.user_id = ? ORDER BY gv.created_at DESC, gv.${tie} DESC`, [graphId, userId]) as Array<{ id: string; graphId: string; name: string; note: string; contentHash: string; createdAt: number }>;
    },
    /**
     * Content hash of the graph as executed by the most recent run of this
     * graph (runs.snapshot stores the full graph JSON at execution time), or
     * null when the graph has never run. Lets the version panel flag which
     * snapshot matches what actually ran.
     */
    async getLatestRunContentHash(graphId: string, userId: string): Promise<string | null> {
      const row = await exec.get(`SELECT snapshot FROM runs WHERE graph_id = ? AND user_id = ? ORDER BY started_at DESC, ${tie} DESC LIMIT 1`, [graphId, userId]) as { snapshot: string } | undefined;
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
      // ${tie} DESC breaks created_at ties (same-millisecond snapshots) by
      // insertion order, keeping throttle/retention deterministic.
      const last = await exec.get(`SELECT content_hash, created_at FROM graph_versions WHERE graph_id = ? AND note = 'auto' ORDER BY created_at DESC, ${tie} DESC LIMIT 1`, [graphId]) as { content_hash: string; created_at: number } | undefined;
      if (last && Date.now() - last.created_at < minIntervalMs && last.content_hash === hash) return null;

      const id = randomUUID();
      const now = Date.now();
      await exec.run(`INSERT INTO graph_versions (id, graph_id, name, snapshot, note, content_hash, created_at) VALUES (?, ?, ?, ?, 'auto', ?, ?)`, [id, graphId, `auto-${new Date(now).toISOString().slice(0, 16).replace("T", " ")}`, sealDocString(snapshot), hash, now]);
      // Rolling retention: prune oldest auto-snapshots beyond maxKeep.
      // SQLite spells "no limit" as LIMIT -1; PostgreSQL uses LIMIT ALL.
      const stale = await exec.all(`SELECT id FROM graph_versions WHERE graph_id = ? AND note = 'auto' ORDER BY created_at DESC, ${tie} DESC LIMIT ${dialect === "postgres" ? "ALL" : "-1"} OFFSET ?`, [graphId, maxKeep]) as Array<{ id: string }>;
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
        | { id: string; graph_id: string; snapshot: string; status: string; trigger: string; input: string | null; budget_usd: number | null; started_at: number; ended_at: number | null; halted_node_id: string | null; halted_reason: string | null }
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
      // Preserve template lineage AND the owner row. The upsert's ON CONFLICT
      // branch only fires when `graphs.user_id = excluded.user_id`; passing
      // NULL as the owner makes that comparison NULL (never true), so the
      // update is silently skipped and triggers persisted through
      // saveGraphUnscoped (create/update trigger routes) never hit disk —
      // every cron/webhook trigger vanished on the next restart.
      const row = await exec.get(`SELECT origin_template_id, user_id FROM graphs WHERE id = ?`, [graph.id]) as
        | { origin_template_id: string | null; user_id: string | null }
        | undefined;
      await exec.run(stmts.insertGraph, [graph.id, row?.user_id ?? null, graph.name, doc, row?.origin_template_id ?? null, at]);
    },

    async close() {
      await hooks.close();
    },

    /** Which backend this driver is bound to ("sqlite" | "postgres") — lets
     *  startup code branch on SQLite-only capabilities (FTS5 knowledge base,
     *  legacy backfill) without instanceof tricks. */
    kind: dialect,

    /** Passthrough to the underlying DatabaseSync.prepare — for the few modules
     *  that legitimately own their tables: the knowledge-base FTS5 index
     *  (memory.ts), the key-rotation CLI, the user `database` node driver
     *  (db-drivers.ts), user SQL connectors, and the one-shot PG migration
     *  script. Any other module must go through a db.ts method — the allow-list
     *  is pinned by db-driver-switch.test.ts. */
    async prepare(sql: string) {
      return hooks.prepare(sql);
    },
  };
}

/**
 * Cascade-delete coverage for an expired demo user (design-demo-user §5.5).
 * Exported so a guard test can diff these lists against every table in DDL:
 * a future table that carries user ownership MUST land here or the test goes
 * red. `announcements` (global) and the bookkeeping tables are intentionally
 * absent and are allow-listed in that test.
 */

