import { compile, type Graph, type RunEvent } from "@agent-world/core";
import { describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import type { Worker } from "./worker.js";

const TEXTGEN = {
  model: "agnes-2.0-flash",
  prompt: "把下面的商品写一段种草文案：${intake}",
  skills: [],
  temperature: 0,
  timeoutMs: 60000,
  inputPolicy: { mode: "all" as const },
  retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
};

function worker(): Worker {
  return {
    async *runTextGen(args) {
      return { output: args.input, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
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

function productGraph(): Graph {
  return {
    id: "g",
    name: "product line",
    nodes: [
      {
        id: "intake",
        kind: "source",
        name: "原料台",
        x: 0,
        y: 0,
        source: { connector: { type: "product", product: { selection: "all" } } },
      },
      { id: "writer", kind: "textGen", name: "文案", x: 1, y: 0, textGen: TEXTGEN },
      { id: "depot", kind: "sink", name: "成品", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "writer", kind: "flow" },
      { id: "e2", from: "writer", to: "depot", kind: "flow" },
    ],
  };
}

describe("product connector (F4)", () => {
  it("resolves a product connector through the injected loader and feeds the downstream node", async () => {
    const graph = productGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const loadProducts = vi.fn(async () => ({
      text: "# 复古托特包\n品牌：某某品牌\n价格：99.9",
      images: ["/img/1.png"],
    }));

    const events = await collect(
      execute({
        runId: "r",
        graph,
        plan,
        worker: worker(),
        budgetUsd: null,
        now: () => 0,
        loadProducts,
      }),
    );

    expect(loadProducts).toHaveBeenCalledOnce();
    // The downstream textGen receives the product text via ${intake} interpolation.
    const produced = events.find((e) => e.type === "artifact.produced" && e.nodeId === "writer");
    expect(produced).toBeDefined();
    const content = (produced as { artifact: { content?: string } }).artifact.content ?? "";
    expect(content).toContain("复古托特包");
    expect(content).toContain("某某品牌");
  });

  it("surfaces a loader failure as a CONNECTOR node failure", async () => {
    const graph = productGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const loadProducts = vi.fn(async () => {
      throw new Error("product library unavailable");
    });

    const events = await collect(
      execute({
        runId: "r",
        graph,
        plan,
        worker: worker(),
        budgetUsd: null,
        now: () => 0,
        loadProducts,
      }),
    );

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "intake");
    expect(failed).toBeDefined();
    expect((failed as { error: string }).error).toContain("product library unavailable");
  });
});
