import { compile, replay, type Graph, type TranslateConfig } from "@agent-world/core";
import { describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker, type Worker } from "./worker.js";

interface Store {
  storeBinary: (data: Buffer, mimeType: string, label?: string) => string;
  readArtifact: (uri: string) => Promise<string | null>;
}

function artifactStore(): Store {
  const map = new Map<string, string>();
  let n = 0;
  return {
    storeBinary(data: Buffer, mimeType: string, _label?: string) {
      const id = `/api/artifacts/art-${++n}`;
      map.set(id, `data:${mimeType};base64,${data.toString("base64")}`);
      return id;
    },
    async readArtifact(uri: string) {
      return map.get(uri) ?? null;
    },
  };
}

async function collect(g: Graph, store: Store, input?: string, worker: Worker = fakeWorker()) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker,
    budgetUsd: null,
    now: () => 0,
    input,
    storeBinary: store.storeBinary,
    readArtifact: store.readArtifact,
  })) {
    events.push(e);
  }
  return events;
}

function textOf(events: any[], nodeId: string): string | undefined {
  return events.find((e) => e.type === "artifact.produced" && e.nodeId === nodeId)?.artifact.content;
}

const INPUT = "你好，世界！";

function baseGraph(tr: TranslateConfig, extraNodes: Graph["nodes"], extraEdges: Graph["edges"]): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      ...extraNodes,
      { id: "tr", kind: "translate", name: "TRANSLATE", x: 1, y: 0, translate: tr },
      { id: "sink", kind: "sink", name: "SINK", x: 2, y: 0 },
    ],
    edges: [...extraEdges, { id: "e2", from: "tr", to: "sink", kind: "flow" }],
  };
}

describe("translate node — LLM translation", () => {
  it("translates the upstream text into a text artifact", async () => {
    const store = artifactStore();
    const g = baseGraph(
      { target: "English" },
      [],
      [{ id: "e1", from: "src", to: "tr", kind: "flow" }],
    );
    const events = await collect(g, store, INPUT);
    expect(replay(events).status).toBe("done");
    expect(events.find((e) => e.type === "node.finished" && e.nodeId === "tr")).toBeTruthy();
    const out = textOf(events, "tr");
    expect(out).toContain(`consuming ${INPUT.length} chars of input`);
    // Cost accounting ran for the LLM call.
    expect(events.some((e) => e.type === "power.metered" && e.totalCostUsd > 0)).toBe(true);
    // Packet forwarded downstream.
    expect(events.some((e) => e.type === "packet.sent" && e.from === "tr" && e.to === "sink")).toBe(true);
  });

  it("uses an explicit source even with multiple upstreams", async () => {
    const store = artifactStore();
    const g = baseGraph(
      { source: "src", target: "日本語", model: "m-x", temperature: 0.1 },
      [{ id: "other", kind: "source", name: "OTHER", x: 0, y: 1 }],
      [
        { id: "e1", from: "src", to: "tr", kind: "flow" },
        { id: "e1b", from: "other", to: "tr", kind: "flow" },
      ],
    );
    const events = await collect(g, store, INPUT);
    expect(replay(events).status).toBe("done");
    expect(textOf(events, "tr")).toContain("consuming");
  });

  it("fails with VALIDATION when no unique upstream is configured", async () => {
    const store = artifactStore();
    const g = baseGraph(
      {},
      [{ id: "other", kind: "source", name: "OTHER", x: 0, y: 1 }],
      [
        { id: "e1", from: "src", to: "tr", kind: "flow" },
        { id: "e1b", from: "other", to: "tr", kind: "flow" },
      ],
    );
    const events = await collect(g, store, INPUT);
    expect(replay(events).status).toBe("failed");
    expect(
      events.some((e) => e.type === "node.failed" && e.nodeId === "tr" && e.errorCode === "VALIDATION"),
    ).toBe(true);
  });

  it("fails with VALIDATION when the upstream produces no text", async () => {
    const store = artifactStore();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from("fake document bytes"), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        { id: "dl", kind: "http", name: "DL", x: 1, y: 0, http: { url: "https://files.example.com/doc.bin", outputMode: "file" } },
        { id: "tr", kind: "translate", name: "TRANSLATE", x: 2, y: 0, translate: { target: "English" } },
        { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "dl", kind: "flow" },
        { id: "e2", from: "dl", to: "tr", kind: "flow" },
        { id: "e3", from: "tr", to: "sink", kind: "flow" },
      ],
    };
    try {
      const events = await collect(g, store);
      expect(replay(events).status).toBe("failed");
      expect(
        events.some((e) => e.type === "node.failed" && e.nodeId === "tr" && e.errorCode === "VALIDATION"),
      ).toBe(true);
    } finally {
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("fails with PROVIDER_ERROR when the model returns an empty translation", async () => {
    // A 200 response can carry no text (openai-compatible falls back to
    // `msg.content ?? ""`). Publishing that as a translation meant the run
    // reported done with nothing translated — same contract as textGen.
    const store = artifactStore();
    const worker: Worker = {
      ...fakeWorker(),
      async *runTextGen() {
        return { output: "", usage: { tokensIn: 1, tokensOut: 0, costUsd: 0 } };
      },
    };
    const g = baseGraph(
      { target: "English" },
      [],
      [{ id: "e1", from: "src", to: "tr", kind: "flow" }],
    );
    const events = await collect(g, store, INPUT, worker);
    expect(replay(events).status).toBe("failed");
    expect(
      events.some((e) => e.type === "node.failed" && e.nodeId === "tr" && e.errorCode === "PROVIDER_ERROR"),
    ).toBe(true);
    expect(textOf(events, "tr")).toBeUndefined();
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "sink")).toBe(false);
  });
});
