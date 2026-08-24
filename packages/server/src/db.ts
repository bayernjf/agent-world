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
  id       TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  status   TEXT NOT NULL,
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
  run_id     TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  attempt    INTEGER NOT NULL,
  status     TEXT NOT NULL,
  output     TEXT,
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd   REAL NOT NULL DEFAULT 0,
  error      TEXT,
  PRIMARY KEY (run_id, node_id, attempt)
);
`;

export type Db = ReturnType<typeof openDb>;

export function openDb(file: string) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(DDL);

  const stmts = {
    saveGraph: db.prepare(
      `INSERT INTO graphs (id, name, doc, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, doc = excluded.doc, updated_at = excluded.updated_at`,
    ),
    getGraph: db.prepare(`SELECT doc FROM graphs WHERE id = ?`),
    listGraphs: db.prepare(`SELECT id, name, updated_at FROM graphs ORDER BY updated_at DESC`),
    createRun: db.prepare(
      `INSERT INTO runs (id, graph_id, snapshot, status, budget_usd, started_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    finishRun: db.prepare(`UPDATE runs SET status = ?, ended_at = ? WHERE id = ?`),
    getRun: db.prepare(`SELECT * FROM runs WHERE id = ?`),
    insertEvent: db.prepare(
      `INSERT INTO events (run_id, seq, ts, version, type, payload) VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    listEvents: db.prepare(`SELECT payload FROM events WHERE run_id = ? ORDER BY seq`),
    upsertNodeRun: db.prepare(
      `INSERT INTO node_runs (run_id, node_id, attempt, status) VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id, node_id, attempt) DO UPDATE SET status = excluded.status`,
    ),
    finishNodeRun: db.prepare(
      `UPDATE node_runs SET status = ?, output = ?, tokens_in = ?, tokens_out = ?, cost_usd = ?
       WHERE run_id = ? AND node_id = ? AND attempt = ?`,
    ),
    failNodeRun: db.prepare(
      `UPDATE node_runs SET status = 'failed', error = ? WHERE run_id = ? AND node_id = ? AND attempt = ?`,
    ),
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

    createRun(args: { id: string; graph: Graph; budgetUsd: number | null; at: number }) {
      stmts.createRun.run(
        args.id,
        args.graph.id,
        JSON.stringify(args.graph),
        "running",
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
        case "node.finished":
          stmts.upsertNodeRun.run(runId, event.nodeId, event.attempt, "done");
          stmts.finishNodeRun.run(
            "done",
            event.output,
            event.usage.tokensIn,
            event.usage.tokensOut,
            event.usage.costUsd,
            runId,
            event.nodeId,
            event.attempt,
          );
          break;
        case "node.failed":
          stmts.upsertNodeRun.run(runId, event.nodeId, event.attempt, "failed");
          stmts.failNodeRun.run(event.error, runId, event.nodeId, event.attempt);
          break;
      }
    },

    events(runId: string): RunEvent[] {
      const rows = stmts.listEvents.all(runId) as { payload: string }[];
      return rows.map((r) => JSON.parse(r.payload) as RunEvent);
    },
  };
}
