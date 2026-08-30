import { compile, type Graph, type RunEvent, type Worker } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";

const TEXTGEN = {
  model: "agnes-2.0-flash",
  prompt: "BASE",
  skills: [] as Array<string | { id: string; enabled?: boolean; config?: Record<string, unknown> }>,
  temperature: 0,
  timeoutMs: 60000,
  inputPolicy: { mode: "all" as const },
  retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
};

const LONG = "X".repeat(800) + " 重要结论：最终方案是A。";

function summaryGraph(policy: { mode: "all" | "last" | "truncate" | "summary"; maxChars?: number }): Graph {
  return {
    nodes: [
      { id: "s1", kind: "source", name: "Src", x: 0, y: 0, source: {} },
      { id: "w1", kind: "textGen", name: "Writer", x: 1, y: 0, textGen: { ...TEXTGEN, inputPolicy: policy } },
      { id: "k1", kind: "sink", name: "End", x: 2, y: 0, sink: {} },
    ],
    edges: [
      { id: "e1", kind: "flow", from: "s1", to: "w1" },
      { id: "e2", kind: "flow", from: "w1", to: "k1" },
    ],
  };
}

/** Worker that records the agent's input and optionally provides a summarizer. */
function summaryWorker(opts: {
  summarize?: (text: string) => string;
  record?: (input: string) => void;
}): Worker {
  return {
    async *runTextGen(args) {
      opts.record?.(args.input);
      const out = `OUT-${(args.node as { id: string }).id}`;
      yield { type: "text-delta", text: out };
      return { output: out, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "ok" };
    },
    async generateImage() {
      return [];
    },
    ...(opts.summarize ? { summarize: async ({ text }: { text: string }) => opts.summarize!(text) } : {}),
  };
}

async function run(graph: Graph, worker: Worker, input: string): Promise<RunEvent[]> {
  const { plan } = compile(graph);
  if (!plan) throw new Error("no plan");
  const out: RunEvent[] = [];
  for await (const e of execute({ runId: "r", graph, plan, worker, input, now: () => 0 })) out.push(e);
  return out;
}

const finished = (events: RunEvent[]) =>
  events.find((e) => e.type === "run.finished") as Extract<RunEvent, { type: "run.finished" }>;

describe("E.1 rolling summary (input policy = summary)", () => {
  it("compresses oversized upstream input via summarize instead of truncating", async () => {
    const recorded: string[] = [];
    const worker = summaryWorker({
      record: (i) => recorded.push(i),
      summarize: (text) => `SUMMARY::${text.slice(0, 30)}`,
    });
    const events = await run(summaryGraph({ mode: "summary", maxChars: 500 }), worker, LONG);
    expect(finished(events).status).toBe("done");
    const input = recorded[0];
    expect(input).toContain("SUMMARY::");
    expect(input).not.toContain("已截断");
    expect(input).not.toContain("X".repeat(800));
  });

  it("falls back to hard truncate when summarize throws", async () => {
    const recorded: string[] = [];
    const worker = summaryWorker({
      record: (i) => recorded.push(i),
      summarize: () => {
        throw new Error("boom");
      },
    });
    const events = await run(summaryGraph({ mode: "summary", maxChars: 500 }), worker, LONG);
    expect(finished(events).status).toBe("done");
    expect(recorded[0]).toContain("已截断");
    expect(recorded[0]).not.toContain("X".repeat(800));
  });

  it("falls back to hard truncate when no summarizer is available", async () => {
    const recorded: string[] = [];
    const worker = summaryWorker({ record: (i) => recorded.push(i) }); // no summarize
    const events = await run(summaryGraph({ mode: "summary", maxChars: 500 }), worker, LONG);
    expect(finished(events).status).toBe("done");
    expect(recorded[0]).toContain("已截断");
  });

  it("passes the full input through when under the threshold (no summarization)", async () => {
    const recorded: string[] = [];
    const worker = summaryWorker({
      record: (i) => recorded.push(i),
      summarize: (text) => `SUMMARY::${text}`,
    });
    const events = await run(summaryGraph({ mode: "summary", maxChars: 100000 }), worker, LONG);
    expect(finished(events).status).toBe("done");
    expect(recorded[0]).toContain("X".repeat(800));
    expect(recorded[0]).not.toContain("SUMMARY::");
    expect(recorded[0]).not.toContain("已截断");
  });
});
