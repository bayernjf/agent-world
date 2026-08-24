import { describe, expect, it } from "vitest";
import type { RunEvent } from "./events.js";
import { initialRuntime, reduce, replay } from "./runtime.js";

let seq = 0;
const ev = (e: Omit<RunEvent, "seq" | "ts">): RunEvent => ({ ...e, seq: seq++, ts: 1_000 + seq } as RunEvent);

function reworkRun(): RunEvent[] {
  seq = 0;
  return [
    ev({ type: "run.started", runId: "r1", graphId: "g1", budgetUsd: 1 }),
    ev({ type: "node.started", nodeId: "forge", attempt: 1 }),
    ev({ type: "node.delta", nodeId: "forge", attempt: 1, text: "first " }),
    ev({ type: "node.delta", nodeId: "forge", attempt: 1, text: "draft" }),
    ev({
      type: "node.finished",
      nodeId: "forge",
      attempt: 1,
      output: "first draft",
      usage: { tokensIn: 100, tokensOut: 50, costUsd: 0.01 },
    }),
    ev({ type: "gate.verdict", nodeId: "critic", attempt: 1, passed: false, reason: "thin" }),
    ev({ type: "node.started", nodeId: "forge", attempt: 2 }),
    ev({
      type: "node.finished",
      nodeId: "forge",
      attempt: 2,
      output: "second draft",
      usage: { tokensIn: 120, tokensOut: 80, costUsd: 0.02 },
    }),
    ev({ type: "power.metered", totalCostUsd: 0.03, budgetUsd: 1 }),
    ev({ type: "run.finished", runId: "r1", status: "done" }),
  ];
}

describe("runtime", () => {
  it("keeps each attempt's output separately so they can be diffed", () => {
    const state = replay(reworkRun());
    const forge = state.nodes.forge!;
    expect(forge.attempt).toBe(2);
    expect(forge.outputs[1]).toBe("first draft");
    expect(forge.outputs[2]).toBe("second draft");
  });

  it("accumulates cost across attempts rather than overwriting", () => {
    const forge = replay(reworkRun()).nodes.forge!;
    expect(forge.tokensIn).toBe(220);
    expect(forge.costUsd).toBeCloseTo(0.03);
  });

  it("reduces to the same state regardless of arrival order", () => {
    const events = reworkRun();
    const shuffled = [...events].reverse();
    expect(replay(shuffled)).toEqual(replay(events));
  });

  it("replays a prefix without leaking later state", () => {
    const events = reworkRun();
    const mid = replay(events, 5);
    expect(mid.status).toBe("running");
    expect(mid.nodes.forge!.outputs[2]).toBeUndefined();
    expect(mid.totalCostUsd).toBe(0);
  });

  it("trips the whole line when the budget ceiling is hit", () => {
    seq = 0;
    const state = replay([
      ev({ type: "run.started", runId: "r1", graphId: "g1", budgetUsd: 0.01 }),
      ev({ type: "power.tripped", totalCostUsd: 0.02, budgetUsd: 0.01 }),
    ]);
    expect(state.status).toBe("tripped");
  });

  it("is pure — reducing does not mutate the input state", () => {
    const before = structuredClone(initialRuntime);
    reduce(initialRuntime, reworkRun()[1]!);
    expect(initialRuntime).toEqual(before);
  });
});
