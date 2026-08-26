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
});
