import { compile, Graph, type Graph as GraphType } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import type { AgentChunk, Worker } from "./worker.js";

const clock = () => 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function graphWithMap(template: string): GraphType {
  return Graph.parse({
    id: "g-vars",
    name: "vars",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0, source: {} },
      {
        id: "agent",
        kind: "textGen",
        name: "TEXTGEN",
        x: 300,
        y: 0,
        textGen: {
          model: "test",
          prompt: "use variable tools",
          temperature: 0,
          timeoutMs: 5000,
          retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
        },
      },
      { id: "map", kind: "map", name: "MAP", x: 600, y: 0, map: { template } },
      { id: "depot", kind: "sink", name: "DEPOT", x: 900, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "agent", kind: "flow" },
      { id: "e2", from: "agent", to: "map", kind: "flow" },
      { id: "e3", from: "map", to: "depot", kind: "flow" },
    ],
  });
}

/** Fake worker that replays a tool-call script, feeding results back via executeTool. */
function scriptedWorker(
  script: Array<{ name: string; args: Record<string, unknown> }>,
): Worker {
  return {
    async *runTextGen({ executeTool }): AsyncGenerator<
      AgentChunk,
      { output: string; usage: { tokensIn: number; tokensOut: number; costUsd: number } }
    > {
      expect(executeTool).toBeDefined();
      for (const [i, call] of script.entries()) {
        const id = `c${i}`;
        yield { type: "tool-call", id, name: call.name, arguments: call.args };
        const result = await executeTool!(call.name, call.args);
        yield { type: "tool-result", id, name: call.name, result };
      }
      yield { type: "text-delta", text: "x" };
      return {
        output: `agent-done (${script.length} tool calls)`,
        usage: { tokensIn: 10, tokensOut: 5, costUsd: 0 },
      };
    },
    async judge() {
      return { passed: true, reason: "ok" };
    },
    async generateImage() {
      return [];
    },
  };
}

async function run(graph: GraphType, variables: Map<string, unknown>, worker: Worker) {
  const { plan } = compile(graph);
  if (!plan) throw new Error("no plan");
  const events: unknown[] = [];
  for await (const e of execute({ runId: "r", graph, plan, worker, budgetUsd: null, now: clock, sleep, initialVariables: variables })) {
    events.push(e);
  }
  return events as Array<Record<string, unknown>>;
}

describe("graph variables", () => {
  it("agent writes via set_variable and downstream nodes read ${var.x}", async () => {
    const graph = graphWithMap(`{"brand": "${"${var.brand}"}", "agentOut": "${"${agent}"}"}`);
    const variables = new Map<string, unknown>();
    const events = await run(graph, variables, scriptedWorker([{ name: "set_variable", args: { key: "brand", value: "可口可乐" } }]));

    // The map node resolved ${var.brand} to the value the agent just wrote.
    const mapArtifact = events.find((e) => e.type === "artifact.produced" && e.nodeId === "map") as
      | { artifact: { content: string } }
      | undefined;
    expect(mapArtifact).toBeDefined();
    expect(JSON.parse(mapArtifact!.artifact.content)).toEqual({ brand: "可口可乐", agentOut: "agent-done (1 tool calls)" });

    // The engine mutated the caller's map by reference — ready to persist.
    expect(variables.get("brand")).toBe("可口可乐");

    const called = events.find((e) => e.type === "tool.called") as { name: string } | undefined;
    expect(called?.name).toBe("set_variable");
  });

  it("agent reads persisted values via get_variable", async () => {
    const graph = graphWithMap(`{"seed": "${"${var.seed}"}"}`);
    const variables = new Map<string, unknown>([["seed", "hello-42"]]);
    const events = await run(graph, variables, scriptedWorker([{ name: "get_variable", args: { key: "seed" } }]));

    const mapArtifact = events.find((e) => e.type === "artifact.produced" && e.nodeId === "map") as
      | { artifact: { content: string } }
      | undefined;
    expect(mapArtifact).toBeDefined();
    expect(JSON.parse(mapArtifact!.artifact.content)).toEqual({ seed: "hello-42" });

    // Variables are pre-populated for ${var.x} even before any tool call.
    const result = events.find((e) => e.type === "tool.result" && e.name === "get_variable") as
      | { result: { key: string; value: unknown } }
      | undefined;
    expect(result?.result).toEqual({ key: "seed", value: "hello-42" });
  });

  it("variables survive agent failure (no write on failed node)", async () => {
    const graph = graphWithMap(`{"x": "${"${var.x}"}"}`);
    const variables = new Map<string, unknown>();
    const failing: Worker = {
      ...scriptedWorker([]),
      async *runTextGen() {
        throw new Error("model blew up");
      },
    };
    const events = await run(graph, variables, failing);
    const fin = events.find((e) => e.type === "run.finished") as { status: string } | undefined;
    expect(fin?.status).toBe("failed");
    expect(variables.size).toBe(0);
  });

  it("subprocess runs share the parent's variables", async () => {
    const child: GraphType = Graph.parse({
      id: "g-child",
      name: "child",
      nodes: [
        { id: "cs", kind: "source", name: "CS", x: 0, y: 0, source: {} },
        {
          id: "ca",
          kind: "textGen",
          name: "CA",
          x: 300,
          y: 0,
          textGen: {
            model: "test",
            prompt: "write a var",
            temperature: 0,
            timeoutMs: 5000,
            retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
          },
        },
        { id: "ck", kind: "sink", name: "CK", x: 600, y: 0 },
      ],
      edges: [
        { id: "ce1", from: "cs", to: "ca", kind: "flow" },
        { id: "ce2", from: "ca", to: "ck", kind: "flow" },
      ],
    });
    const parent: GraphType = Graph.parse({
      id: "g-parent",
      name: "parent",
      nodes: [
        { id: "ps", kind: "source", name: "PS", x: 0, y: 0, source: {} },
        { id: "pp", kind: "subprocess", name: "PP", x: 300, y: 0, subprocess: { graphId: "g-child", maxDepth: 3 } },
        {
          id: "pm",
          kind: "map",
          name: "PM",
          x: 600,
          y: 0,
          map: { template: `{"brand": "${"${var.brand}"}"}` },
        },
        { id: "pk", kind: "sink", name: "PK", x: 900, y: 0 },
      ],
      edges: [
        { id: "pe1", from: "ps", to: "pp", kind: "flow" },
        { id: "pe2", from: "pp", to: "pm", kind: "flow" },
        { id: "pe3", from: "pm", to: "pk", kind: "flow" },
      ],
    });
    const variables = new Map<string, unknown>();
    const worker = scriptedWorker([{ name: "set_variable", args: { key: "brand", value: "从子流程写入" } }]);
    const { plan } = compile(parent);
    if (!plan) throw new Error("no plan");
    const events: unknown[] = [];
    for await (const e of execute({
      runId: "r",
      graph: parent,
      plan,
      worker,
      budgetUsd: null,
      now: clock,
      sleep,
      initialVariables: variables,
      loadSubgraph: (id) => (id === "g-child" ? child : null),
    })) {
      events.push(e);
    }
    // The child agent's set_variable landed in the shared map and the parent's
    // downstream map node saw it.
    expect(variables.get("brand")).toBe("从子流程写入");
    const mapArtifact = (events as Array<Record<string, unknown>>).find(
      (e) => e.type === "artifact.produced" && e.nodeId === "pm",
    ) as { artifact: { content: string } } | undefined;
    expect(JSON.parse(mapArtifact!.artifact.content)).toEqual({ brand: "从子流程写入" });
  });
});
