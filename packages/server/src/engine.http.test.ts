import { compile, replay, type Graph } from "@agent-world/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  // Existing tests use hostnames that resolve unpredictably in CI; keep the
  // legacy behavior (no SSRF check) for them. The SSRF guard has its own
  // describe block below that exercises the check explicitly.
  beforeEach(() => vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1"));
  afterEach(() => vi.unstubAllEnvs());

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

describe("http node SSRF guard", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a loopback target without calling fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const g = graph({ method: "GET", url: "http://127.0.0.1:8080/internal" });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "api");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("VALIDATION");
    expect(spy).not.toHaveBeenCalled();
    expect(replay(events).status).toBe("failed");
    spy.mockRestore();
  });

  it("refuses the cloud metadata link-local address", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const g = graph({ method: "GET", url: "http://169.254.169.254/latest/meta-data/" });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "api")).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("allows a public IP", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ping: "pong" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const g = graph({ method: "GET", url: "http://8.8.8.8/ping" });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "api")).toBe(true);
    expect(spy).toHaveBeenCalledWith("http://8.8.8.8/ping", expect.anything());
    spy.mockRestore();
  });

  it("ALLOW_PRIVATE_NETWORK=1 bypasses the check", async () => {
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const g = graph({ method: "GET", url: "http://127.0.0.1:8080/intranet" });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "api")).toBe(true);
    expect(spy).toHaveBeenCalledWith("http://127.0.0.1:8080/intranet", expect.anything());
    spy.mockRestore();
  });

  it("refuses a redirect that lands on an internal address (audit C3)", async () => {
    // First hop: public IP answers 302 -> cloud metadata. The guard must
    // reject the *second* hop before any request to it is sent.
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
      )
      .mockResolvedValue(new Response("leak", { status: 200 }));
    const g = graph({ method: "GET", url: "http://8.8.8.8/redirect" });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "api");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("VALIDATION");
    // Only the initial public request went out; the internal hop never did.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(replay(events).status).toBe("failed");
    spy.mockRestore();
  });

  it("follows legitimate redirects and produces the final response", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/hop2" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ hop: 2 }), { status: 200, headers: { "content-type": "application/json" } }),
      );
    const g = graph({ method: "GET", url: "http://8.8.8.8/hop1", outputMode: "auto" });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }

    expect(replay(events).status).toBe("done");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]![0]).toBe("http://8.8.8.8/hop2");
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "api");
    expect(finished.output).toBe(JSON.stringify({ hop: 2 }, null, 2));
    spy.mockRestore();
  });

  it("strips Authorization when a redirect crosses origins", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://9.9.9.9/elsewhere" } }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const g = graph({
      method: "GET",
      url: "http://8.8.8.8/auth",
      headers: { authorization: "Bearer secret-token", "x-custom": "keep-me" },
    });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }

    expect(replay(events).status).toBe("done");
    const secondInit = spy.mock.calls[1]![1] as { headers: Record<string, string> };
    expect(secondInit.headers["authorization"]).toBeUndefined();
    expect(secondInit.headers["x-custom"]).toBe("keep-me");
    spy.mockRestore();
  });

  it("gives up after 5 redirects", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url.toString();
        const hop = Number(/\/hop(\d+)/.exec(u)?.[1] ?? 0) + 1;
        return new Response(null, { status: 302, headers: { location: `/hop${hop}` } });
      });
    const g = graph({ method: "GET", url: "http://8.8.8.8/hop1" });
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker: fakeWorker(), budgetUsd: null, now: () => 0 })) {
      events.push(e);
    }

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "api");
    expect(failed).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(6); // initial + 5 hops
    expect(replay(events).status).toBe("failed");
    spy.mockRestore();
  });
});
