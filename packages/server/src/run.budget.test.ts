import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { monthlyBudgetExceeded, startRun } from "./run.js";
import type { Graph, RunEvent } from "@agent-world/core";

const U = "u1";

const graph: Graph = {
  id: "g1",
  name: "G1",
  nodes: [
    { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
    {
      id: "a",
      kind: "textGen",
      name: "A",
      x: 1,
      y: 0,
      textGen: { model: "t", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 },
    },
    { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
  ],
  edges: [
    { id: "e1", from: "in", to: "a", kind: "flow" },
    { id: "e2", from: "a", to: "out", kind: "flow" },
  ],
};

describe("monthlyBudgetExceeded", () => {
  it("blocks once the month's cost reaches the budget", () => {
    expect(monthlyBudgetExceeded(1, 1, false)).toBe(true);
    expect(monthlyBudgetExceeded(1, 1.5, false)).toBe(true);
  });

  it("allows while under budget", () => {
    expect(monthlyBudgetExceeded(1, 0.999, false)).toBe(false);
  });

  it("treats null/undefined/zero as disabled", () => {
    expect(monthlyBudgetExceeded(null, 100, false)).toBe(false);
    expect(monthlyBudgetExceeded(undefined, 100, false)).toBe(false);
    expect(monthlyBudgetExceeded(0, 100, false)).toBe(false);
  });

  it("bypass overrides the hard stop", () => {
    expect(monthlyBudgetExceeded(1, 100, true)).toBe(false);
  });
});

describe("startRun hard stop", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-budget-"));
    db = openDb(join(dir, "test.sqlite"));
    // Tiny budget so any recorded cost trips it; a plain file config is picked
    // up by loadConfig() via AGENT_WORLD_CONFIG (settingsStore is unbound here).
    writeFileSync(join(dir, "config.json"), JSON.stringify({ monthlyBudgetUsd: 0.001 }));
    process.env.AGENT_WORLD_CONFIG = join(dir, "config.json");
    delete process.env.AGENT_WORLD_BUDGET_BYPASS;
  });

  afterEach(() => {
    delete process.env.AGENT_WORLD_CONFIG;
    delete process.env.AGENT_WORLD_BUDGET_BYPASS;
    rmSync(dir, { recursive: true, force: true });
  });

  function finished(nodeId: string, attempt: number, cost: number, seq: number): RunEvent {
    return {
      seq,
      ts: seq * 1000,
      version: 1,
      type: "node.finished",
      nodeId,
      attempt,
      output: "out",
      usage: { tokensIn: 100, tokensOut: 50, cachedTokens: 10, reasoningTokens: 0, costUsd: cost },
    } as RunEvent;
  }

  /** Record a finished run this month so costForMonth() returns `cost`. */
  function spendThisMonth(cost: number) {
    const now = new Date();
    const at = new Date(now.getFullYear(), now.getMonth(), 1, 1).getTime();
    db.createRun({ id: `hist-${cost}`, userId: U, graph, budgetUsd: null, at });
    db.record(`hist-${cost}`, finished("a", 1, cost, 1));
    db.finishRun(`hist-${cost}`, U, "done", at + 1000);
  }

  it("rejects a new run (RunStartError 402) when the monthly budget is exceeded", async () => {
    spendThisMonth(0.002); // > 0.001 budget

    await expect(
      startRun({ db, userId: U, worker: {} as never, artifacts: {} as never, live: new Map(), graph, trigger: "test" }),
    ).rejects.toMatchObject({ status: 402 });
  });

  // 「未超预算 / 放行」的判定逻辑由上面的 monthlyBudgetExceeded 纯函数覆盖；
  // 这里不测 startRun 的放行路径，因为放行会启动 fire-and-forget 的后台 execute，
  // 需要真实 worker/artifacts，且 `{}` stub 会引发时序性问题。
});
