import { DatabaseSync } from "node:sqlite";
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

export function openDb(file: string) {
  const db = new DatabaseSync(file);
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
  };
}

/**
 * Additive migrations for databases created before a column existed. Wrapped in
 * try/catch because SQLite has no ADD COLUMN IF EXISTS before 3.35.
 */
function runMigrations(db: DatabaseSync) {
  const addColumn = (table: string, column: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
    } catch {
      // column already exists
    }
  };
  addColumn("runs", "trigger TEXT NOT NULL DEFAULT 'manual'");
  addColumn("runs", "input TEXT");
  addColumn("node_runs", "reasoning TEXT");
  addColumn("node_runs", "error_code TEXT");
  addColumn("node_runs", "cached_tokens INTEGER NOT NULL DEFAULT 0");
  addColumn("node_runs", "reasoning_tokens INTEGER NOT NULL DEFAULT 0");
  addColumn("node_runs", "units_json TEXT");
}
