import { compile, Graph, replay, type TextGenConfig } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import type { AgentChunk, Worker } from "./worker.js";

const clock = () => 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Worker that echoes exactly what it received as input. */
function echoWorker(): Worker {
  return {
    async *runTextGen({ input }): AsyncGenerator<AgentChunk, { output: string; usage: { tokensIn: number; tokensOut: number; costUsd: number } }> {
      yield { type: "text-delta", text: input };
      return { output: input, usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "ok" };
    },
  };
}

function linearGraph(policy?: TextGenConfig["inputPolicy"]): Graph {
  return Graph.parse({
    id: "policy",
    name: "policy",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      {
        id: "a",
        kind: "textGen",
        name: "A",
        x: 300,
        y: 0,
        textGen: {
          model: "test",
          prompt: "",
          skills: [],
          temperature: 0.7,
          timeoutMs: 5000,
          retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
        } satisfies TextGenConfig,
      },
      {
        id: "b",
        kind: "textGen",
        name: "B",
        x: 600,
        y: 0,
        textGen: {
          model: "test",
          prompt: "",
          skills: [],
          temperature: 0.7,
          timeoutMs: 5000,
          retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
          ...(policy ? { inputPolicy: policy } : {}),
        } satisfies TextGenConfig,
      },
      { id: "depot", kind: "sink", name: "DEPOT", x: 900, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "a", kind: "flow" },
      { id: "e2", from: "a", to: "b", kind: "flow" },
      { id: "e3", from: "b", to: "depot", kind: "flow" },
    ],
  });
}

describe("input policy", () => {
  it("truncates long input when mode is truncate", async () => {
    const longText = "x".repeat(2000);
    const graph = linearGraph({ mode: "truncate", maxChars: 500 });
    const { plan } = compile(graph);
    const events = [];
    for await (const e of execute({
      runId: "r",
      graph,
      plan: plan!,
      worker: echoWorker(),
      budgetUsd: null,
      input: longText,
      now: clock,
      sleep,
    })) {
      events.push(e);
    }
    const state = replay(events);
    expect(state.status).toBe("done");
    const bOutput = state.nodes["b"]!.outputs[1]!;
    // B saw A's output which echoed the 2000-char input; truncated to ~500
    expect(bOutput.length).toBeLessThan(600);
    expect(bOutput).toContain("已截断");
  });

  it("passes all upstream output by default (mode all)", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph);
    const events = [];
    for await (const e of execute({
      runId: "r",
      graph,
      plan: plan!,
      worker: echoWorker(),
      budgetUsd: null,
      input: "hello world",
      now: clock,
      sleep,
    })) {
      events.push(e);
    }
    const state = replay(events);
    expect(state.status).toBe("done");
    expect(state.nodes["b"]!.outputs[1]).toBe("hello world");
  });
});
