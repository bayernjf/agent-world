import { compile, type Graph, type GraphNode, type RunEvent } from "@agent-world/core";
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

/** A fake worker that echoes the *interpolated* prompt (`config.prompt`) so tests
 * can assert exactly what `${...}` resolved to — `args.input` is the upstream
 * brief text, not the template result. */
function echoPromptWorker(): Worker & { prompts: () => string[] } {
  const prompts: string[] = [];
  return {
    async *runTextGen(args) {
      prompts.push(args.config.prompt);
      return { output: args.config.prompt, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "" };
    },
    async generateImage() {
      return [];
    },
    prompts: () => prompts,
  } as Worker & { prompts: () => string[] };
}

/** The original (pre-data) worker: echoes upstream input so the pre-existing
 * behaviour assertions keep passing unchanged. */
function echoInputWorker(): Worker {
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

function textArtifact(events: RunEvent[], nodeId: string): string {
  const produced = events.find((e) => e.type === "artifact.produced" && e.nodeId === nodeId) as
    | { artifact: { content?: string } }
    | undefined;
  return produced?.artifact.content ?? "";
}

type Product = Record<string, unknown>;
function product(id: string, name: string, brand: string, price: number): Product {
  return {
    id,
    name,
    brand,
    price,
    category: "",
    sku: "",
    attributes: {},
    images: [],
    status: "active",
    createdAt: 0,
  };
}

const DATA = [product("p1", "复古托特包", "某某品牌", 99.9), product("p2", "帆布斜挎包", "另一个品牌", 199)];

function sourceNode(
  id: string,
  opts: { connector?: "product"; productName?: string; brand?: string; audience?: string } = {},
): GraphNode {
  return {
    id,
    kind: "source",
    name: "原料台",
    x: 0,
    y: 0,
    source: {
      connector: opts.connector ? { type: "product", product: { selection: "all" } } : undefined,
      ...(opts.productName !== undefined ? { productName: opts.productName } : {}),
      ...(opts.brand !== undefined ? { brand: opts.brand } : {}),
      ...(opts.audience !== undefined ? { audience: opts.audience } : {}),
    },
  };
}

function textGenNode(id: string, prompt: string): GraphNode {
  return {
    id,
    kind: "textGen",
    name: "文案",
    x: 1,
    y: 0,
    textGen: { ...TEXTGEN, prompt },
  };
}

function sinkNode(id: string): GraphNode {
  return { id, kind: "sink", name: "成品", x: 2, y: 0 };
}

async function runGraph(
  nodes: GraphNode[],
  edges: { from: string; to: string }[],
  opts: { loadProducts?: (c: unknown) => Promise<{ text: string; images: string[]; data?: unknown }>; worker?: Worker; sourceInput?: string } = {},
): Promise<RunEvent[]> {
  const graph: Graph = {
    id: "g",
    name: "product line",
    nodes,
    edges: edges.map((e, i) => ({ id: `e${i}`, ...e, kind: "flow" as const })),
  };
  const { plan } = compile(graph);
  if (!plan) throw new Error("no plan");
  const loadProducts =
    opts.loadProducts ??
    (async () => ({ text: "# 复古托特包\n品牌：某某品牌", images: [], data: DATA }));
  return await collect(
    execute({
      runId: "r",
      graph,
      plan,
      worker: opts.worker ?? echoInputWorker(),
      budgetUsd: null,
      now: () => 0,
      loadProducts: loadProducts as never,
      input: opts.sourceInput,
    }),
  );
}

describe("product connector (F4)", () => {
  it("resolves a product connector through the injected loader and feeds the downstream node", async () => {
    const graph = {
      id: "g",
      name: "product line",
      nodes: [sourceNode("intake", { connector: "product" }), textGenNode("writer", TEXTGEN.prompt), sinkNode("depot")],
      edges: [
        { id: "e1", from: "intake", to: "writer", kind: "flow" as const },
        { id: "e2", from: "writer", to: "depot", kind: "flow" as const },
      ],
    };
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
        worker: echoInputWorker(),
        budgetUsd: null,
        now: () => 0,
        loadProducts,
      }),
    );

    expect(loadProducts).toHaveBeenCalledOnce();
    const content = textArtifact(events, "writer");
    expect(content).toContain("复古托特包");
    expect(content).toContain("某某品牌");
  });

  it("surfaces a loader failure as a CONNECTOR node failure", async () => {
    const graph = {
      id: "g",
      name: "product line",
      nodes: [sourceNode("intake", { connector: "product" }), textGenNode("writer", TEXTGEN.prompt), sinkNode("depot")],
      edges: [
        { id: "e1", from: "intake", to: "writer", kind: "flow" as const },
        { id: "e2", from: "writer", to: "depot", kind: "flow" as const },
      ],
    };
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
        worker: echoInputWorker(),
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

describe("connector data interpolation (design-data-interpolation.md)", () => {
  it("② resolves the namespace form ${intake.data[0].name}", async () => {
    const w = echoPromptWorker();
    const events = await runGraph(
      [sourceNode("intake", { connector: "product" }), textGenNode("writer", "第一件：${intake.data[0].name}"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
      { worker: w },
    );
    expect(w.prompts()).toContain("第一件：复古托特包");
    expect(textArtifact(events, "writer")).toContain("第一件：复古托特包");
  });

  it("③ ${intake} whole-node ref still resolves to the brief text", async () => {
    const w = echoPromptWorker();
    await runGraph(
      [sourceNode("intake", { connector: "product" }), textGenNode("writer", "整包：${intake}"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
      { worker: w },
    );
    const prompt = w.prompts()[0]!;
    expect(prompt).toContain("整包：");
    expect(prompt).toContain("复古托特包");
  });

  it("⑤ user-provided fact field overrides the data fallback", async () => {
    const events = await runGraph(
      [sourceNode("intake", { connector: "product", productName: "我定的名字" }), textGenNode("writer", "brief：${intake}"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
    );
    const content = textArtifact(events, "writer");
    expect(content).toContain("商品名称：我定的名字");
    expect(content).not.toContain("商品名称：复古托特包");
  });

  it("⑥ tone fields are never auto-filled from data", async () => {
    const events = await runGraph(
      [sourceNode("intake", { connector: "product", audience: "我写的人群" }), textGenNode("writer", "brief：${intake}"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
    );
    const content = textArtifact(events, "writer");
    expect(content).toContain("目标人群：我写的人群");
    // priceRange/tone etc. have no data source — they stay whatever the user set (empty here → absent).
    expect(content).not.toContain("价格定位：99.9");
  });

  it("⑦ multiple product sources disable the global shortcut but keep the namespace form", async () => {
    const w = echoPromptWorker();
    await runGraph(
      [
        { ...sourceNode("srcA", { connector: "product" }), x: 0, y: 0 },
        { ...sourceNode("srcB", { connector: "product" }), x: 0, y: 1 },
        textGenNode("writer", "A=${product.name} N=${srcA.data[0].name}"),
        sinkNode("depot"),
      ],
      [{ from: "srcA", to: "writer" }, { from: "srcB", to: "writer" }, { from: "writer", to: "depot" }],
      { worker: w },
    );
    // ${product.name} resolves empty (shortcut disabled), namespace form still works.
    expect(w.prompts()[0]).toContain("A= N=复古托特包");
  });

  it("⑧ no product connector → ${product.name} resolves to empty string", async () => {
    const w = echoPromptWorker();
    await runGraph(
      [sourceNode("intake"), textGenNode("writer", "[${product.name}]"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
      { worker: w, loadProducts: async () => ({ text: "手填原料", images: [] }) },
    );
    expect(w.prompts()).toContain("[]");
  });

  it("⑪ a node literally named `product` wins over the global shortcut (ctx priority)", async () => {
    const w = echoPromptWorker();
    await runGraph(
      [
        // Real product source → the shortcut WOULD be injected were it not for
        // the manual node whose id literally spells `product`.
        sourceNode("intake", { connector: "product" }),
        { ...sourceNode("product"), name: "手填" },
        textGenNode("writer", "name=${product.name} whole=${product}"),
        sinkNode("depot"),
      ],
      [{ from: "intake", to: "writer" }, { from: "product", to: "writer" }, { from: "writer", to: "depot" }],
      { worker: w, sourceInput: "手填原料文本" },
    );
    // Node ctx entry (the brief text of the "product" node) wins over the
    // shortcut name — so `${product.name}` is empty and `${product}` is the brief.
    expect(w.prompts()[0]).toContain("name= whole=手填原料文本");
  });
});

