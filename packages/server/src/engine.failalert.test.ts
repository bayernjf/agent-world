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

function failGraph() {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "dl", kind: "http", name: "DL", x: 1, y: 0, http: { url: "https://x.example.com/missing", method: "GET", retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } } },
      { id: "sink", kind: "sink", name: "SINK", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "dl", kind: "flow" },
      { id: "e2", from: "dl", to: "sink", kind: "flow" },
    ],
  } as Graph;
}

describe("failure alerting — RUN_FAILED_WEBHOOK", () => {
  it("POSTs a run.failed alert with failed node detail when the run fails", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));
    vi.stubEnv("RUN_FAILED_WEBHOOK", "https://hooks.example.com/failed");
    const events = await collect(failGraph());
    expect(replay(events).status).toBe("failed");
    const alertCall = fetchMock.mock.calls.find(([url]) => String(url).includes("hooks.example.com"));
    expect(alertCall).toBeTruthy();
    const body = JSON.parse(String((alertCall![1] as any)?.body));
    expect(body.event).toBe("run.failed");
    expect(body.failedNodes).toEqual([
      expect.objectContaining({ nodeId: "dl", error: expect.any(String), errorCode: "PROVIDER_ERROR" }),
    ]);
    expect(body.skippedCount).toBe(1); // sink skipped behind dl
  });

  it("sends no alert when the run succeeds", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubEnv("RUN_FAILED_WEBHOOK", "https://hooks.example.com/failed");
    const events = await collect(failGraph());
    expect(replay(events).status).toBe("done");
    const alert = fetchMock.mock.calls.some(([url]) => String(url).includes("hooks.example.com"));
    expect(alert).toBe(false);
  });

  it("no alert if RUN_FAILED_WEBHOOK is unset", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 502 }));
    const events = await collect(failGraph());
    expect(replay(events).status).toBe("failed");
    const alert = fetchMock.mock.calls.some(([url]) => String(url).includes("hooks.example.com"));
    expect(alert).toBe(false);
  });
});
