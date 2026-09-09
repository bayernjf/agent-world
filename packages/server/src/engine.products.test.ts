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
  opts: {
    connector?: "product";
    productName?: string;
    brand?: string;
    audience?: string;
    notes?: string;
    custom?: Record<string, string>;
  } = {},
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
      ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
      ...(opts.custom !== undefined ? { custom: opts.custom } : {}),
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
  opts: { loadProducts?: (c: unknown) => Promise<{ text: string; images: string[]; data?: unknown }>; worker?: Worker; sourceInput?: string; log?: import("./logger.js").Logger } = {},
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
      ...(opts.log ? { log: opts.log } : {}),
    }),
  );
}

/** A logger that captures warn/info messages so guards can be asserted. */
function captureLogger() {
  const warns: string[] = [];
  const infos: string[] = [];
  const child = {
    warn: (msg: string) => warns.push(msg),
    info: (msg: string) => infos.push(msg),
    debug: () => {},
    error: () => {},
  };
  const logger = { child: () => child, ...child } as unknown as import("./logger.js").Logger;
  return { logger, warns, infos };
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
  it("① resolves the global shortcut ${product.name} into a downstream prompt", async () => {
    const w = echoPromptWorker();
    const events = await runGraph(
      [sourceNode("intake", { connector: "product" }), textGenNode("writer", "商品名：${product.name}，品牌：${product.brand}"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
      { worker: w },
    );
    expect(w.prompts()).toContain("商品名：复古托特包，品牌：某某品牌");
    expect(textArtifact(events, "writer")).toContain("商品名：复古托特包，品牌：某某品牌");
  });

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

  it("④ auto-fills empty fact fields (productName/brand) from data[0]", async () => {
    // No productName/brand on the source → brief should pull them from data[0].
    const events = await runGraph(
      [sourceNode("intake", { connector: "product" }), textGenNode("writer", "brief：${intake}"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
    );
    const content = textArtifact(events, "writer");
    expect(content).toContain("商品名称：复古托特包");
    expect(content).toContain("品牌/店铺：某某品牌");
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

  it("⑨ a literal ${var.x} inside data is not expanded twice (re-entry guard)", async () => {
    const w = echoPromptWorker();
    const events = await runGraph(
      [sourceNode("intake", { connector: "product" }), textGenNode("writer", "名=${product.name}"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
      {
        worker: w,
        loadProducts: async () => ({
          text: "# 商品",
          images: [],
          data: [{ ...DATA[0], name: "商品${var.x}" }],
        }),
      },
    );
    expect(w.prompts()).toContain("名=商品${var.x}");
    expect(textArtifact(events, "writer")).toContain("商品${var.x}");
  });

  it("⑩ branch numeric condition ${product.price} > 100 routes correctly", async () => {
    const branch: GraphNode = {
      id: "fork",
      kind: "branch",
      name: "分档",
      x: 1,
      y: 0,
      branch: {
        rules: [{ id: "r1", when: "${product.price} > 100", target: "high" }],
        defaultTarget: "low",
      },
    };
    const events = await runGraph(
      [
        sourceNode("intake", { connector: "product" }),
        branch,
        sinkNode("high"),
        sinkNode("low"),
      ],
      [
        { from: "intake", to: "fork" },
        { from: "fork", to: "high" },
        { from: "fork", to: "low" },
      ],
      { loadProducts: async () => ({ text: "# 商品", images: [], data: [{ ...DATA[0], price: 200 }] }) },
    );
    // price=200 > 100 → high lane routed, low lane skipped.
    expect(events.some((e) => e.type === "packet.sent" && e.from === "fork" && e.to === "high")).toBe(true);
    expect(events.some((e) => e.type === "node.skipped" && e.nodeId === "low")).toBe(true);
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

/**
 * End-to-end integration tests (design-template-connector-presets.md §6).
 *
 * These deliberately drive the REAL chain `nodes/source.ts → buildSourceBrief →
 * nodes/textGen.ts` through execute(), rather than calling buildSourceBrief as a
 * pure function. A past regression deleted the third-argument call site while
 * the pure-function unit tests stayed green — that class of "unit green,
 * integration broken" drift is what this block guards against.
 */
describe("connector interpolation end-to-end (source → textGen chain)", () => {
  it("E2E-1 empty product library falls back to manual input, finishes, and warns once", async () => {
    const cap = captureLogger();
    const events = await runGraph(
      [sourceNode("intake", { connector: "product" }), textGenNode("writer", "写：${intake}"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
      {
        log: cap.logger,
        sourceInput: "我手动填的原料",
        loadProducts: async () => ({ text: "", images: [], data: [] }),
      },
    );
    // Run completes (no failed node) and the manual input survives into the brief.
    expect(events.some((e) => e.type === "node.failed")).toBe(false);
    expect(events.some((e) => e.type === "run.finished")).toBe(true);
    expect(textArtifact(events, "writer")).toContain("我手动填的原料");
    // Exactly one empty-data warn, visible instead of a silent empty string.
    expect(cap.warns.filter((m) => m.includes("empty data")).length).toBe(1);
  });

  it("E2E-2 interpolates ${product.name} inside a brief field (D5) before fallback merge", async () => {
    const events = await runGraph(
      [
        sourceNode("intake", { connector: "product", notes: "主推卖点围绕 ${product.name}（${product.brand}）" }),
        textGenNode("writer", "brief：${intake}"),
        sinkNode("depot"),
      ],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
    );
    const brief = textArtifact(events, "writer");
    expect(brief).toContain("主推卖点围绕 复古托特包（某某品牌）");
  });

  it("E2E-3 source brief carries fact fallback rows AND downstream prompt gets the shortcut", async () => {
    const w = echoPromptWorker();
    const events = await runGraph(
      [sourceNode("intake", { connector: "product" }), textGenNode("writer", "商品=${product.name}"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
      { worker: w },
    );
    // Source artifact: D4 fallback rows.
    const sourceBrief = textArtifact(events, "intake");
    expect(sourceBrief).toContain("商品名称：复古托特包");
    expect(sourceBrief).toContain("品牌/店铺：某某品牌");
    // Downstream prompt: D3 shortcut substitution on the real chain.
    expect(w.prompts()).toContain("商品=复古托特包");
  });

  it("E2E-4 dangling ${product.name} with no product source logs a guard warning", async () => {
    const cap = captureLogger();
    await runGraph(
      [sourceNode("intake"), textGenNode("writer", "[${product.name}]"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
      { log: cap.logger, sourceInput: "纯手动", loadProducts: async () => ({ text: "纯手动", images: [] }) },
    );
    expect(cap.warns.some((m) => m.includes("has no product connector source"))).toBe(true);
  });
});


describe("source custom fields", () => {
  it("writes each key: value row into the brief and skips blank keys/values", async () => {
    const events = await runGraph(
      [
        sourceNode("intake", {
          notes: "先看合同",
          custom: { 交付日期: "2026-10-01", 客户编号: "C-7781", "": "无键", 空值: "  " },
        }),
        sinkNode("depot"),
      ],
      [{ from: "intake", to: "depot" }],
      { sourceInput: "合同正文", loadProducts: async () => ({ text: "", images: [] }) },
    );
    const brief = textArtifact(events, "intake");
    expect(brief).toContain("交付日期：2026-10-01");
    expect(brief).toContain("客户编号：C-7781");
    expect(brief).not.toContain("无键");
    expect(brief).not.toContain("空值");
    // Custom rows sit after the fixed brief fields, before the raw material.
    expect(brief.indexOf("补充说明：先看合同")).toBeLessThan(brief.indexOf("交付日期"));
    expect(brief.indexOf("交付日期")).toBeLessThan(brief.indexOf("合同正文"));
  });

  it("interpolates ${...} inside custom values against the connector payload", async () => {
    const events = await runGraph(
      [
        sourceNode("intake", {
          connector: "product",
          custom: { 主推商品: "${product.name}", 首个单价: "${data[0].price}", 固定值: "不含插值" },
        }),
        sinkNode("depot"),
      ],
      [{ from: "intake", to: "depot" }],
    );
    const brief = textArtifact(events, "intake");
    expect(brief).toContain("主推商品：复古托特包");
    expect(brief).toContain("首个单价：99.9");
    expect(brief).toContain("固定值：不含插值");
  });

  it("exposes custom fields downstream as ${srcId.custom.键}", async () => {
    const w = echoPromptWorker();
    await runGraph(
      [
        sourceNode("intake", { custom: { 交付日期: "2026-10-01" } }),
        textGenNode("writer", "截止 ${intake.custom.交付日期} 前交付"),
        sinkNode("depot"),
      ],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
      { worker: w, sourceInput: "原料", loadProducts: async () => ({ text: "", images: [] }) },
    );
    expect(w.prompts()).toContain("截止 2026-10-01 前交付");
  });

  it("a source without custom fields or connector data keeps ${srcId} a bare string", async () => {
    const w = echoPromptWorker();
    await runGraph(
      [sourceNode("intake"), textGenNode("writer", "[${intake}][${intake.custom.x}]"), sinkNode("depot")],
      [{ from: "intake", to: "writer" }, { from: "writer", to: "depot" }],
      { worker: w, sourceInput: "纯手动", loadProducts: async () => ({ text: "", images: [] }) },
    );
    // No metadata written: the ctx entry is the brief string itself, so a
    // `custom` lookup resolves to empty rather than reaching an envelope.
    expect(w.prompts()).toContain("[纯手动][]");
  });
});
