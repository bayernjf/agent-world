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

  it("accumulates a failure history across nodes, gates, and budget trips", () => {
    seq = 0;
    const state = replay([
      ev({ type: "run.started", runId: "r1", graphId: "g1", budgetUsd: 0.01 }),
      ev({ type: "node.started", nodeId: "forge", attempt: 1 }),
      ev({
        type: "node.failed",
        nodeId: "forge",
        attempt: 1,
        error: "connection timed out",
        errorCode: "TIMEOUT",
      }),
    ]);
    expect(state.nodes.forge!.status).toBe("failed");
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0]).toMatchObject({
      kind: "node",
      nodeId: "forge",
      attempt: 1,
      errorCode: "TIMEOUT",
      error: "connection timed out",
    });
    expect(state.nodes.forge!.error).toBe("connection timed out");
  });

  it("marks budgetWarned at the 80% warning", () => {
    seq = 0;
    const state = replay([
      ev({ type: "run.started", runId: "r1", graphId: "g1", budgetUsd: 0.10 }),
      ev({ type: "power.warning", totalCostUsd: 0.08, budgetUsd: 0.10, threshold: 0.8 }),
    ]);
    expect(state.budgetWarned).toBe(true);
    expect(state.totalCostUsd).toBe(0.08);
  });

  it("tracks monthly budget warnings separately from run budget", () => {
    seq = 0;
    const state = replay([
      ev({ type: "run.started", runId: "r1", graphId: "g1", budgetUsd: 0.10 }),
      ev({ type: "power.metered", totalCostUsd: 0.01, budgetUsd: 0.10 }),
      ev({ type: "power.warning", totalCostUsd: 5.0, budgetUsd: 5.0, threshold: 1, scope: "monthly" }),
    ]);
    expect(state.monthlyBudgetWarned).toBe(true);
    // Monthly warning must not overwrite the per-run gauge values.
    expect(state.budgetWarned).toBe(false);
    expect(state.totalCostUsd).toBe(0.01);
  });

  it("records a budget-trip failure", () => {
    seq = 0;
    const state = replay([
      ev({ type: "run.started", runId: "r1", graphId: "g1", budgetUsd: 0.01 }),
      ev({ type: "power.tripped", totalCostUsd: 0.02, budgetUsd: 0.01 }),
    ]);
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0]!.kind).toBe("budget");
  });

  it("collects artifacts produced by nodes", () => {
    seq = 0;
    const state = replay([
      ev({ type: "run.started", runId: "r1", graphId: "g1", budgetUsd: null }),
      ev({ type: "node.started", nodeId: "forge", attempt: 1 }),
      ev({
        type: "artifact.produced",
        nodeId: "forge",
        attempt: 1,
        artifact: { id: "forge-a1", kind: "image", uri: "https://example.com/a.png" },
      }),
      ev({
        type: "artifact.produced",
        nodeId: "forge",
        attempt: 1,
        artifact: { id: "forge-a2", kind: "text", content: "caption" },
      }),
    ]);
    expect(state.nodes.forge!.artifacts).toHaveLength(2);
    expect(state.nodes.forge!.artifacts[0]!.kind).toBe("image");
    expect(state.nodes.forge!.artifacts[1]!.content).toBe("caption");
  });

  it("carries artifactKind on packets", () => {
    seq = 0;
    const state = replay([
      ev({ type: "run.started", runId: "r1", graphId: "g1", budgetUsd: null }),
      ev({
        type: "packet.sent",
        edgeId: "e1",
        from: "a",
        to: "b",
        summary: "image result",
        artifactKind: "image",
      }),
    ]);
    expect(state.packets[0]!.artifactKind).toBe("image");
  });

  it("is pure — reducing does not mutate the input state", () => {
    const before = structuredClone(initialRuntime);
    reduce(initialRuntime, reworkRun()[1]!);
    expect(initialRuntime).toEqual(before);
  });
});
