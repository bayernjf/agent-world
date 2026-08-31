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

/** A graph where an http node downloads a URL; feeding a downstream agent + sink. */
function downloadGraph(url: string) {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "dl", kind: "http", name: "DL", x: 1, y: 0, http: { url, method: "GET", retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } } },
      { id: "agent", kind: "textGen", name: "TEXTGEN", x: 2, y: 0, textGen: { model: "m", prompt: "summarise", skills: [], temperature: 0.7, timeoutMs: 60000, inputPolicy: { mode: "all" } } },
      { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "dl", kind: "flow" },
      { id: "e2", from: "dl", to: "agent", kind: "flow" },
      { id: "e3", from: "agent", to: "sink", kind: "flow" },
    ],
  } as Graph;
}

describe("error handling — cascade skip", () => {
  it("skips nodes stranded behind a failed predecessor and emits node.skipped", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));
    const events = await collect(downloadGraph("https://x.example.com/missing"));
    expect(replay(events).status).toBe("failed");
    const dlFailed = events.some((e) => e.type === "node.failed" && e.nodeId === "dl");
    expect(dlFailed).toBe(true);
    const skipped = events.filter((e) => e.type === "node.skipped").map((e: any) => e.nodeId);
    expect(skipped).toEqual(expect.arrayContaining(["agent", "sink"]));
    // No idle/pending nodes left behind — they're all terminal.
    const final = replay(events);
    expect(Object.values(final.nodes).every((n: any) => n.status !== "idle")).toBe(true);
  });

  it("does not skip a merge point that still has a done predecessor", async () => {
    // Two sources → merge node. One branch's http fails; the merge still runs
    // because the other source is done (independent input).
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src1", kind: "source", name: "S1", x: 0, y: 0 },
        { id: "src2", kind: "source", name: "S2", x: 0, y: 2 },
        { id: "dl1", kind: "http", name: "DL1", x: 1, y: 0, http: { url: "https://x.example.com/fail", method: "GET", retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } } },
        { id: "dl2", kind: "http", name: "DL2", x: 1, y: 2, http: { url: "https://x.example.com/ok", method: "GET", retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } } },
        { id: "merge", kind: "parallel", name: "MERGE", x: 2, y: 1, parallel: { asObject: false } },
        { id: "sink", kind: "sink", name: "SINK", x: 3, y: 1 },
      ],
      edges: [
        { id: "e1", from: "src1", to: "dl1", kind: "flow" },
        { id: "e2", from: "src2", to: "dl2", kind: "flow" },
        { id: "e3", from: "dl1", to: "merge", kind: "flow" },
        { id: "e4", from: "dl2", to: "merge", kind: "flow" },
        { id: "e5", from: "merge", to: "sink", kind: "flow" },
      ],
    };
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/ok")) return new Response("ok", { status: 200 });
      return new Response(null, { status: 502 });
    });
    const events = await collect(g);
    // dl1 failed; merge is NOT skipped because dl2 succeeded (hasDone → cascade guard).
    // (merge won't run either — predecessorsReady needs all flow preds done; that's
    // the error-edge PR's job. Here we only assert no false skip.)
    const mergeSkipped = events.some((e) => e.type === "node.skipped" && e.nodeId === "merge");
    expect(mergeSkipped).toBe(false);
  });
});
