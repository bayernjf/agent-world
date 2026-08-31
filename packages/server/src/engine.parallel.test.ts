import { compile, Graph, replay, type GraphNode } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import type { Worker } from "./worker.js";

const clock = () => 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function agentNode(id: string, name: string, x: number, y: number): GraphNode {
  return {
    id,
    kind: "textGen",
    name,
    x,
    y,
    textGen: {
      model: "test",
      prompt: "",
      skills: [],
      temperature: 0.7,
      timeoutMs: 1000,
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    },
  };
}

function diamond(): Graph {
  return Graph.parse({
    id: "diamond",
    name: "diamond",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 200 },
      agentNode("a", "A", 250, 80),
      agentNode("b", "B", 250, 320),
      agentNode("join", "JOIN", 520, 200),
      { id: "depot", kind: "sink", name: "DEPOT", x: 780, y: 200 },
    ],
    edges: [
      { id: "e1", from: "src", to: "a", kind: "flow" },
      { id: "e2", from: "src", to: "b", kind: "flow" },
      { id: "e3", from: "a", to: "join", kind: "flow" },
      { id: "e4", from: "b", to: "join", kind: "flow" },
      { id: "e5", from: "join", to: "depot", kind: "flow" },
    ],
  });
}

/** Worker that records how many agents are welding simultaneously. */
function concurrencyWorker(onMax: (n: number) => void): Worker {
  let active = 0;
  const gate = async () => {
    active++;
    onMax(active);
    await sleep(20);
    active--;
  };
  return {
    async *runTextGen({ node, input }) {
      await gate();
      // JOIN echoes its merged input so the test can assert the barrier merge.
      const out = node.id === "join" ? input : `${node.name} done`;
      yield { type: "text-delta", text: out };
      return { output: out, usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "ok" };
    },
  };
}

describe("parallel execution", () => {
  it("groups independent plants into levels that can run concurrently", () => {
    const { plan } = compile(diamond());
    expect(plan).not.toBeNull();
    // A and B must sit in the same level.
    const levelWithA = plan!.levels.find((l) => l.includes("a"));
    expect(levelWithA).toContain("b");
    // JOIN is strictly downstream of both.
    const joinLevel = plan!.levels.findIndex((l) => l.includes("join"));
    const aLevel = plan!.levels.findIndex((l) => l.includes("a"));
    expect(joinLevel).toBeGreaterThan(aLevel);
  });

  it("runs independent branches concurrently and merges at the barrier", async () => {
    const graph = diamond();
    let maxConcurrent = 0;
    const { plan } = compile(graph);
    const events = [];
    for await (const e of execute({
      runId: "r",
      graph,
      plan: plan!,
      worker: concurrencyWorker((n) => {
        maxConcurrent = Math.max(maxConcurrent, n);
      }),
      budgetUsd: null,
      now: clock,
      sleep,
    })) {
      events.push(e);
    }
    const state = replay(events);
    expect(state.status).toBe("done");
    // A and B welded at the same time.
    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    // JOIN saw both outputs (barrier merge).
    const joinFinished = events.find((e) => e.type === "node.finished" && e.nodeId === "join")!;
    expect(joinFinished.output).toContain("A done");
    expect(joinFinished.output).toContain("B done");
  });

  it("keeps running independent branches when one plant fails its budget", async () => {
    const graph = diamond();
    // Plant A trips its own near-zero budget; B and the rest should still weld.
    const aNode = graph.nodes.find((n) => n.id === "a")!;
    aNode.textGen = { ...aNode.textGen!, budgetUsd: 0.0000001 };

    let ranB = false;
    const worker: Worker = {
      async *runTextGen({ node }) {
        if (node.id === "b") ranB = true;
        await sleep(5);
        yield { type: "text-delta", text: `${node.name} done` };
        return {
          output: `${node.name} done`,
          // A spends enough to trip its budget.
          usage: { tokensIn: 1, tokensOut: 1, costUsd: node.id === "a" ? 0.001 : 0 },
        };
      },
      async judge() {
        return { passed: true, reason: "ok" };
      },
    };

    const { plan } = compile(graph);
    const events = [];
    for await (const e of execute({
      runId: "r",
      graph,
      plan: plan!,
      worker,
      budgetUsd: null,
      now: clock,
      sleep,
    })) {
      events.push(e);
    }
    const state = replay(events);
    // The line as a whole fails because A failed, but B still ran.
    expect(state.status).toBe("failed");
    expect(ranB).toBe(true);
    const aFailed = events.find(
      (e) => e.type === "node.failed" && e.nodeId === "a" && e.errorCode === "BUDGET",
    );
    expect(aFailed).toBeTruthy();
  });
});
