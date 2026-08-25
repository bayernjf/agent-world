import { compile, Graph, replay, type AgentConfig } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import type { AgentChunk, Worker } from "./worker.js";

const clock = () => 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toolGraph(): Graph {
  return Graph.parse({
    id: "tools",
    name: "tools",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      {
        id: "agent",
        kind: "agent",
        name: "TOOL_USER",
        x: 300,
        y: 0,
        agent: {
          model: "test",
          prompt: "use the tool",
          skills: [{ id: "json_extract", enabled: true, config: {} }],
          temperature: 0.7,
          timeoutMs: 5000,
          retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
        } satisfies AgentConfig,
      },
      { id: "depot", kind: "sink", name: "DEPOT", x: 600, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "agent", kind: "flow" },
      { id: "e2", from: "agent", to: "depot", kind: "flow" },
    ],
  });
}

/**
 * Fake worker that simulates a model issuing a tool call, then producing
 * final text after the engine feeds the result back.
 */
function toolWorker(): Worker {
  return {
    async *runAgent({ executeTool }): AsyncGenerator<AgentChunk, { output: string; usage: { tokensIn: number; tokensOut: number; costUsd: number } }> {
      expect(executeTool).toBeDefined();
      const callId = "call_1";
      yield {
        type: "tool-call",
        id: callId,
        name: "json_extract",
        arguments: { json: '{"result":42}', path: "result" },
      };
      const result = await executeTool!("json_extract", {
        json: '{"result":42}',
        path: "result",
      });
      yield {
        type: "tool-result",
        id: callId,
        name: "json_extract",
        result,
      };
      yield { type: "text-delta", text: `The answer is ${result}` };
      return {
        output: `The answer is ${result}`,
        usage: { tokensIn: 10, tokensOut: 5, costUsd: 0 },
      };
    },
    async judge() {
      return { passed: true, reason: "ok" };
    },
  };
}

describe("tool execution in engine", () => {
  it("emits tool.called and tool.result events and audits them", async () => {
    const graph = toolGraph();
    const { plan } = compile(graph);
    const events = [];
    for await (const e of execute({
      runId: "r",
      graph,
      plan: plan!,
      worker: toolWorker(),
      budgetUsd: null,
      now: clock,
      sleep,
    })) {
      events.push(e);
    }

    const state = replay(events);
    expect(state.status).toBe("done");

    const called = events.find((e) => e.type === "tool.called")!;
    expect(called).toBeTruthy();
    expect(called.name).toBe("json_extract");

    const result = events.find((e) => e.type === "tool.result")!;
    expect(result).toBeTruthy();
    expect(result.result).toBe(42);

    // The runtime tracked the tool call on the node.
    const rt = state.nodes["agent"]!;
    expect(rt.toolCalls).toHaveLength(1);
    expect(rt.toolCalls[0]!.name).toBe("json_extract");
    expect(rt.toolCalls[0]!.result).toBe(42);
    expect(rt.outputs[1]).toContain("42");
  });
});
