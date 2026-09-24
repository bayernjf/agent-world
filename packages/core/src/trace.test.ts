import { describe, expect, it } from "vitest";
import type { RunEvent } from "./events.js";
import { buildTimeline, summarizeOutput, OUTPUT_PREVIEW_LEN } from "./trace.js";

function evt(partial: Partial<RunEvent> & { type: RunEvent["type"]; seq: number; ts: number }): RunEvent {
  return partial as RunEvent;
}

const usage = (over: Partial<{ tokensIn: number; tokensOut: number; costUsd: number; model: string }> = {}) => ({
  tokensIn: 10,
  tokensOut: 5,
  costUsd: 0.01,
  ...over,
});

describe("summarizeOutput", () => {
  it("returns full output when within cap", () => {
    const r = summarizeOutput("short");
    expect(r).toEqual({ preview: "short", truncated: false });
  });
  it("truncates long output and flags it", () => {
    const r = summarizeOutput("x".repeat(OUTPUT_PREVIEW_LEN + 50));
    expect(r.truncated).toBe(true);
    expect(r.preview.length).toBe(OUTPUT_PREVIEW_LEN);
  });
});

describe("buildTimeline", () => {
  it("projects a simple two-node success in first-seen order", () => {
    const events: RunEvent[] = [
      evt({ type: "run.started", seq: 0, ts: 1000, runId: "r1", graphId: "g1", budgetUsd: null }),
      evt({ type: "node.started", seq: 1, ts: 1000, nodeId: "A", attempt: 1 }),
      evt({ type: "node.finished", seq: 2, ts: 2000, nodeId: "A", attempt: 1, output: "hello", usage: usage() }),
      evt({ type: "node.started", seq: 3, ts: 2000, nodeId: "B", attempt: 1 }),
      evt({ type: "node.finished", seq: 4, ts: 3500, nodeId: "B", attempt: 1, output: "world", usage: usage({ costUsd: 0.02 }) }),
    ];
    const tl = buildTimeline(events);
    expect(tl.nodes.map((n) => n.nodeId)).toEqual(["A", "B"]);
    expect(tl.nodes.every((n) => n.status === "done")).toBe(true);
    const a = tl.nodes[0].attempts[0];
    expect(a.durationMs).toBe(1000);
    expect(a.outputPreview).toBe("hello");
    expect(tl.totals.done).toBe(2);
    expect(tl.totals.costUsd).toBeCloseTo(0.03);
    expect(tl.totals.tokensIn).toBe(20);
  });

  it("keeps both attempts on retry and counts only the terminal attempt for totals", () => {
    const events: RunEvent[] = [
      evt({ type: "node.started", seq: 1, ts: 0, nodeId: "A", attempt: 1 }),
      evt({ type: "node.failed", seq: 2, ts: 500, nodeId: "A", attempt: 1, error: "boom", errorCode: "RATE_LIMIT" }),
      evt({ type: "node.started", seq: 3, ts: 600, nodeId: "A", attempt: 2 }),
      evt({ type: "node.finished", seq: 4, ts: 900, nodeId: "A", attempt: 2, output: "ok", usage: usage({ costUsd: 0.05 }) }),
    ];
    const tl = buildTimeline(events);
    const node = tl.nodes[0];
    expect(node.attempts).toHaveLength(2);
    expect(node.status).toBe("done");
    expect(node.attempts[0].status).toBe("failed");
    expect(node.attempts[0].errorCode).toBe("RATE_LIMIT");
    // Only the terminal (successful) attempt's cost is counted once.
    expect(tl.totals.costUsd).toBeCloseTo(0.05);
    expect(tl.totals.failed).toBe(0);
  });

  it("records gate verdicts and scores", () => {
    const events: RunEvent[] = [
      evt({ type: "node.started", seq: 1, ts: 0, nodeId: "QC", attempt: 1 }),
      evt({ type: "gate.verdict", seq: 2, ts: 100, nodeId: "QC", attempt: 1, passed: false, reason: "banned term", score: 3 }),
      evt({ type: "node.finished", seq: 3, ts: 200, nodeId: "QC", attempt: 1, output: "x", usage: usage() }),
    ];
    const at = buildTimeline(events).nodes[0].attempts[0];
    expect(at.gate).toEqual({ passed: false, reason: "banned term", score: 3 });
    expect(at.score).toBe(3);
  });

  it("tracks budget trip and warnings", () => {
    const events: RunEvent[] = [
      evt({ type: "run.started", seq: 0, ts: 0, runId: "r", graphId: "g", budgetUsd: 1 }),
      evt({ type: "power.warning", seq: 1, ts: 10, totalCostUsd: 0.8, budgetUsd: 1, threshold: 0.8 }),
      evt({ type: "power.tripped", seq: 2, ts: 20, totalCostUsd: 1, budgetUsd: 1 }),
    ];
    const tl = buildTimeline(events);
    expect(tl.budget.budgetUsd).toBe(1);
    expect(tl.budget.warnings).toBe(1);
    expect(tl.budget.tripped).toBe(true);
    expect(tl.budget.totalCostUsd).toBe(1);
  });

  it("does not throw on an empty or partial event stream", () => {
    expect(buildTimeline([]).nodes).toEqual([]);
    const tl = buildTimeline([evt({ type: "node.started", seq: 0, ts: 0, nodeId: "X", attempt: 1 })]);
    expect(tl.nodes[0].status).toBe("running");
    expect(tl.totals.running).toBe(1);
  });

  it("counts tool calls and artifacts per attempt", () => {
    const events: RunEvent[] = [
      evt({ type: "node.started", seq: 1, ts: 0, nodeId: "A", attempt: 1 }),
      evt({ type: "tool.called", seq: 2, ts: 1, nodeId: "A", attempt: 1, callId: "c1", name: "search", args: {} }),
      evt({ type: "tool.result", seq: 3, ts: 2, nodeId: "A", attempt: 1, callId: "c1", name: "search" }),
      evt({ type: "artifact.produced", seq: 4, ts: 3, nodeId: "A", attempt: 1, artifact: { id: "art1", kind: "json" } }),
      evt({ type: "node.finished", seq: 5, ts: 4, nodeId: "A", attempt: 1, output: "{}", usage: usage() }),
    ];
    const at = buildTimeline(events).nodes[0].attempts[0];
    expect(at.toolCalls).toBe(1);
    expect(at.artifacts).toBe(1);
  });

  it("projects the skip reason for skipped nodes", () => {
    const events: RunEvent[] = [
      evt({
        type: "node.skipped",
        seq: 1,
        ts: 100,
        nodeId: "A",
        attempt: 1,
        reason: "audio unsupported: worker has no generateAudio capability",
      }),
    ];
    const tl = buildTimeline(events);
    const at = tl.nodes[0].attempts[0];
    expect(at.status).toBe("skipped");
    expect(at.skipReason).toBe("audio unsupported: worker has no generateAudio capability");
    expect(tl.nodes[0].status).toBe("skipped");
    expect(tl.totals.skipped).toBe(1);
  });

  it("defaults skipReason to null when skipped without a reason", () => {
    const events: RunEvent[] = [
      evt({ type: "node.skipped", seq: 1, ts: 100, nodeId: "A", attempt: 1 }),
    ];
    const at = buildTimeline(events).nodes[0].attempts[0];
    expect(at.status).toBe("skipped");
    expect(at.skipReason).toBeNull();
  });

  it("projects a degraded node with its remote job and counts totals.degraded", () => {
    const events: RunEvent[] = [
      evt({ type: "node.started", seq: 1, ts: 0, nodeId: "V", attempt: 1 }),
      evt({
        type: "node.degraded",
        seq: 2,
        ts: 100,
        nodeId: "V",
        attempt: 1,
        reason: "poll window closed",
        errorCode: "TIMEOUT",
        remoteJob: { provider: "fake", jobId: "job-1", kind: "video" },
      }),
    ];
    const tl = buildTimeline(events);
    const at = tl.nodes[0].attempts[0];
    expect(at.status).toBe("degraded");
    expect(at.degradedReason).toBe("poll window closed");
    expect(at.remoteJob).toEqual({ provider: "fake", jobId: "job-1", kind: "video" });
    expect(at.degradedAccepted).toBe(false);
    expect(tl.nodes[0].status).toBe("degraded");
    expect(tl.totals.degraded).toBe(1);
  });

  it("keeps the degraded badge after node.degradedAccepted but marks it accepted", () => {
    const events: RunEvent[] = [
      evt({ type: "node.started", seq: 1, ts: 0, nodeId: "V", attempt: 1 }),
      evt({
        type: "node.degraded",
        seq: 2,
        ts: 100,
        nodeId: "V",
        attempt: 1,
        reason: "x",
        errorCode: "TIMEOUT",
        remoteJob: { jobId: "job-1", kind: "video" },
      }),
      evt({ type: "node.degradedAccepted", seq: 3, ts: 200, nodeId: "V", attempt: 1 }),
    ];
    const tl = buildTimeline(events);
    const at = tl.nodes[0].attempts[0];
    // The badge deliberately stays degraded; only the accepted flag flips.
    expect(at.status).toBe("degraded");
    expect(at.degradedAccepted).toBe(true);
    expect(tl.totals.degraded).toBe(1);
  });
});
