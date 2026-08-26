import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import type { Graph, RunEvent } from "@agent-world/core";

const DAY_MS = 86_400_000;

const graph: Graph = {
  id: "g1",
  name: "G1",
  nodes: [{ id: "n1", kind: "agent", name: "N1", x: 0, y: 0 }],
  edges: [],
};

function finished(
  nodeId: string,
  attempt: number,
  cost: number,
  seq: number,
): RunEvent {
  return {
    seq,
    ts: seq * 1000,
    version: 1,
    type: "node.finished",
    nodeId,
    attempt,
    output: "out",
    usage: {
      tokensIn: 100,
      tokensOut: 50,
      cachedTokens: 10,
      reasoningTokens: 0,
      costUsd: cost,
    },
  } as RunEvent;
}

describe("cost report", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-costs-"));
    db = openDb(join(dir, "test.sqlite"));
    db.saveGraph(graph, 1);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("aggregates totals, per graph, per node, attempt, and day", () => {
    db.createRun({ id: "r1", graph, budgetUsd: null, at: DAY_MS * 10 });
    db.record("r1", finished("n1", 1, 0.01, 1));
    db.record("r1", finished("n1", 2, 0.005, 2));
    db.finishRun("r1", "done", DAY_MS * 10 + 1000);

    db.createRun({ id: "r2", graph, budgetUsd: null, at: DAY_MS * 20 });
    db.record("r2", finished("n1", 1, 0.02, 1));
    db.finishRun("r2", "done", DAY_MS * 20 + 1000);

    const rep = db.costReport();
    expect(rep.totals.runs).toBe(2);
    expect(rep.totals.cost_usd).toBeCloseTo(0.035, 5);
    expect(rep.totals.tokens_in).toBe(300);

    expect(rep.byGraph).toHaveLength(1);
    expect(rep.byGraph[0].cost_usd).toBeCloseTo(0.035, 5);

    expect(rep.byNode[0].node_id).toBe("n1");
    expect(rep.byNode[0].node_name).toBe("N1");
    expect(rep.byNode[0].attempts).toBe(3);
    expect(rep.byNode[0].reworks).toBe(1);

    const rework = rep.byAttempt.find((a) => a.attempt === 2)!;
    expect(rework.cost_usd).toBeCloseTo(0.005, 5);
    expect(rep.byDay).toHaveLength(2);
  });

  it("filters by time range and excludes running runs", () => {
    db.createRun({ id: "r1", graph, budgetUsd: null, at: DAY_MS * 5 });
    db.record("r1", finished("n1", 1, 0.01, 1));
    db.finishRun("r1", "done", DAY_MS * 5 + 1000);

    db.createRun({ id: "r2", graph, budgetUsd: null, at: DAY_MS * 100 });
    db.record("r2", finished("n1", 1, 0.05, 1));

    const recent = db.costReport({ from: Date.now() });
    expect(recent.totals.runs).toBe(0);
    expect(recent.totals.cost_usd).toBe(0);

    const all = db.costReport();
    expect(all.totals.runs).toBe(1);
    expect(all.totals.cost_usd).toBeCloseTo(0.01, 5);
  });

  it("sums cost for a specific calendar month via costForMonth", () => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();

    db.createRun({ id: "r1", graph, budgetUsd: null, at: thisMonthStart + 1000 });
    db.record("r1", finished("n1", 1, 0.01, 1));
    db.finishRun("r1", "done", thisMonthStart + 2000);

    db.createRun({ id: "r2", graph, budgetUsd: null, at: lastMonthStart + 1000 });
    db.record("r2", finished("n1", 1, 0.05, 1));
    db.finishRun("r2", "done", lastMonthStart + 2000);

    const spent = db.costForMonth(now.getFullYear(), now.getMonth() + 1);
    expect(spent).toBeCloseTo(0.01, 5);

    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const spentLast = db.costForMonth(last.getFullYear(), last.getMonth() + 1);
    expect(spentLast).toBeCloseTo(0.05, 5);
  });
});

describe("eval report", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-eval-"));
    db = openDb(join(dir, "test.sqlite"));
    db.saveGraph(graph, 1);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function nodeFinished(runId: string, nodeId: string, attempt: number, at: number) {
    db.record(runId, {
      seq: attempt,
      ts: at,
      version: 1,
      type: "node.finished",
      nodeId,
      attempt,
      output: "ok",
      usage: { tokensIn: 10, tokensOut: 5, costUsd: 0.001 },
    } as RunEvent);
  }

  it("aggregates pass rate, rework and duration", () => {
    // Passed run with one rework (n1 attempt 2).
    db.createRun({ id: "r1", graph, budgetUsd: null, at: 1000 });
    nodeFinished("r1", "n1", 1, 1000);
    nodeFinished("r1", "n1", 2, 1500);
    db.finishRun("r1", "done", 2000);

    // Failed run.
    db.createRun({ id: "r2", graph, budgetUsd: null, at: 3000 });
    nodeFinished("r2", "n1", 1, 3000);
    db.finishRun("r2", "failed", 3500);

    const rep = db.evalReport();
    expect(rep.totals.runs).toBe(2);
    expect(rep.totals.passed).toBe(1);
    expect(rep.totals.passRate).toBeCloseTo(0.5, 5);
    // r1 had 2 attempts on one node -> 1 rework; r2 had 0 -> avg 0.5.
    expect(rep.totals.avgRework).toBeCloseTo(0.5, 5);
    // durations: 1000 and 500 -> avg 750.
    expect(rep.totals.avgDurationMs).toBeCloseTo(750, 1);
    expect(rep.byGraph).toHaveLength(1);
    expect(rep.byGraph[0]!.graph_name).toBe("G1");
    expect(rep.byDay).toHaveLength(1);
  });

  it("filters by graph id", () => {
    const other: Graph = { id: "g2", name: "G2", nodes: [], edges: [] };
    db.saveGraph(other, 2);
    db.createRun({ id: "r1", graph, budgetUsd: null, at: 1000 });
    db.finishRun("r1", "done", 1500);
    db.createRun({ id: "r2", graph: other, budgetUsd: null, at: 2000 });
    db.finishRun("r2", "failed", 2500);

    const rep = db.evalReport({ graphId: "g1" });
    expect(rep.totals.runs).toBe(1);
    expect(rep.totals.passRate).toBe(1);
  });

  it("groups runs by prompt version for before/after comparison", () => {
    const makeGraph = (prompt: string): Graph => ({
      id: "g1",
      name: "G1",
      nodes: [
        { id: "n1", kind: "agent", name: "N1", x: 0, y: 0, agent: { model: "m", prompt, skills: [], temperature: 0.7, timeoutMs: 60000 } },
      ],
      edges: [],
    });

    // v1 prompt -> run passes
    db.createRun({ id: "r1", graph: makeGraph("prompt v1"), budgetUsd: null, at: 1000 });
    db.record("r1", { seq: 1, ts: 1000, version: 1, type: "node.finished", nodeId: "n1", attempt: 1, output: "ok", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 } } as RunEvent);
    db.finishRun("r1", "done", 1500);

    // v2 prompt -> run fails
    db.createRun({ id: "r2", graph: makeGraph("prompt v2 — improved"), budgetUsd: null, at: 2000 });
    db.record("r2", { seq: 1, ts: 2000, version: 1, type: "node.finished", nodeId: "n1", attempt: 1, output: "bad", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 } } as RunEvent);
    db.finishRun("r2", "failed", 2500);

    const rep = db.evalReport();
    expect(rep.byPrompt).toHaveLength(2);
    const versions = rep.byPrompt.map((p) => p.version).sort();
    expect(versions).toEqual(["v1", "v2"]);
    const v1 = rep.byPrompt.find((p) => p.version === "v1")!;
    const v2 = rep.byPrompt.find((p) => p.version === "v2")!;
    expect(v1.passRate).toBe(1);
    expect(v2.passRate).toBe(0);
    // Fingerprints must differ between prompt versions.
    expect(v1.fingerprint).not.toBe(v2.fingerprint);
  });
});
