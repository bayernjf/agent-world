import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import type { Graph } from "@agent-world/core";

const U = "u1";

function emptyGraph(id: string, name: string): Graph {
  return { id, name, nodes: [], edges: [] };
}

describe("operations cross-graph rollup (RTS phase A1)", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "aw-ops-"));
    db = openDb(join(dir, "test.sqlite"));
    await db.saveGraph(emptyGraph("a", "Alpha"), 1, U);
    await db.saveGraph(emptyGraph("b", "Beta"), 1, U);
    await db.saveGraph(emptyGraph("c", "Gamma"), 1, U);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Create a run, optionally record one finished node with a cost, finish it. */
  async function makeRun(
    id: string,
    graphId: string,
    graphName: string,
    status: "done" | "failed" | "tripped" | "cancelled" | "halted" | "running",
    at: number,
    cost?: number,
  ) {
    await db.createRun({ id, userId: U, graph: emptyGraph(graphId, graphName), budgetUsd: null, at, trigger: "cron" });
    if (cost !== undefined) {
      await db.record(id, { seq: 1, ts: at + 1, type: "node.finished", nodeId: "n1", attempt: 1, output: "o", usage: { tokensIn: 10, tokensOut: 5, costUsd: cost } } as never);
    }
    if (status !== "running") {
      await db.finishRun(id, U, status, at + 10, status === "halted" ? { nodeId: "n1", reason: "review" } : undefined);
    }
  }

  it("rolls up per-graph counters and node-level cost, newest activity first", async () => {
    await makeRun("r1", "a", "Alpha", "done", 1000, 0.01);
    await makeRun("r2", "a", "Alpha", "failed", 2000, 0.02);
    await makeRun("r3", "b", "Beta", "halted", 3000, 0.005);

    const rows = await db.operationsByGraph(U);
    // b (last activity 3000) > a (2000) > c (never run, nulls sort last)
    expect(rows.map((r) => r.graphId)).toEqual(["b", "a", "c"]);

    const a = rows.find((r) => r.graphId === "a")!;
    expect(a.totalRuns).toBe(2);
    expect(a.done).toBe(1);
    expect(a.failed).toBe(1);
    expect(a.lastRunId).toBe("r2");
    expect(a.lastStatus).toBe("failed");
    expect(a.costUsd).toBeCloseTo(0.03, 6);

    const b = rows.find((r) => r.graphId === "b")!;
    expect(b.halted).toBe(1);
    expect(b.lastRunId).toBe("r3");
    expect(b.costUsd).toBeCloseTo(0.005, 6);
  });

  it("keeps a zero-run graph with all-zero counters (never crashes on empty)", async () => {
    const rows = await db.operationsByGraph(U);
    const c = rows.find((r) => r.graphId === "c")!;
    expect(c).toBeDefined();
    expect(c.totalRuns).toBe(0);
    expect(c.running).toBe(0);
    expect(c.halted).toBe(0);
    expect(c.done).toBe(0);
    expect(c.failed).toBe(0);
    expect(c.lastRunId).toBeNull();
    expect(c.lastStatus).toBeNull();
    expect(c.lastStartedAt).toBeNull();
    expect(c.costUsd).toBe(0);
  });

  it("honors the since window for counters/cost but last* still spans all time", async () => {
    await makeRun("r1", "a", "Alpha", "done", 1000, 0.01);
    await makeRun("r2", "a", "Alpha", "failed", 2000, 0.02);
    await makeRun("r3", "b", "Beta", "done", 3000, 0.005);

    const rows = await db.operationsByGraph(U, { since: 2500 });
    const a = rows.find((r) => r.graphId === "a")!;
    // Both a-runs are before the window → windowed counters/cost are zero…
    expect(a.totalRuns).toBe(0);
    expect(a.costUsd).toBe(0);
    // …but the most-recent run across all time is still surfaced.
    expect(a.lastRunId).toBe("r2");
    expect(a.lastStatus).toBe("failed");

    const b = rows.find((r) => r.graphId === "b")!;
    expect(b.totalRuns).toBe(1);
    expect(b.done).toBe(1);
    expect(b.costUsd).toBeCloseTo(0.005, 6);
  });

  it("excludes still-running runs from cost but counts them as running", async () => {
    await makeRun("r-run", "a", "Alpha", "running", 1000, 0.1);
    const rows = await db.operationsByGraph(U);
    const a = rows.find((r) => r.graphId === "a")!;
    expect(a.running).toBe(1);
    expect(a.costUsd).toBe(0);
  });

  it("scopes the rollup by user (other tenants stay invisible)", async () => {
    await db.saveGraph(emptyGraph("d", "Delta"), 1, "u2");
    await db.createRun({ id: "rx", userId: "u2", graph: emptyGraph("d", "Delta"), budgetUsd: null, at: 9000, trigger: "manual" });
    await db.finishRun("rx", "u2", "done", 9010);

    const mine = await db.operationsByGraph(U);
    expect(mine.map((r) => r.graphId)).not.toContain("d");

    const theirs = await db.operationsByGraph("u2");
    expect(theirs.map((r) => r.graphId)).toEqual(["d"]);
    expect(theirs[0]!.done).toBe(1);
  });
});
