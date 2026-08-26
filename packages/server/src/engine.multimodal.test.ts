import { compile, type Graph, type RunEvent, replay } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { type Worker } from "./worker.js";

const AGENT = {
  model: "agnes-2.0-flash",
  prompt: "",
  skills: [],
  temperature: 0,
  timeoutMs: 60000,
  inputPolicy: { mode: "all" as const },
  retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
};

function spyWorker(): { worker: Worker; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const worker: Worker = {
    async *runAgent(args) {
      calls.push(args as unknown as Record<string, unknown>);
      yield { type: "text-delta", text: "ok" };
      return { output: "out", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "" };
    },
    async generateImage() {
      return [];
    },
  };
  return { worker, calls };
}

async function run(graph: Graph, worker: Worker) {
  const { plan } = compile(graph);
  if (!plan) throw new Error("graph did not compile");
  const events: RunEvent[] = [];
  for await (const e of execute({ runId: "r", graph, plan, worker, now: () => 0 })) {
    events.push(e);
  }
  return { events, state: replay(events) };
}

function graphWithSource(images?: string[]): Graph {
  return {
    nodes: [
      { id: "s1", kind: "source", name: "Src", x: 0, y: 0, source: images ? { images } : {} },
      { id: "a1", kind: "agent", name: "Agent", x: 1, y: 0, agent: AGENT },
    ],
    edges: [{ id: "e1", kind: "flow", from: "s1", to: "a1" }],
  };
}

describe("4.5 multimodal content parts", () => {
  it("assembles source images into a content list for the downstream agent", async () => {
    const { worker, calls } = spyWorker();
    await run(graphWithSource(["https://img/a.png"]), worker);

    const agentCall = calls.find((c) => (c.node as { id: string }).id === "a1")!;
    const content = agentCall.content as Array<{ type: string; image?: string; text?: string }>;
    expect(content).toBeDefined();
    expect(content).toContainEqual({ type: "image", image: "https://img/a.png" });
    expect(content.some((p) => p.type === "text" && typeof p.text === "string")).toBe(true);
    // Legacy shortcuts remain available for workers that still use them.
    expect(agentCall.images).toEqual(["https://img/a.png"]);
  });

  it("leaves content undefined when there are no reference images", async () => {
    const { worker, calls } = spyWorker();
    await run(graphWithSource(), worker);

    const agentCall = calls.find((c) => (c.node as { id: string }).id === "a1")!;
    expect(agentCall.content).toBeUndefined();
    expect(agentCall.images).toEqual([]);
  });
});
