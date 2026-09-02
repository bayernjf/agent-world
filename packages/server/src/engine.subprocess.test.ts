import { compile, type Graph, type RunEvent } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute, resume } from "./engine.js";
import { type Worker } from "./worker.js";

const TEXTGEN = {
  model: "agnes-2.0-flash",
  prompt: "",
  skills: [],
  temperature: 0,
  timeoutMs: 60000,
  inputPolicy: { mode: "all" as const },
  retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
};

function fakeWorker(): Worker {
  return {
    async *runTextGen(args) {
      yield { type: "text-delta", text: "x" };
      return { output: `OUT-${(args.node as { id: string }).id}`, usage: { tokensIn: 1, tokensOut: 1, costUsd: 0.01 } };
    },
    async judge() {
      return { passed: true, reason: "ok" };
    },
    async generateImage() {
      return [];
    },
  };
}

/** Child graph: source → agent → sink; agent output is the sink's product. */
const CHILD_GRAPH: Graph = {
  id: "g-child",
  name: "子流程",
  nodes: [
    { id: "cs", kind: "source", name: "子源", x: 0, y: 0, source: {} },
    { id: "ca", kind: "textGen", name: "子代理", x: 1, y: 0, textGen: TEXTGEN },
    { id: "ck", kind: "sink", name: "子汇", x: 2, y: 0 },
  ],
  edges: [
    { id: "ce1", kind: "flow", from: "cs", to: "ca" },
    { id: "ce2", kind: "flow", from: "ca", to: "ck" },
  ],
};

/** Child graph with a human approval in the middle. */
const CHILD_HUMAN_GRAPH: Graph = {
  id: "g-child-human",
  name: "子流程审批",
  nodes: [
    { id: "cs", kind: "source", name: "子源", x: 0, y: 0, source: {} },
    { id: "ch", kind: "human", name: "子审批", x: 1, y: 0, human: { prompt: "确认文案" } },
    { id: "ck", kind: "sink", name: "子汇", x: 2, y: 0 },
  ],
  edges: [
    { id: "ce1", kind: "flow", from: "cs", to: "ch" },
    { id: "ce2", kind: "flow", from: "ch", to: "ck" },
  ],
};

/** Parent graph: source → subprocess(g-child) → sink. */
function parentGraph(): Graph {
  return {
    id: "g-parent",
    name: "父流程",
    nodes: [
      { id: "ps", kind: "source", name: "父源", x: 0, y: 0, source: { productName: "测试产品" } },
      { id: "pp", kind: "subprocess", name: "调用子流程", x: 1, y: 0, subprocess: { graphId: "g-child", maxDepth: 3 } },
      { id: "pk", kind: "sink", name: "父汇", x: 2, y: 0 },
    ],
    edges: [
      { id: "pe1", kind: "flow", from: "ps", to: "pp" },
      { id: "pe2", kind: "flow", from: "pp", to: "pk" },
    ],
  };
}

const loadChild = (graphId: string): Graph | null =>
  graphId === "g-child" ? CHILD_GRAPH : graphId === "g-child-human" ? CHILD_HUMAN_GRAPH : null;

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const finished = (events: RunEvent[]) =>
  events.find((e) => e.type === "run.finished") as Extract<RunEvent, { type: "run.finished" }>;

const nodeState = (events: RunEvent[], id: string) =>
  events
    .filter((e) => e.type === "node.finished" && e.nodeId === id)
    .map((e) => e as Extract<RunEvent, { type: "node.finished" }>)
    .at(-1);

describe("subprocess node", () => {
  it("calls the child graph with the upstream text and aggregates its sink as the product", async () => {
    const { plan } = compile(parentGraph());
    if (!plan) throw new Error("no plan");
    const worker = fakeWorker();
    const events = await collect(
      execute({ runId: "r", graph: parentGraph(), plan, worker, loadSubgraph: loadChild, now: () => 0 }),
    );
    const fin = finished(events);
    expect(fin.status).toBe("done");

    // The child's agent ran (its output reached the subprocess product) and
    // the parent's sink ran last. Child events carry the `#sub:` namespace.
    expect(nodeState(events, "pp#sub:ca")?.output).toBe("OUT-ca");
    expect(nodeState(events, "pp")?.output).toContain("子流程");
    expect(nodeState(events, "pk")).toBeDefined();

    // Product of the subprocess node = child sink value (JSON).
    const artifact = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === "pp",
    ) as Extract<RunEvent, { type: "artifact.produced" }>;
    expect(artifact.artifact.kind).toBe("json");
    expect(artifact.artifact.content).toContain("OUT-ca");
  });

  it("passes the parent's upstream text as the child's source input", async () => {
    const { plan } = compile(parentGraph());
    if (!plan) throw new Error("no plan");
    const calls: Array<{ id: string; input: string }> = [];
    const worker: Worker = {
      ...fakeWorker(),
      async *runTextGen(args) {
        calls.push({ id: (args.node as { id: string }).id, input: args.input });
        yield { type: "text-delta", text: "x" };
        return { output: "ok", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
      },
    };
    await collect(execute({ runId: "r", graph: parentGraph(), plan, worker, loadSubgraph: loadChild, now: () => 0 }));
    const childCall = calls.find((c) => c.id === "ca");
    expect(childCall?.input).toContain("测试产品");
  });

  it("fails the subprocess node when the referenced graph is missing", async () => {
    const graph = parentGraph();
    graph.nodes[1]!.subprocess = { graphId: "g-nope", maxDepth: 3 };
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(
      execute({ runId: "r", graph, plan, worker: fakeWorker(), loadSubgraph: loadChild, now: () => 0 }),
    );
    const fin = finished(events);
    expect(fin.status).toBe("failed");
    const failedEvt = events.find((e) => e.type === "node.failed" && e.nodeId === "pp") as
      | Extract<RunEvent, { type: "node.failed" }>
      | undefined;
    expect(failedEvt?.errorCode).toBe("VALIDATION");
    expect(failedEvt?.error).toContain("找不到子流程图");
  });

  it("guards mutual recursion with maxDepth", async () => {
    const graph = parentGraph();
    // Child calls itself — infinite recursion without the depth guard.
    const selfLoopGraph: Graph = {
      ...CHILD_GRAPH,
      id: "g-child-self",
      nodes: [
        { id: "cs", kind: "source", name: "子源", x: 0, y: 0, source: {} },
        { id: "cs2", kind: "subprocess", name: "递归", x: 1, y: 0, subprocess: { graphId: "g-child-self", maxDepth: 1 } },
        { id: "ck", kind: "sink", name: "子汇", x: 2, y: 0 },
      ],
      edges: [
        { id: "ce1", kind: "flow", from: "cs", to: "cs2" },
        { id: "ce2", kind: "flow", from: "cs2", to: "ck" },
      ],
    };
    graph.nodes[1]!.subprocess = { graphId: "g-child-self", maxDepth: 1 };
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(
      execute({
        runId: "r",
        graph,
        plan,
        worker: fakeWorker(),
        loadSubgraph: (id) => (id === "g-child-self" ? selfLoopGraph : null),
        now: () => 0,
      }),
    );
    const fin = finished(events);
    // The nested call fails with VALIDATION (depth exceeded) which fails the
    // outer subprocess and the run.
    expect(fin.status).toBe("failed");
    expect(events.some((e) => e.type === "node.failed" && (e as { errorCode?: string }).errorCode === "VALIDATION")).toBe(true);
  });

  it("bubbles a child halt up, then resumes exactly where the sub-flow paused", async () => {
    const graph = parentGraph();
    graph.nodes[1]!.subprocess = { graphId: "g-child-human", maxDepth: 3 };
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");

    const worker = fakeWorker();
    const pastEvents = await collect(
      execute({ runId: "r", graph, plan, worker, loadSubgraph: loadChild, now: () => 0 }),
    );
    const fin = finished(pastEvents);
    expect(fin.status).toBe("halted");
    // The halt node id carries the subprocess namespace prefix.
    expect(fin.haltedNodeId).toBe("pp#sub:ch");
    expect(fin.reason).toContain("确认文案");

    // The pending review surfaced the parent's upstream text.
    const review = pastEvents.find((e) => e.type === "human.review") as
      | Extract<RunEvent, { type: "human.review" }>
      | undefined;
    expect(review?.nodeId).toBe("pp#sub:ch");
    expect(review?.content).toContain("测试产品");

    // Approve: the child human passes, the sub-flow continues and finishes.
    const newEvents: RunEvent[] = [];
    for await (const e of resume({
      runId: "r",
      graph,
      plan,
      worker,
      loadSubgraph: loadChild,
      budgetUsd: null,
      action: "approve",
      pastEvents,
      now: () => 0,
    })) {
      newEvents.push(e);
    }
    const all = [...pastEvents, ...newEvents];
    const fin2 = finished(newEvents);
    expect(fin2.status).toBe("done");
    expect(nodeState(all, "pp")?.output).toContain("子流程");
    expect(nodeState(all, "pk")).toBeDefined();
    // The child's sink must actually run after the approve. The paused sub-flow
    // re-enters with `ch` already done, and a done predecessor whose packet was
    // never re-sent (the parent graph has no `pp#sub:ch` node, so sendPackets is
    // a no-op) used to leave `ck` pending forever — the sub-flow then reported
    // done with its sink never run, i.e. a silent drop.
    expect(nodeState(newEvents, "pp#sub:ck")).toBeDefined();
    const decision = newEvents.find((e) => e.type === "human.decision") as
      | Extract<RunEvent, { type: "human.decision" }>
      | undefined;
    expect(decision?.decision).toBe("approved");
  });

  it("rejecting a child human node fails the sub-flow (and the run without an error edge)", async () => {
    const graph = parentGraph();
    graph.nodes[1]!.subprocess = { graphId: "g-child-human", maxDepth: 3 };
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");

    const worker = fakeWorker();
    const pastEvents = await collect(
      execute({ runId: "r", graph, plan, worker, loadSubgraph: loadChild, now: () => 0 }),
    );
    expect(finished(pastEvents).status).toBe("halted");

    const newEvents: RunEvent[] = [];
    for await (const e of resume({
      runId: "r",
      graph,
      plan,
      worker,
      loadSubgraph: loadChild,
      budgetUsd: null,
      action: "reject",
      pastEvents,
      now: () => 0,
    })) {
      newEvents.push(e);
    }
    expect(finished(newEvents).status).toBe("failed");
    const failedEvt = newEvents.find((e) => e.type === "node.failed" && e.nodeId === "pp") as
      | Extract<RunEvent, { type: "node.failed" }>
      | undefined;
    expect(failedEvt?.errorCode).toBe("SUBPROCESS");
  });

  it("fails the run when the child graph itself fails", async () => {
    const graph = parentGraph();
    const badChild: Graph = {
      ...CHILD_GRAPH,
      id: "g-child-bad",
      nodes: [
        { id: "cs", kind: "source", name: "子源", x: 0, y: 0, source: {} },
        { id: "ca", kind: "textGen", name: "子代理", x: 1, y: 0, textGen: TEXTGEN },
        { id: "ck", kind: "sink", name: "子汇", x: 2, y: 0 },
      ],
      edges: [
        { id: "ce1", kind: "flow", from: "cs", to: "ca" },
        { id: "ce2", kind: "flow", from: "ca", to: "ck" },
      ],
    };
    graph.nodes[1]!.subprocess = { graphId: "g-child-bad", maxDepth: 3 };
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const worker: Worker = {
      ...fakeWorker(),
      async *runTextGen() {
        yield { type: "text-delta", text: "x" };
        throw new Error("child model blew up");
      },
    };
    const events = await collect(
      execute({
        runId: "r",
        graph,
        plan,
        worker,
        loadSubgraph: (id) => (id === "g-child-bad" ? badChild : null),
        now: () => 0,
      }),
    );
    const fin = finished(events);
    expect(fin.status).toBe("failed");
    const failedEvt = events.find((e) => e.type === "node.failed" && e.nodeId === "pp") as
      | Extract<RunEvent, { type: "node.failed" }>
      | undefined;
    expect(failedEvt?.errorCode).toBe("SUBPROCESS");
    expect(failedEvt?.error).toContain("子流程执行失败");
  });
});
