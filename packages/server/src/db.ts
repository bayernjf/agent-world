import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { EVENT_SCHEMA_VERSION, type Graph, type RunEvent } from "@agent-world/core";

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
  ended_at   INTEGER
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
  PRIMARY KEY (run_id, node_id, attempt)
);
`;

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
    saveGraph: db.prepare(
      `INSERT INTO graphs (id, name, doc, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, doc = excluded.doc, updated_at = excluded.updated_at`,
    ),
    getGraph: db.prepare(`SELECT doc FROM graphs WHERE id = ?`),
    listGraphs: db.prepare(`SELECT id, name, updated_at FROM graphs ORDER BY updated_at DESC`),
    deleteGraph: db.prepare(`DELETE FROM graphs WHERE id = ?`),
    createRun: db.prepare(
      `INSERT INTO runs (id, graph_id, snapshot, status, trigger, input, budget_usd, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
    markInterrupted: db.prepare(
      `UPDATE runs SET status = 'interrupted', ended_at = ? WHERE status = 'running'`,
    ),
    deleteRun: db.prepare(`DELETE FROM runs WHERE id = ?`),
    deleteEvents: db.prepare(`DELETE FROM events WHERE run_id = ?`),
    deleteNodeRuns: db.prepare(`DELETE FROM node_runs WHERE run_id = ?`),
  };

  return {
    saveGraph(graph: Graph, at: number) {
      stmts.saveGraph.run(graph.id, graph.name, JSON.stringify(graph), at);
    },

    getGraph(id: string): Graph | null {
      const row = stmts.getGraph.get(id) as { doc: string } | undefined;
      return row ? (JSON.parse(row.doc) as Graph) : null;
    },

    listGraphs() {
      return stmts.listGraphs.all() as { id: string; name: string; updated_at: number }[];
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

    deleteRun(runId: string) {
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
