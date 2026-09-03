import { compile, type Graph, type RunEvent } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import type { Worker } from "./worker.js";

const TEXTGEN = {
  model: "agnes-2.0-flash",
  prompt: "",
  skills: [],
  temperature: 0,
  timeoutMs: 60000,
  inputPolicy: { mode: "all" as const },
  retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
};

/** Minimal worker: compliance never calls the LLM, so these are only fallbacks. */
function noopWorker(): Worker {
  return {
    async *runTextGen(args) {
      return { output: `OUT-${(args.node as { id: string }).id}`, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "" };
    },
    async generateImage() {
      return [];
    },
  } as Worker;
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function finished(events: RunEvent[]) {
  const f = events.filter((e) => e.type === "run.finished");
  return f[f.length - 1] as Extract<RunEvent, { type: "run.finished" }>;
}

/** source → compliance → sink. The compliance node checks the source output. */
function complianceGraph(cfg: Record<string, unknown>, sourceInput: string): Graph {
  return {
    nodes: [
      { id: "s1", kind: "source", name: "Src", x: 0, y: 0, source: {} },
      { id: "c1", kind: "compliance", name: "合规", x: 1, y: 0, compliance: cfg as never },
      { id: "k1", kind: "sink", name: "成品", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "s1", to: "c1", kind: "flow" },
      { id: "e2", from: "c1", to: "k1", kind: "flow" },
    ],
  };
}

describe("compliance node (F3)", () => {
  it("clean text passes and flows to the sink unchanged", async () => {
    const graph = complianceGraph({ platform: "xiaohongshu" }, "这件复古托特包，日常通勤很实用。 #穿搭");
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(
      execute({ runId: "r", graph, plan, worker: noopWorker(), budgetUsd: null, input: "这件复古托特包，日常通勤很实用。 #穿搭", now: () => 0 }),
    );
    expect(finished(events).status).toBe("done");
    const json = events.find((e) => e.type === "artifact.produced" && (e.artifact as { id: string }).id.endsWith("-compliance"));
    expect(json).toBeDefined();
    const payload = JSON.parse((json as { artifact: { content: string } }).artifact.content);
    expect(payload.passed).toBe(true);
  });

  it("a banned word is flagged and autoFix rewrites it", async () => {
    const graph = complianceGraph({ platform: "xiaohongshu", autoFix: true }, "全网最好");
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(
      execute({ runId: "r", graph, plan, worker: noopWorker(), budgetUsd: null, input: "全网最好", now: () => 0 }),
    );
    expect(finished(events).status).toBe("done");
    const json = events.find((e) => e.type === "artifact.produced" && (e.artifact as { id: string }).id.endsWith("-compliance"));
    const payload = JSON.parse((json as { artifact: { content: string } }).artifact.content);
    expect(payload.passed).toBe(false);
    expect(payload.violations.some((v: { type: string }) => v.type === "banned")).toBe(true);
    expect(payload.sanitized).not.toContain("最好");
  });

  it("failOnViolation routes a violation to node.failed (error edge catchable)", async () => {
    const graph = complianceGraph({ platform: "xiaohongshu", failOnViolation: true }, "全网最好");
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(
      execute({ runId: "r", graph, plan, worker: noopWorker(), budgetUsd: null, input: "全网最好", now: () => 0 }),
    );
    expect(finished(events).status).toBe("failed");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "c1");
    expect(failed).toBeDefined();
  });

  it("merges the user's banned-terms library into the check", async () => {
    const graph = complianceGraph({ platform: "wechat" }, "本品联名款限量发售。");
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(
      execute({
        runId: "r",
        graph,
        plan,
        worker: noopWorker(),
        budgetUsd: null,
        input: "本品联名款限量发售。",
        bannedTerms: "联名款",
        now: () => 0,
      }),
    );
    const json = events.find((e) => e.type === "artifact.produced" && (e.artifact as { id: string }).id.endsWith("-compliance"));
    const payload = JSON.parse((json as { artifact: { content: string } }).artifact.content);
    expect(payload.passed).toBe(false);
    expect(payload.violations.some((v: { match?: string }) => v.match === "联名款")).toBe(true);
  });
});
