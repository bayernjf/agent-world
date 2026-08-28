import { compile, type RunEvent, Graph, replay } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { SEED_GRAPH } from "./seed.js";
import { fakeWorker, type Worker } from "./worker.js";

const worker = () => fakeWorker({ chunkDelayMs: 0 });
const clock = () => 0;

async function run(graph: Graph, budgetUsd: number | null = null, failFirstAttempts = 1) {
  const { plan } = compile(graph);
  if (!plan) throw new Error("graph did not compile");
  const events = [];
  for await (const e of execute({
    runId: "r",
    graph,
    plan,
    worker: fakeWorker({ chunkDelayMs: 0, failFirstAttempts }),
    budgetUsd,
    now: clock,
  })) {
    events.push(e);
  }
  return { events, state: replay(events) };
}

describe("execute", () => {
  it("runs every plant and hands freight along each pipe", async () => {
    const { state } = await run(SEED_GRAPH);

    expect(state.status).toBe("done");
    for (const node of SEED_GRAPH.nodes) {
      expect(state.nodes[node.id]?.status).toBe("done");
    }
    // Every flow pipe should have carried at least one truck, including the intake's.
    const carried = new Set(state.packets.map((p) => p.edgeId));
    for (const edge of SEED_GRAPH.edges.filter((e) => e.kind === "flow")) {
      expect(carried).toContain(edge.id);
    }
  });

  it("sends rejected work back down the rework line and re-runs the loop body", async () => {
    const { events, state } = await run(SEED_GRAPH);

    const verdicts = events.filter((e) => e.type === "gate.verdict");
    expect(verdicts.map((v) => v.passed)).toEqual([false, true]);

    const reworkEdge = SEED_GRAPH.edges.find((e) => e.kind === "rework")!;
    expect(state.packets.some((p) => p.edgeId === reworkEdge.id)).toBe(true);

    // Attempts are identity, not a counter: both forge outputs survive for diffing.
    const forge = state.nodes["forge"]!;
    expect(forge.attempt).toBe(2);
    expect(Object.keys(forge.outputs).sort()).toEqual(["1", "2"]);
    expect(forge.outputs[1]).not.toBe(forge.outputs[2]);
  });

  it("halts the line when the gate exhausts its attempts", async () => {
    const { events, state } = await run(SEED_GRAPH, null, 99);

    const exhausted = events.find((e) => e.type === "gate.exhausted");
    expect(exhausted?.policy).toBe("halt");
    expect(state.status).toBe("halted");
  });

  it("trips the breaker once metered cost passes the budget", async () => {
    const { events, state } = await run(SEED_GRAPH, 0.0001);

    expect(events.some((e) => e.type === "power.tripped")).toBe(true);
    expect(state.status).toBe("tripped");
    expect(state.totalCostUsd).toBeGreaterThan(0.0001);
  });

  it("emits a budget warning at 80% without tripping", async () => {
    // Single agent line whose only node costs a fixed 0.0008 per call.
    const g: Graph = {
      id: "warn",
      name: "warn",
      nodes: [
        { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
        { id: "a", kind: "agent", name: "A", x: 1, y: 0, agent: { model: "t", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 } },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "in", to: "a", kind: "flow" },
        { id: "e2", from: "a", to: "out", kind: "flow" },
      ],
    };
    const { plan } = compile(g)!;
    const costWorker = {
      async *runAgent() {
        return { output: "ok", usage: { tokensIn: 100, tokensOut: 50, costUsd: 0.0008 } };
      },
      async judge() { return { passed: true, reason: "ok" }; },
    };
    const events = [];
    for await (const e of execute({ runId: "r", graph: g, plan, worker: costWorker as never, budgetUsd: 0.001, now: clock })) {
      events.push(e);
    }
    const state = replay(events);
    const warn = events.find((e) => e.type === "power.warning");
    expect(warn).toBeTruthy();
    expect((warn as any).threshold).toBe(0.8);
    expect(state.budgetWarned).toBe(true);
    expect(state.status).toBe("done");
    expect(events.some((e) => e.type === "power.tripped")).toBe(false);
  });

  it("stops at the next checkpoint when cancelled", async () => {
    const { plan } = compile(SEED_GRAPH);
    const ac = new AbortController();
    const events = [];
    for await (const e of execute({
      runId: "r",
      graph: SEED_GRAPH,
      plan: plan!,
      worker: worker(),
      budgetUsd: null,
      signal: ac.signal,
      now: clock,
    })) {
      events.push(e);
      if (e.type === "node.finished") ac.abort();
    }
    expect(replay(events).status).toBe("cancelled");
  });

  it("numbers events consecutively from zero so SSE resume is unambiguous", async () => {
    const { events } = await run(SEED_GRAPH);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  });

  it("propagates source reference images to downstream agents", async () => {
    const graph = Graph.parse({
      id: "img",
      name: "img",
      nodes: [
        {
          id: "src",
          kind: "source",
          name: "SRC",
          x: 0,
          y: 0,
          source: { images: ["https://example.com/a.jpg", "https://example.com/b.jpg"] },
        },
        {
          id: "forge",
          kind: "agent",
          name: "FORGE",
          x: 1,
          y: 0,
          agent: { model: "test", prompt: "", skills: [] },
        },
        { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "forge", kind: "flow" },
        { id: "e2", from: "forge", to: "depot", kind: "flow" },
      ],
    });

    const seen: string[][] = [];
    const capturing = {
      ...fakeWorker({ chunkDelayMs: 0 }),
      async *runAgent(args: Parameters<ReturnType<typeof fakeWorker>["runAgent"]>[0]) {
        seen.push(args.images ?? []);
        return yield* fakeWorker({ chunkDelayMs: 0 }).runAgent(args);
      },
    };

    const { plan } = compile(graph);
    const events = [];
    for await (const e of execute({
      runId: "r",
      graph,
      plan: plan!,
      worker: capturing,
      now: clock,
    })) {
      events.push(e);
    }
    expect(replay(events).status).toBe("done");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toEqual([
      "https://example.com/a.jpg",
      "https://example.com/b.jpg",
    ]);
  });

  it("feeds structured source brief fields to downstream agents", async () => {
    const graph = Graph.parse({
      id: "brief",
      name: "brief",
      nodes: [
        {
          id: "src",
          kind: "source",
          name: "SRC",
          x: 0,
          y: 0,
          source: { productName: "真丝睡裙", brand: "绫LINGERIE", audience: "25-35岁女性", tone: "高级感性" },
        },
        {
          id: "forge",
          kind: "agent",
          name: "FORGE",
          x: 1,
          y: 0,
          agent: { model: "test", prompt: "", skills: [] },
        },
        { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "forge", kind: "flow" },
        { id: "e2", from: "forge", to: "depot", kind: "flow" },
      ],
    });

    let capturedInput = "";
    const capturing = {
      ...fakeWorker({ chunkDelayMs: 0 }),
      async *runAgent(args: Parameters<ReturnType<typeof fakeWorker>["runAgent"]>[0]) {
        capturedInput = args.input;
        return yield* fakeWorker({ chunkDelayMs: 0 }).runAgent(args);
      },
    };

    const { plan } = compile(graph);
    const events = [];
    for await (const e of execute({
      runId: "r",
      graph,
      plan: plan!,
      worker: capturing,
      input: "这是原料描述",
      now: clock,
    })) {
      events.push(e);
    }
    expect(replay(events).status).toBe("done");
    expect(capturedInput).toContain("商品名称：真丝睡裙");
    expect(capturedInput).toContain("品牌/店铺：绫LINGERIE");
    expect(capturedInput).toContain("目标人群：25-35岁女性");
    expect(capturedInput).toContain("语气调性：高级感性");
    expect(capturedInput).toContain("商品描述/原料:");
    expect(capturedInput).toContain("这是原料描述");
  });

  it("emits artifact.produced when agent output contains image URLs", async () => {
    const graph: Graph = {
      id: "art",
      name: "art",
      nodes: [
        { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
        { id: "a", kind: "agent", name: "A", x: 1, y: 0, agent: { model: "t", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 } },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "in", to: "a", kind: "flow" },
        { id: "e2", from: "a", to: "out", kind: "flow" },
      ],
    };
    const { plan } = compile(graph)!;
    const imgWorker = {
      async *runAgent() {
        return {
          output: "Here is the result ![cover](https://example.com/cover.png)",
          usage: { tokensIn: 10, tokensOut: 20, costUsd: 0.001 },
        };
      },
      async judge() { return { passed: true, reason: "ok" }; },
    };
    const events = [];
    for await (const e of execute({
      runId: "r", graph, plan, worker: imgWorker as never, budgetUsd: null, now: clock,
    })) {
      events.push(e);
    }
    const produced = events.filter(
      (e) => e.type === "artifact.produced" && (e as any).nodeId === "a",
    );
    expect(produced).toHaveLength(1);
    expect((produced[0] as any).artifact.kind).toBe("image");
    expect((produced[0] as any).artifact.uri).toBe("https://example.com/cover.png");
    const pkt = events.find((e) => e.type === "packet.sent" && (e as any).from === "a");
    expect((pkt as any)?.artifactKind).toBe("image");
    const state = replay(events);
    expect(state.nodes.a!.artifacts).toHaveLength(1);
  });

  it("warns on monthly budget but does not trip the line", async () => {
    const g: Graph = {
      id: "m",
      name: "m",
      nodes: [
        { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
        { id: "a", kind: "agent", name: "A", x: 1, y: 0, agent: { model: "t", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 } },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "in", to: "a", kind: "flow" },
        { id: "e2", from: "a", to: "out", kind: "flow" },
      ],
    };
    const { plan } = compile(g)!;
    const costWorker = {
      async *runAgent() {
        return { output: "ok", usage: { tokensIn: 100, tokensOut: 50, costUsd: 0.0011 } };
      },
      async judge() { return { passed: true, reason: "ok" }; },
    };
    // Prior month already spent 0.001; this run adds 0.0011 -> 0.0021 > 0.002 cap.
    const events = [];
    for await (const e of execute({
      runId: "r", graph: g, plan, worker: costWorker as never,
      budgetUsd: null, monthlyBudgetUsd: 0.002, monthSpentUsd: 0.001, now: clock,
    })) {
      events.push(e);
    }
    const monthly = events.filter(
      (ev) => ev.type === "power.warning" && (ev as any).scope === "monthly",
    );
    expect(monthly.length).toBeGreaterThanOrEqual(1);
    // Advisory only: the run still completes and is not tripped.
    expect(events.some((ev) => ev.type === "power.tripped")).toBe(false);
    expect(replay(events).status).toBe("done");
    expect(replay(events).monthlyBudgetWarned).toBe(true);
  });
});

describe("imageGen node", () => {
  const imgGraph: Graph = Graph.parse({
    id: "g",
    name: "img",
    nodes: [
      { id: "s", kind: "source", name: "S", x: 0, y: 0, source: { images: [] } },
      { id: "img", kind: "imageGen", name: "IMG", x: 0, y: 0, imageGen: { model: "m", prompt: "" } },
      { id: "a", kind: "agent", name: "A", x: 0, y: 0, agent: { model: "m", prompt: "" } },
      { id: "k", kind: "sink", name: "K", x: 0, y: 0 },
    ],
    edges: [
      { id: "e1", from: "s", to: "img", kind: "flow" },
      { id: "e2", from: "img", to: "a", kind: "flow" },
      { id: "e3", from: "a", to: "k", kind: "flow" },
    ],
  });

  async function runWith(w: Worker, graph: Graph, budgetUsd: number | null = null) {
    const { plan } = compile(graph);
    if (!plan) throw new Error("graph did not compile");
    const events: RunEvent[] = [];
    for await (const e of execute({ runId: "r", graph, plan, worker: w, budgetUsd, now: clock })) {
      events.push(e);
    }
    return { events, state: replay(events) };
  }

  it("generates an image and emits it as an artifact when the source lacks photos", async () => {
    const calls: string[] = [];
    const w: Worker = {
      ...fakeWorker({ chunkDelayMs: 0 }),
      async generateImage(args) {
        calls.push(args.input);
        return [{ data: Buffer.from("fake"), mimeType: "image/png", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } }];
      },
    };
    const { events, state } = await runWith(w, imgGraph);
    expect(state.status).toBe("done");
    expect(calls.length).toBe(1);
    const produced = events.find((e) => e.type === "artifact.produced" && e.artifact.kind === "image");
    expect(produced).toBeTruthy();
    const uri = produced!.artifact.uri;
    expect(uri).toBeTruthy();
  });

  it("generates images even when the source already has reference images", async () => {
    const calls: string[] = [];
    const w: Worker = {
      ...fakeWorker({ chunkDelayMs: 0 }),
      async generateImage(args) {
        calls.push(args.input);
        return [{ data: Buffer.from("x"), mimeType: "image/png", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } }];
      },
    };
    const withImages: Graph = Graph.parse({
      ...imgGraph,
      nodes: imgGraph.nodes.map((n) =>
        n.id === "s" ? { ...n, source: { images: ["https://example.com/p.jpg"] } } : n,
      ),
    });
    const { state } = await runWith(w, withImages);
    expect(state.status).toBe("done");
    // Reference images on the source are for the writer to describe; the
    // imageGen node still produces its own配图/场景图.
    expect(calls.length).toBe(1);
  });
});


/* ---------- inline image URL ---------- */

describe("inlineImageUrl (readArtifact indirection)", () => {
  it("returns the original URI for non-relative schemes", async () => {
    const { inlineImageUrl } = await import("./engine.js");
    const read = async () => "should not be called";
    expect(await inlineImageUrl("https://cdn.x/a.png", read)).toBe("https://cdn.x/a.png");
    expect(await inlineImageUrl("data:image/png;base64,abc", read)).toBe("data:image/png;base64,abc");
  });

  it("resolves /api/artifacts/<id> via readArtifact", async () => {
    const { inlineImageUrl } = await import("./engine.js");
    const read = async (uri: string) =>
      uri === "/api/artifacts/abc"
        ? "data:image/png;base64,QUJD"
        : null;
    expect(await inlineImageUrl("/api/artifacts/abc", read)).toBe("data:image/png;base64,QUJD");
  });

  it("falls back to the original URI when readArtifact returns null", async () => {
    const { inlineImageUrl } = await import("./engine.js");
    const read = async () => null;
    expect(await inlineImageUrl("/api/artifacts/missing", read)).toBe("/api/artifacts/missing");
  });

  it("falls back to the original URI when readArtifact throws", async () => {
    const { inlineImageUrl } = await import("./engine.js");
    const read = async () => { throw new Error("boom"); };
    expect(await inlineImageUrl("/api/artifacts/boom", read)).toBe("/api/artifacts/boom");
  });
});
