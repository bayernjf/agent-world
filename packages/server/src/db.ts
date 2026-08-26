import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { EVENT_SCHEMA_VERSION, type Graph, type RunEvent } from "@agent-world/core";
import type { StoredArtifact } from "./artifact-store.js";

/**
 * Events are the source of truth and append-only, so they get a plain prepared
 * insert rather than an ORM round trip. `(run_id, seq)` is the primary key, and
 * node runs are keyed by `(run_id, node_id, attempt)` — attempt is identity.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS graphs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  doc        TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id         TEXT PRIMARY KEY,
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
  ab_target  TEXT
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
  node_id     TEXT NOT NULL,
  attempt     INTEGER,
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

CREATE TABLE IF NOT EXISTS node_runs (
  run_id         TEXT NOT NULL,
  node_id        TEXT NOT NULL,
  attempt        INTEGER NOT NULL,
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
  PRIMARY KEY (run_id, node_id, attempt)
);

CREATE TABLE IF NOT EXISTS brand_terms (
  id          TEXT PRIMARY KEY,
  term        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
`;

type ArtifactRow = {
  id: string;
  run_id: string;
  node_id: string;
  attempt: number | null;
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
    insertGraph: db.prepare(
      `INSERT INTO graphs (id, name, doc, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, doc = excluded.doc, version = version + 1, updated_at = excluded.updated_at`,
    ),
    // Conditional update: only succeeds when the row's current version matches
    // the If-Match value, so a stale tab can't silently clobber a newer save.
    updateGraphIfVersion: db.prepare(
      `UPDATE graphs SET name = ?, doc = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ?`,
    ),
    getGraphVersion: db.prepare(`SELECT version FROM graphs WHERE id = ?`),
    getGraph: db.prepare(`SELECT doc, version FROM graphs WHERE id = ?`),
    listGraphs: db.prepare(`SELECT id, name, version, updated_at FROM graphs ORDER BY updated_at DESC`),
    deleteGraph: db.prepare(`DELETE FROM graphs WHERE id = ?`),
    createRun: db.prepare(
      `INSERT INTO runs (id, graph_id, snapshot, status, trigger, input, budget_usd, started_at, ab_group, ab_arm, ab_target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    finishRun: db.prepare(`UPDATE runs SET status = ?, ended_at = ? WHERE id = ?`),
    markRunning: db.prepare(`UPDATE runs SET status = 'running', ended_at = NULL WHERE id = ?`),
    getRun: db.prepare(`SELECT * FROM runs WHERE id = ?`),
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
      `INSERT INTO node_runs (run_id, node_id, attempt, status) VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id, node_id, attempt) DO UPDATE SET status = excluded.status`,
    ),
    appendReasoning: db.prepare(
      `UPDATE node_runs SET reasoning = COALESCE(reasoning, '') || ? WHERE run_id = ? AND node_id = ? AND attempt = ?`,
    ),
    finishNodeRun: db.prepare(
      `UPDATE node_runs SET status = ?, output = ?, tokens_in = ?, tokens_out = ?,
        cached_tokens = ?, reasoning_tokens = ?, cost_usd = ?, units_json = ?
       WHERE run_id = ? AND node_id = ? AND attempt = ?`,
    ),
    failNodeRun: db.prepare(
      `UPDATE node_runs SET status = 'failed', error = ?, error_code = ? WHERE run_id = ? AND node_id = ? AND attempt = ?`,
    ),
    setNodeScore: db.prepare(
      `UPDATE node_runs SET score = ? WHERE run_id = ? AND node_id = ? AND attempt = ?`,
    ),
    markInterrupted: db.prepare(
      `UPDATE runs SET status = 'interrupted', ended_at = ? WHERE status = 'running'`,
    ),
    /** Snapshots needed to group runs by prompt version (eval report). */
    evalSnapshots: db.prepare(
      `SELECT id, graph_id, snapshot FROM runs WHERE status != 'running' ORDER BY started_at DESC LIMIT 1000`,
    ),
        deleteRun: db.prepare(`DELETE FROM runs WHERE id = ?`),
    deleteEvents: db.prepare(`DELETE FROM events WHERE run_id = ?`),
    deleteNodeRuns: db.prepare(`DELETE FROM node_runs WHERE run_id = ?`),
    insertArtifact: db.prepare(
      `INSERT INTO artifacts (id, run_id, node_id, attempt, kind, mime_type, label, size_bytes, storage, uri, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ),
    listArtifactsByRun: db.prepare(
      `SELECT id, run_id, node_id, attempt, kind, mime_type, label, size_bytes, storage, uri, created_at
       FROM artifacts WHERE run_id = ? ORDER BY created_at`,
    ),
    getArtifact: db.prepare(
      `SELECT id, run_id, node_id, attempt, kind, mime_type, label, size_bytes, storage, uri, created_at
       FROM artifacts WHERE id = ?`,
    ),
    listArtifacts: db.prepare(
      `SELECT id, run_id, node_id, attempt, kind, mime_type, label, size_bytes, storage, uri, created_at
       FROM artifacts ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    ),
    deleteArtifactsForRun: db.prepare(`DELETE FROM artifacts WHERE run_id = ?`),
  };

  return {
    /**
     * Persist a graph. When `expectedVersion` is given the update is
     * conditional: it returns { ok:false, conflict:true } if the stored version
     * no longer matches (another tab saved first), instead of overwriting.
     * On success returns the new version.
     */
    saveGraph(
      graph: Graph,
      at: number,
      expectedVersion?: number,
    ): { ok: true; version: number } | { ok: false; conflict: true; serverVersion: number | null } {
      const doc = JSON.stringify(graph);
      if (expectedVersion != null) {
        const result = stmts.updateGraphIfVersion.run(
          graph.name,
          doc,
          at,
          graph.id,
          expectedVersion,
        );
        if (result.changes === 0) {
          const row = stmts.getGraphVersion.get(graph.id) as { version: number } | undefined;
          return { ok: false, conflict: true, serverVersion: row?.version ?? null };
        }
        return { ok: true, version: expectedVersion + 1 };
      }
      stmts.insertGraph.run(graph.id, graph.name, doc, at);
      const row = stmts.getGraphVersion.get(graph.id) as { version: number };
      return { ok: true, version: row.version };
    },

    getGraph(id: string): (Graph & { version: number }) | null {
      const row = stmts.getGraph.get(id) as { doc: string; version: number } | undefined;
      return row ? { ...(JSON.parse(row.doc) as Graph), version: row.version } : null;
    },

    listGraphs() {
      return stmts.listGraphs.all() as Array<{
        id: string;
        name: string;
        version: number;
        updated_at: number;
      }>;
    },

    deleteGraph(id: string) {
      stmts.deleteGraph.run(id);
    },

    createRun(args: {
      id: string;
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
        args.graph.id,
        JSON.stringify(args.graph),
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

    finishRun(runId: string, status: string, at: number) {
      stmts.finishRun.run(status, at, runId);
    },

    markRunning(runId: string) {
      stmts.markRunning.run(runId);
    },

    runExists(runId: string): boolean {
      return stmts.getRun.get(runId) !== undefined;
    },

    getRun(runId: string) {
      return stmts.getRun.get(runId) as
        | { id: string; graph_id: string; snapshot: string; status: string; budget_usd: number | null; started_at: number; ended_at: number | null }
        | undefined;
    },

    listRuns(limit = 50, offset = 0) {
      return stmts.listRuns.all(limit, offset) as Array<{
        id: string;
        graph_id: string;
        graph_name: string;
        status: string;
        trigger: string;
        budget_usd: number | null;
        started_at: number;
        ended_at: number | null;
      }>;
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
          stmts.upsertNodeRun.run(runId, event.nodeId, event.attempt, "running");
          break;
        case "node.reasoning":
          // Ensure the row exists then append.
          stmts.upsertNodeRun.run(runId, event.nodeId, event.attempt, "running");
          stmts.appendReasoning.run(event.text, runId, event.nodeId, event.attempt);
          break;
        case "node.finished":
          stmts.upsertNodeRun.run(runId, event.nodeId, event.attempt, "done");
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
          );
          break;
        case "node.failed":
          stmts.upsertNodeRun.run(runId, event.nodeId, event.attempt, "failed");
          stmts.failNodeRun.run(
            event.error,
            event.errorCode ?? null,
            runId,
            event.nodeId,
            event.attempt,
          );
          break;
        case "gate.verdict":
          // Persist the judge's quality score so the eval report can aggregate
          // it per prompt version (the "evaluation linkage").
          if (typeof event.score === "number") {
            stmts.setNodeScore.run(event.score, runId, event.nodeId, event.attempt);
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

    insertArtifact(a: StoredArtifact) {
      stmts.insertArtifact.run(
        a.id, a.runId, a.nodeId, a.attempt, a.kind, a.mimeType, a.label,
        a.sizeBytes, a.storage, a.uri, a.createdAt,
      );
    },

    listArtifactsForRun(runId: string): StoredArtifact[] {
      return mapArtifacts(stmts.listArtifactsByRun.all(runId) as ArtifactRow[]);
    },

    getArtifact(id: string): StoredArtifact | null {
      const row = stmts.getArtifact.get(id) as ArtifactRow | undefined;
      return row ? mapArtifact(row) : null;
    },

    listArtifacts(limit = 100, offset = 0): StoredArtifact[] {
      return mapArtifacts(stmts.listArtifacts.all(limit, offset) as ArtifactRow[]);
    },

    deleteRun(runId: string) {
      stmts.deleteArtifactsForRun.run(runId);
      stmts.deleteEvents.run(runId);
      stmts.deleteNodeRuns.run(runId);
      stmts.deleteRun.run(runId);
    },

    /**
     * Aggregate cost/token usage over completed (non-running) node attempts.
     * `from`/`to` are epoch milliseconds filtering by run start time.
     */
    costReport(opts: { from?: number; to?: number } = {}) {
      const where: string[] = ["r.status != 'running'"];
      const params: number[] = [];
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
          const g = JSON.parse(row.snapshot) as { nodes?: Array<{ id: string; name: string }> };
          for (const n of g.nodes ?? []) nodeNames.set(`${row.graph_id}:${n.id}`, n.name);
        } catch {
          // malformed snapshot — fall back to node_id
        }
      }
      const byNodeNamed = byNode.map((n) => ({
        ...n,
        node_name: nodeNames.get(`${n.graph_id}:${n.node_id}`) ?? n.node_id,
      }));

      return { totals, byGraph, byNode: byNodeNamed, byAttempt, byDay };
    },

    /** Raw rows for CSV export — same aggregation as costReport, flat shape. */
    costRows(opts: { from?: number; to?: number } = {}) {
      const { byGraph, byNode, byAttempt, byDay } = this.costReport(opts);
      return { byGraph, byNode, byAttempt, byDay };
    },

    /**
     * Total cost accrued across finished runs that started within the given
     * calendar month (local time). Used to evaluate the monthly budget guard.
     */
    costForMonth(year: number, month: number): number {
      // Build the [start, end) millisecond window for the month in local time.
      const start = new Date(year, month - 1, 1).getTime();
      const end = new Date(year, month, 1).getTime();
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(n.cost_usd), 0) AS cost
           FROM node_runs n JOIN runs r ON r.id = n.run_id
           WHERE r.status != 'running' AND r.started_at >= ? AND r.started_at < ?`,
        )
        .get(start, end) as { cost: number };
      return row.cost;
    },

    evalReport(opts: { graphId?: string; from?: number; to?: number } = {}) {
      const where: string[] = ["r.status != 'running'"];
      const params: (string | number)[] = [];
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
        (stmts.listGraphs.all() as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]),
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
      const snapshotRows = stmts.evalSnapshots.all() as Array<{
        id: string;
        graph_id: string;
        snapshot: string;
      }>;
      const inScope = new Set(runRows.map((r) => r.id));
      const promptOf = new Map<string, string>();
      for (const row of snapshotRows) {
        if (!inScope.has(row.id)) continue;
        try {
          const g = JSON.parse(row.snapshot) as {
            nodes?: Array<{ kind?: string; agent?: { model?: string; prompt?: string } }>;
          };
          const sig = (g.nodes ?? [])
            .filter((n) => n.kind === "agent")
            .map((n) => `${n.agent?.model ?? ""}\0${n.agent?.prompt ?? ""}`)
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

    abReport(groupId: string): ABReport | null {
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
           WHERE r.ab_group = ?
           GROUP BY r.ab_arm, r.ab_target
           ORDER BY r.ab_arm`,
        )
        .all(groupId) as Array<{
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
            `SELECT snapshot FROM runs WHERE ab_group = ? AND ab_arm = ? AND snapshot IS NOT NULL LIMIT 1`,
          )
          .get(groupId, r.arm) as { snapshot: string } | undefined;
        let prompt: string | null = null;
        if (snap) {
          try {
            const g = JSON.parse(snap.snapshot) as {
              nodes?: Array<{ id: string; agent?: { prompt?: string } }>;
            };
            const node = (g.nodes ?? []).find((n) => n.id === r.target);
            prompt = node?.agent?.prompt ?? null;
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

    listBrandTerms() {
      return db
        .prepare(
          `SELECT id, term, note, created_at AS createdAt FROM brand_terms ORDER BY created_at ASC`,
        )
        .all() as Array<{ id: string; term: string; note: string; createdAt: number }>;
    },
    addBrandTerm(term: string, note = "") {
      const t = term.trim();
      if (!t) throw new Error("品牌词不能为空");
      const id = randomUUID();
      const now = Date.now();
      db.prepare(`INSERT INTO brand_terms (id, term, note, created_at) VALUES (?, ?, ?, ?)`).run(
        id,
        t,
        note,
        now,
      );
      return { id, term: t, note, createdAt: now };
    },
    deleteBrandTerm(id: string) {
      db.prepare(`DELETE FROM brand_terms WHERE id = ?`).run(id);
    },

    close() {
      db.close();
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
        kind TEXT NOT NULL, mime_type TEXT, label TEXT, size_bytes INTEGER NOT NULL DEFAULT 0,
        storage TEXT NOT NULL, uri TEXT, created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_artifacts_node ON artifacts(run_id, node_id);`),
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
  try {
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      if (baselining && m.detect?.(db)) {
        record.run(m.version, now);
        continue;
      }
      m.up(db);
      record.run(m.version, now);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

}

/** The schema version this build expects. Exposed for diagnostics/backups. */
export const SCHEMA_VERSION = LATEST_VERSION;
