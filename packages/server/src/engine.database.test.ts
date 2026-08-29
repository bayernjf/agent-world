import { compile, replay, type DatabaseConfig, type Graph, type TableConfig } from "@agent-world/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function dbGraph(db: DatabaseConfig): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "db", kind: "database", name: "DB", x: 1, y: 0, database: db },
      { id: "sink", kind: "sink", name: "SINK", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "db", kind: "flow" },
      { id: "e2", from: "db", to: "sink", kind: "flow" },
    ],
  };
}

function dbTableGraph(db: DatabaseConfig, table: TableConfig): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "db", kind: "database", name: "DB", x: 1, y: 0, database: db },
      { id: "table", kind: "table", name: "TABLE", x: 2, y: 0, table },
      { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "db", kind: "flow" },
      { id: "e2", from: "db", to: "table", kind: "flow" },
      { id: "e3", from: "table", to: "sink", kind: "flow" },
    ],
  };
}

async function collect(g: Graph) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    now: () => 0,
  })) {
    events.push(e);
  }
  return events;
}

function jsonOf(events: any[], nodeId: string): string | undefined {
  return events.find(
    (e) => e.type === "artifact.produced" && e.nodeId === nodeId && e.artifact.kind === "json",
  )?.artifact.content;
}

const SETUP = "CREATE TABLE people (name TEXT, age INTEGER, city TEXT);" +
  "INSERT INTO people (name, age, city) VALUES ('Alice', 30, 'Shanghai'), ('Bob', 25, 'Beijing'), ('Carol', 35, 'Shanghai');";

describe("database node", () => {
  it("runs setupSql then sql against an in-memory db and emits rows", async () => {
    const events = await collect(
      dbGraph({ setupSql: SETUP, sql: "SELECT * FROM people WHERE age >= 30" }),
    );
    expect(replay(events).status, JSON.stringify(events.map((e) => ({ t: e.type, n: e.nodeId, err: e.error, code: e.errorCode })))).toBe("done");
    const parsed = JSON.parse(jsonOf(events, "db")!);
    expect(parsed.rows).toEqual([
      { name: "Alice", age: 30, city: "Shanghai" },
      { name: "Carol", age: 35, city: "Shanghai" },
    ]);
    expect(parsed.count).toBe(2);
    expect(parsed.columns).toEqual(["name", "age", "city"]);
  });

  it("returns affected rows and last insert id for DML", async () => {
    const events = await collect(
      dbGraph({
        setupSql: SETUP,
        sql: "INSERT INTO people (name, age, city) VALUES ('Dave', 40, 'Shenzhen')",
      }),
    );
    expect(replay(events).status).toBe("done");
    const parsed = JSON.parse(jsonOf(events, "db")!);
    expect(parsed.affectedRows).toBe(1);
    expect(parsed.lastInsertId).toBe(4);
  });

  it("returns affected rows for UPDATE", async () => {
    const events = await collect(
      dbGraph({ setupSql: SETUP, sql: "UPDATE people SET age = age + 1 WHERE city = 'Shanghai'" }),
    );
    expect(replay(events).status).toBe("done");
    const parsed = JSON.parse(jsonOf(events, "db")!);
    expect(parsed.affectedRows).toBe(2);
  });

  it("binds positional parameters", async () => {
    const events = await collect(
      dbGraph({ setupSql: SETUP, sql: "SELECT name FROM people WHERE age > ?", positionalParams: [28] }),
    );
    expect(replay(events).status).toBe("done");
    const parsed = JSON.parse(jsonOf(events, "db")!);
    expect(parsed.rows.map((r: any) => r.name)).toEqual(["Alice", "Carol"]);
  });

  it("binds named parameters", async () => {
    const events = await collect(
      dbGraph({
        setupSql: SETUP,
        sql: "SELECT name FROM people WHERE city = :city AND age >= :min",
        namedParams: { city: "Shanghai", min: 32 },
      }),
    );
    expect(replay(events).status).toBe("done");
    const parsed = JSON.parse(jsonOf(events, "db")!);
    expect(parsed.rows.map((r: any) => r.name)).toEqual(["Carol"]);
  });

  it("queries a file-backed database when path is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-db-"));
    const path = join(dir, "test.db");
    try {
      // Seed the file once with a separate driver, then query through the node.
      const { createSqliteDriver } = await import("./db-drivers.js");
      const seed = createSqliteDriver(path);
      seed.setup("CREATE TABLE t (x INTEGER); INSERT INTO t (x) VALUES (1), (2);");
      seed.close();
      const events = await collect(dbGraph({ path, sql: "SELECT x FROM t ORDER BY x DESC" }));
      expect(replay(events).status).toBe("done");
      const parsed = JSON.parse(jsonOf(events, "db")!);
      expect(parsed.rows.map((r: any) => r.x)).toEqual([2, 1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails with VALIDATION when sql is empty", async () => {
    const events = await collect(dbGraph({ setupSql: SETUP }));
    expect(replay(events).status).toBe("failed");
    expect(
      events.some(
        (e) => e.type === "node.failed" && e.nodeId === "db" && e.errorCode === "VALIDATION",
      ),
    ).toBe(true);
  });

  it("fails when sql has a syntax error", async () => {
    const events = await collect(dbGraph({ setupSql: SETUP, sql: "SELEC * FROM people" }));
    expect(replay(events).status).toBe("failed");
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "db")).toBe(true);
  });

  it("feeds query rows into a downstream table node for further processing", async () => {
    const events = await collect(
      dbTableGraph(
        { setupSql: SETUP, sql: "SELECT * FROM people" },
        { steps: [{ op: "sort", column: "age", direction: "desc" }, { op: "filter", column: "city", operator: "eq", value: "Shanghai" }] },
      ),
    );
    expect(replay(events).status).toBe("done");
    const parsed = JSON.parse(jsonOf(events, "table")!);
    expect(parsed.rows.map((r: any) => r.name)).toEqual(["Carol", "Alice"]);
    expect(parsed.count).toBe(2);
  });
});
