import { compile, replay, type Graph } from "@agent-world/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function store() {
  const map = new Map<string, string>();
  return {
    storeBinary(data: Buffer, mime: string, _l?: string) {
      const id = `/api/artifacts/art-${map.size + 1}`;
      map.set(id, `data:${mime};base64,${data.toString("base64")}`);
      return id;
    },
    async readArtifact(uri: string) {
      return map.get(uri) ?? null;
    },
  };
}

async function collect(g: Graph, input?: string) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    input,
    now: () => 0,
    ...store(),
  })) {
    events.push(e);
  }
  return events;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * source → http (may fail) → agent; http also has an error edge to a catch
 * agent that produces a fallback message. sink receives whichever agent ran.
 */
function catchGraph() {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "dl", kind: "http", name: "DL", x: 1, y: 0, http: { url: "https://x.example.com/api", method: "GET", retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } } },
      { id: "happy", kind: "textGen", name: "HAPPY", x: 2, y: -1, textGen: { model: "m", prompt: "summarise the upstream", skills: [], temperature: 0.7, timeoutMs: 60000, inputPolicy: { mode: "all" } } },
      { id: "catch", kind: "textGen", name: "CATCH", x: 2, y: 1, textGen: { model: "m", prompt: "the upstream failed; produce a fallback message from the error detail", skills: [], temperature: 0.7, timeoutMs: 60000, inputPolicy: { mode: "all" } } },
      { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "dl", kind: "flow" },
      { id: "e2", from: "dl", to: "happy", kind: "flow" },
      { id: "e3", from: "dl", to: "catch", kind: "error" },
      { id: "e4", from: "happy", to: "sink", kind: "flow" },
      { id: "e5", from: "catch", to: "sink", kind: "flow" },
    ],
  } as Graph;
}

describe("error handling — error edges + catch node", () => {
  it("routes a failed node to its catch branch and finishes done", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));
    const events = await collect(catchGraph());
    expect(replay(events).status).toBe("done");
    // dl failed, happy skipped (its flow pred failed, no catch on happy).
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "dl")).toBe(true);
    expect(events.some((e) => e.type === "node.skipped" && e.nodeId === "happy")).toBe(true);
    // catch ran and produced output.
    const catchFinished = events.find((e) => e.type === "node.finished" && e.nodeId === "catch");
    expect(catchFinished).toBeTruthy();
    // An error packet travelled dl → catch.
    expect(events.some((e) => e.type === "packet.sent" && e.from === "dl" && e.to === "catch")).toBe(true);
    // The merge sink ran on the failure path (via catch).
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "sink")).toBe(true);
  });

  it("runs the happy branch when the node succeeds (no error packet)", async () => {
    fetchMock.mockResolvedValue(new Response("ok data", { status: 200 }));
    const events = await collect(catchGraph());
    expect(replay(events).status).toBe("done");
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "happy")).toBe(true);
    // catch never ran — no error packet.
    expect(events.some((e) => e.type === "packet.sent" && e.from === "dl" && e.to === "catch")).toBe(false);
    expect(events.some((e) => e.type === "node.started" && e.nodeId === "catch")).toBe(false);
    // The dead catch is skipped, not left pending, so the merge sink still runs.
    expect(events.some((e) => e.type === "node.skipped" && e.nodeId === "catch")).toBe(true);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "sink")).toBe(true);
  });

  it("a fan-in merge still runs when one flow predecessor failed but was caught", async () => {
    // tpl-doc-ingest shape: source → src → { parse → merge, dl → merge } with
    // dl also carrying an error edge to a catch node that feeds the SAME merge.
    // Before the fix the merge waited for the failed predecessor forever and
    // the run still reported done — a silent drop with no sink output.
    const g = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        { id: "parse", kind: "textGen", name: "PARSE", x: 1, y: -1, textGen: { model: "m", prompt: "pass upstream through", skills: [], temperature: 0.7, timeoutMs: 60000, inputPolicy: { mode: "all" } } },
        { id: "dl", kind: "http", name: "DL", x: 1, y: 1, http: { url: "https://x.example.com/api", method: "GET", retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } } },
        { id: "catch", kind: "textGen", name: "CATCH", x: 2, y: 2, textGen: { model: "m", prompt: "fallback for the failed download", skills: [], temperature: 0.7, timeoutMs: 60000, inputPolicy: { mode: "all" } } },
        { id: "merge", kind: "sink", name: "MERGE", x: 3, y: 0 },
      ],
      edges: [
        { id: "e0", from: "src", to: "parse", kind: "flow" },
        { id: "e1", from: "src", to: "dl", kind: "flow" },
        { id: "e2", from: "parse", to: "merge", kind: "flow" },
        { id: "e3", from: "dl", to: "merge", kind: "flow" },
        { id: "e4", from: "dl", to: "catch", kind: "error" },
        { id: "e5", from: "catch", to: "merge", kind: "flow" },
      ],
    } as Graph;
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));
    const events = await collect(g);
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "dl")).toBe(true);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "catch")).toBe(true);
    // The merge must run despite the failed dl input.
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "merge")).toBe(true);
    expect(replay(events).status).toBe("done");
  });
});
