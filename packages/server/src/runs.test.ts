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

describe("runs db: listRuns filtering + runStats", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "aw-runs-"));
    db = openDb(join(dir, "test.sqlite"));
    await db.saveGraph(emptyGraph("a", "Alpha"), 1, U);
    await db.saveGraph(emptyGraph("b", "Beta"), 2, U);

    await db.createRun({ id: "r1", userId: U, graph: emptyGraph("a", "Alpha"), budgetUsd: 0.01, at: 1000, trigger: "manual" });
    await db.finishRun("r1", U, "completed", 2000);
    await db.createRun({ id: "r2", userId: U, graph: emptyGraph("a", "Alpha"), budgetUsd: 0.02, at: 3000, trigger: "manual" });
    await db.finishRun("r2", U, "failed", 4000);
    await db.createRun({ id: "r3", userId: U, graph: emptyGraph("b", "Beta"), budgetUsd: 0.03, at: 5000, trigger: "cron" });
    await db.finishRun("r3", U, "completed", 6000);

    await db.record("r1", { seq: 1, ts: 1001, type: "node.finished", nodeId: "n1", attempt: 1, output: "x", usage: { tokensIn: 100, tokensOut: 50, costUsd: 0.005 } } as never);
    await db.record("r1", { seq: 2, ts: 1002, type: "node.finished", nodeId: "n2", attempt: 1, output: "y", usage: { tokensIn: 60, tokensOut: 30, costUsd: 0.003 } } as never);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns newest-first with a total count", async () => {
    const { rows, total } = await db.listRuns(U, {});
    expect(total).toBe(3);
    expect(rows.map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
  });

  it("filters by graphId", async () => {
    const { rows, total } = await db.listRuns(U, { graphId: "a" });
    expect(total).toBe(2);
    expect(rows.every((r) => r.graph_id === "a")).toBe(true);
  });

  it("filters by status", async () => {
    const { rows, total } = await db.listRuns(U, { status: "completed" });
    expect(total).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["r1", "r3"]);
  });

  it("paginates with limit/offset", async () => {
    const page = await db.listRuns(U, { limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].id).toBe("r2");
  });

  it("free-text query matches graph name case-insensitively", async () => {
    const { rows, total } = await db.listRuns(U, { q: "alpha" });
    expect(total).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("free-text query matches node output text", async () => {
    const { rows, total } = await db.listRuns(U, { q: "x" });
    expect(total).toBe(1);
    expect(rows[0].id).toBe("r1");
  });

  it("free-text query matches node error text", async () => {
    await db.record("r2", { seq: 9, ts: 3500, type: "node.failed", nodeId: "n9", attempt: 1, error: "[RATE_LIMIT] polish node: HTTP 429", errorCode: "RATE_LIMIT" } as never);
    const { rows, total } = await db.listRuns(U, { q: "429" });
    expect(total).toBe(1);
    expect(rows[0].id).toBe("r2");
  });

  it("free-text query with no hits returns empty", async () => {
    const { rows, total } = await db.listRuns(U, { q: "不存在的关键词zzz" });
    expect(total).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it("aggregates runStats from node_runs", async () => {
    const s = await db.runStats("r1");
    expect(s.nodes).toBe(2);
    expect(s.tokensIn).toBe(160);
    expect(s.tokensOut).toBe(80);
    expect(s.costUsd).toBeCloseTo(0.008, 5);
  });
});
