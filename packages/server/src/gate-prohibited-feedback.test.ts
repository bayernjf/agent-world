import { compile, type Graph, type Usage } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import type { AgentChunk, Worker } from "./worker.js";

const USAGE: Usage = { tokensIn: 10, tokensOut: 5, costUsd: 0.001 };

// source -> forge (textGen) -> critic (gate) -> depot, with a rework edge back.
function graph(): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
      {
        id: "forge",
        kind: "textGen",
        name: "FORGE",
        x: 1,
        y: 0,
        textGen: {
          model: "test",
          prompt: "",
          skills: [],
          temperature: 0.7,
          timeoutMs: 60000,
          retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
        },
      },
      {
        id: "critic",
        kind: "gate",
        name: "CRITIC",
        x: 2,
        y: 0,
        gate: { maxAttempts: 2, criterion: "must be good", onExhausted: "halt" },
      },
      { id: "depot", kind: "sink", name: "DEPOT", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "forge", kind: "flow" },
      { id: "e2", from: "forge", to: "critic", kind: "flow" },
      { id: "e3", from: "critic", to: "depot", kind: "flow" },
      { id: "r1", from: "critic", to: "forge", kind: "rework" },
    ],
  };
}

async function drain(gen: AsyncGenerator<unknown, void, unknown>) {
  const out: unknown[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("gate prohibited-word rework feedback", () => {
  it("names every occurrence with its clause and feeds it back upstream", async () => {
    const g = graph();
    g.nodes.find((n) => n.id === "intake")!.source = { prohibited: "最" } as never;
    // The banned word 「最」 appears twice, in two different sentences.
    const offending = "这是全网最好的产品。用过的人都说最好。可以闭眼入。";
    const seenInputs: string[] = [];

    const worker: Worker = {
      async *runTextGen({ node, input }): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        if (node.id === "forge") seenInputs.push(input ?? "");
        yield { type: "text-delta", text: "x" };
        return { output: node.id === "forge" ? offending : input ?? "", usage: USAGE };
      },
      // Model judge always passes; the deterministic prohibited rule must reject.
      async judge() {
        return { passed: true, reason: "model ok" };
      },
    };

    const events = (await drain(
      execute({ runId: "r", graph: g, plan: compile(g)!.plan!, worker, budgetUsd: null, now: () => 0 }),
    )) as any[];

    const verdicts = events.filter((e) => (e as any).type === "gate.verdict") as any[];
    expect(verdicts.length).toBeGreaterThan(0);
    const reason = verdicts[0].reason as string;
    expect(reason).toContain("命中禁用词共 2 处");
    expect(reason).toContain("最×2");
    expect(reason).toContain("这是全网最好的产品");
    expect(reason).toContain("用过的人都说最好");

    // The enriched reason reaches the reworked node's input (rewrite guidance).
    expect(seenInputs.length).toBeGreaterThanOrEqual(2);
    expect(seenInputs[1]).toContain("[质检站退回原因]");
    expect(seenInputs[1]).toContain("命中禁用词共 2 处");
  });
});
