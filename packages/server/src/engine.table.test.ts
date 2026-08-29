import { compile, replay, type Graph, type TableConfig } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function graph(table: TableConfig, code: string): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      {
        id: "code",
        kind: "code",
        name: "CODE",
        x: 1,
        y: 0,
        code: { language: "javascript", code, timeoutMs: 5000 },
      },
      { id: "table", kind: "table", name: "TABLE", x: 2, y: 0, table },
      { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "code", kind: "flow" },
      { id: "e2", from: "code", to: "table", kind: "flow" },
      { id: "e3", from: "table", to: "sink", kind: "flow" },
    ],
  };
}

async function collect(g: Graph, input?: string) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    now: () => 0,
    input,
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

function textOf(events: any[], nodeId: string): string | undefined {
  return events.find(
    (e) => e.type === "artifact.produced" && e.nodeId === nodeId && e.artifact.kind === "text",
  )?.artifact.content;
}

const CSV = 'console.log("name,age,city\\nAlice,30,Shanghai\\nBob,25,Beijing\\nCarol,35,Shanghai")';

describe("table node", () => {
  it("parses upstream CSV text, filters, and sorts to a json artifact", async () => {
    const events = await collect(
      graph(
        {
          steps: [
            { op: "parse", format: "csv", hasHeader: true, delimiter: "," },
            { op: "filter", column: "age", operator: "gte", value: "28" },
            { op: "sort", column: "age", direction: "desc" },
          ],
        },
        CSV,
      ),
    );
    expect(replay(events).status, JSON.stringify(events.map((e) => ({ t: e.type, n: e.nodeId, err: e.error, code: e.errorCode })))).toBe("done");
    const parsed = JSON.parse(jsonOf(events, "table")!);
    expect(parsed.rows.map((r: any) => r.name)).toEqual(["Carol", "Alice"]);
    expect(parsed.count).toBe(2);
    expect(parsed.columns).toEqual(["name", "age", "city"]);
  });

  it("accepts a JSON rows array from upstream without a parse step", async () => {
    const events = await collect(
      graph(
        { steps: [{ op: "sort", column: "a", direction: "asc" }] },
        'console.log(JSON.stringify([{ a: 2 }, { a: 1 }, { a: 3 }]))',
      ),
    );
    expect(replay(events).status).toBe("done");
    const parsed = JSON.parse(jsonOf(events, "table")!);
    expect(parsed.rows.map((r: any) => r.a)).toEqual([1, 2, 3]);
  });

  it("accepts a { rows } wrapper object", async () => {
    const events = await collect(
      graph(
        { steps: [{ op: "aggregate", groupBy: "city", aggs: [{ column: "name", fn: "count", as: "n" }] }] },
        'console.log(JSON.stringify({ rows: [{ city: "A", name: "x" }, { city: "A", name: "y" }, { city: "B", name: "z" }] }))',
      ),
    );
    expect(replay(events).status).toBe("done");
    const parsed = JSON.parse(jsonOf(events, "table")!);
    expect(parsed.rows).toEqual([
      { city: "A", n: 2 },
      { city: "B", n: 1 },
    ]);
  });

  it("emits an extra CSV text artifact when the output step is csv", async () => {
    const events = await collect(
      graph(
        {
          steps: [
            { op: "parse", format: "csv", hasHeader: true, delimiter: "," },
            { op: "output", format: "csv" },
          ],
        },
        CSV,
      ),
    );
    expect(replay(events).status).toBe("done");
    const json = JSON.parse(jsonOf(events, "table")!);
    expect(json.rows).toHaveLength(3);
    const csv = textOf(events, "table")!;
    expect(csv.split("\n")[0]).toBe("name,age,city");
    expect(csv.split("\n")).toHaveLength(4);
  });

  it("fails with VALIDATION when the upstream value is not table-like", async () => {
    const events = await collect(
      graph({ steps: [] }, "console.log(JSON.stringify({ ok: 42 }))"),
    );
    expect(replay(events).status).toBe("failed");
    expect(
      events.some(
        (e) => e.type === "node.failed" && e.nodeId === "table" && e.errorCode === "VALIDATION",
      ),
    ).toBe(true);
  });

  it("fails when parse has no text input", async () => {
    const events = await collect(
      graph(
        { steps: [{ op: "parse", format: "csv", hasHeader: true, delimiter: "," }] },
        'console.log(JSON.stringify([{ a: 1 }]))',
      ),
    );
    expect(replay(events).status).toBe("failed");
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "table")).toBe(true);
  });

  it("fails with VALIDATION when there is no single flow predecessor", async () => {
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        { id: "table", kind: "table", name: "TABLE", x: 1, y: 0, table: { steps: [] } },
        { id: "sink", kind: "sink", name: "SINK", x: 2, y: 0 },
      ],
      edges: [{ id: "e1", from: "table", to: "sink", kind: "flow" }],
    };
    const events = await collect(g);
    expect(replay(events).status).toBe("failed");
    expect(
      events.some(
        (e) => e.type === "node.failed" && e.nodeId === "table" && e.errorCode === "VALIDATION",
      ),
    ).toBe(true);
  });
});
