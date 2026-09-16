import { describe, expect, it } from "vitest";
import type { Graph, RunEvent } from "@agent-world/core";
import { fakeWorker } from "./worker.js";
import { buildFailureInfo, buildDiagnosisPrompt, diagnoseRun } from "./diagnose.js";

const snapshot: Graph = {
  id: "g1",
  name: "翻译产线",
  nodes: [
    { id: "n1", kind: "textGen", name: "初稿", x: 0, y: 0 },
    { id: "n2", kind: "translate", name: "翻译", x: 1, y: 0 },
  ],
  edges: [],
};

const events = [
  { type: "node.started", nodeId: "n1", attempt: 1 },
  { type: "node.finished", nodeId: "n1", attempt: 1 },
  { type: "node.started", nodeId: "n2", attempt: 1 },
  { type: "node.failed", nodeId: "n2", attempt: 1, error: "HTTP 429 first", errorCode: "RATE_LIMIT" },
  { type: "node.started", nodeId: "n2", attempt: 2 },
  { type: "node.failed", nodeId: "n2", attempt: 2, error: "HTTP 429 rate limit exceeded", errorCode: "RATE_LIMIT" },
  { type: "run.finished", runId: "r1", status: "failed" },
] as unknown as RunEvent[];

describe("buildFailureInfo", () => {
  it("maps node ids to snapshot names and collects failures", () => {
    const info = buildFailureInfo({
      graphName: "翻译产线",
      status: "failed",
      trigger: "cron",
      events,
      snapshot,
    });
    expect(info.failures).toHaveLength(1);
    const f = info.failures[0]!;
    expect(f.nodeName).toBe("翻译");
    expect(f.nodeKind).toBe("translate");
    expect(f.attempt).toBe(2);
    expect(f.errorCode).toBe("RATE_LIMIT");
    expect(f.error).toContain("429");
  });

  it("builds an ordered node lifecycle trail", () => {
    const info = buildFailureInfo({
      graphName: "翻译产线",
      status: "failed",
      trigger: "cron",
      events,
      snapshot,
    });
    expect(info.trail[0]).toBe("▶ 初稿");
    expect(info.trail).toContain("✓ 初稿");
    expect(info.trail).toContain("✗ 翻译 [RATE_LIMIT]");
    expect(info.trail[info.trail.length - 1]).toBe("■ 运行结束（failed）");
  });

  it("falls back to raw node ids when snapshot is corrupt", () => {
    const info = buildFailureInfo({
      graphName: "未知",
      status: "failed",
      trigger: "manual",
      events: [{ type: "node.failed", nodeId: "xyz", attempt: 1, error: "boom" }] as unknown as RunEvent[],
      snapshot: "not-json",
    });
    expect(info.failures[0]!.nodeName).toBe("xyz");
    expect(info.failures[0]!.nodeKind).toBe("unknown");
  });

  it("records no failures for an interrupted run with no node.failed events", () => {
    const info = buildFailureInfo({
      graphName: "翻译产线",
      status: "interrupted",
      trigger: "manual",
      events: [{ type: "node.started", nodeId: "n1", attempt: 1 }] as unknown as RunEvent[],
      snapshot,
    });
    expect(info.failures).toHaveLength(0);
  });
});

describe("buildDiagnosisPrompt", () => {
  it("includes graph name, failed node and error text", () => {
    const info = buildFailureInfo({
      graphName: "翻译产线",
      status: "failed",
      trigger: "cron",
      events,
      snapshot,
    });
    const prompt = buildDiagnosisPrompt(info);
    expect(prompt).toContain("翻译产线");
    expect(prompt).toContain("翻译");
    expect(prompt).toContain("429");
    expect(prompt).toContain("RATE_LIMIT");
  });
});

describe("diagnoseRun", () => {
  it("returns model output via the injected (fake) worker", async () => {
    const info = buildFailureInfo({
      graphName: "翻译产线",
      status: "failed",
      trigger: "cron",
      events,
      snapshot,
    });
    const result = await diagnoseRun(fakeWorker(), "u1", info, { model: "fake" });
    expect(result.model).toBe("fake");
    expect(result.diagnosis).toContain("failure-diagnose");
  });
});
