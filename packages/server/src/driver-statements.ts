/** SQL statement catalog shared by the SQLite and PostgreSQL driver bodies
 * (audit P2 follow-up split out of driver-body.ts). The two dialect-specific
 * expressions bucket epoch-ms timestamps differently, and PostgreSQL needs
 * ctid where SQLite uses rowid as the deterministic same-millisecond tie-break
 * (design-postgres-migration.md §4 row 3). Keeping them next to the statements
 * they feed means driver-body.ts only composes behaviour.
 *
 * `sqlDialectExpressions` is exported separately because a few driver-body
 * methods build statements inline and still need the same fragments. */
export function sqlDialectExpressions(dialect: "sqlite" | "postgres") {
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
  return { weekExpr, monthExpr, tie };
}

export function createStatements(dialect: "sqlite" | "postgres") {
  const { tie } = sqlDialectExpressions(dialect);
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
    findUserByEmail: `SELECT id, email, role, is_demo, demo_expires_at, must_change_password, session_version, created_at FROM users WHERE email = ?`,
    findUserById: `SELECT id, email, role, is_demo, demo_expires_at, must_change_password, session_version, created_at FROM users WHERE id = ?`,
    findUserPasswordHash: `SELECT password_hash FROM users WHERE id = ?`,
    // Session revocation (review 2026-11-02 P3-6): every JWT carries the
    // account's session_version. Bumping it invalidates all previously issued
    // tokens; the next SELECT lets the caller re-sign the current session.
    bumpSessionVersion: `UPDATE users SET session_version = session_version + 1 WHERE id = ?`,
    getSessionVersion: `SELECT session_version FROM users WHERE id = ?`,
    // RBAC P3 (design-rbac.md): full account list for the owner's admin panel.
    // Same ordering as the v31 owner bootstrap — the owner always sorts first.
    listUsers: `SELECT id, email, role, is_demo, demo_expires_at, must_change_password, session_version, created_at FROM users ORDER BY created_at ASC, ${tie} ASC`,
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
  return stmts;
}
