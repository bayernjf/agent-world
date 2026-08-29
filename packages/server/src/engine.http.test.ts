import { compile, replay, type Graph } from "@agent-world/core";
import { describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function graph(http: NonNullable<Graph["nodes"][number]["http"]>): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "api", kind: "http", name: "API", x: 1, y: 0, http },
      { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "api", kind: "flow" },
      { id: "e2", from: "api", to: "out", kind: "flow" },
    ],
  };
}

describe("http node", () => {
  it("GETs a JSON endpoint and produces a json artifact", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, count: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const g = graph({ method: "GET", url: "https://api.example.com/data", outputMode: "auto" });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }

    const state = replay(events);
    expect(state.status).toBe("done");
    expect(spy).toHaveBeenCalledWith("https://api.example.com/data", expect.objectContaining({ method: "GET" }));

    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "api");
    expect(finished.output).toBe(JSON.stringify({ ok: true, count: 3 }, null, 2));

    const arti = events.find((e) => e.type === "artifact.produced" && e.nodeId === "api")?.artifact;
    expect(arti?.kind).toBe("json");

    spy.mockRestore();
  });

  it("POSTs with interpolated body, headers and query", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"received":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const g = graph({
      method: "POST",
      url: "https://api.example.com/items",
      headers: { "authorization": "Bearer ${src}", "content-type": "application/json" },
      query: { "category": "${src}" },
      body: '{"payload":"${src}"}',
      outputMode: "json",
    });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({
      runId: "r",
      graph: g,
      plan: plan!,
      worker: fakeWorker(),
      budgetUsd: null,
      now: () => 0,
      input: "SEED-TOKEN",
    })) {
      events.push(e);
    }

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe("https://api.example.com/items?category=SEED-TOKEN");
    expect(init?.headers).toEqual({
      authorization: "Bearer SEED-TOKEN",
      "content-type": "application/json",
    });
    expect(init?.body).toBe('{"payload":"SEED-TOKEN"}');
    expect(replay(events).status).toBe("done");

    spy.mockRestore();
  });

  it("fails the node on non-2xx when failOnError is true", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad request", { status: 400, headers: { "content-type": "text/plain" } }),
    );

    const g = graph({ method: "GET", url: "https://api.example.com/bad", failOnError: true });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "api");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
    expect(replay(events).status).toBe("failed");

    spy.mockRestore();
  });

  it("treats non-2xx as success when failOnError is false", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("accepted", { status: 202, headers: { "content-type": "text/plain" } }),
    );

    const g = graph({ method: "POST", url: "https://api.example.com/ok", failOnError: false });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "api")).toBe(true);
    expect(replay(events).status).toBe("done");

    spy.mockRestore();
  });
});
