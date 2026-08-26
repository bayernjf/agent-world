import { describe, expect, it } from "vitest";
import { TriggerConfig, type Graph } from "@agent-world/core";
import { TriggerService, TriggerError, type StartRunFn, type TriggerGraphStore } from "./triggers.js";

function makeStore(initial: Graph[] = []) {
  const graphs = new Map<string, Graph & { version: number }>();
  for (const g of initial) graphs.set(g.id, { ...g, version: 1 });
  // Seed empty graphs so upsert() can target them (the real DB always has the
  // graph doc before a trigger is attached).
  for (const id of ["g1", "g2"]) {
    if (!graphs.has(id)) graphs.set(id, { id, name: id, nodes: [], edges: [], version: 1 });
  }
  const store: TriggerGraphStore = {
    listGraphs: () =>
      [...graphs.values()].map((g) => ({ id: g.id, name: g.name, version: g.version, updated_at: 0 })),
    getGraph: (id) => graphs.get(id) ?? null,
    saveGraph: (graph) => {
      graphs.set(graph.id, { ...graph, version: (graphs.get(graph.id)?.version ?? 0) + 1 });
      return { ok: true, version: 1 };
    },
  };
  return store;
}

function makeService(initial: Graph[] = []) {
  const store = makeStore(initial);
  const calls: Array<{ graphId: string; opts: Parameters<StartRunFn>[1] }> = [];
  let n = 0;
  const startRun: StartRunFn = (graph, opts) => {
    calls.push({ graphId: graph.id, opts });
    return Promise.resolve({ runId: `run-${++n}` });
  };
  const service = new TriggerService({ db: store, startRun });
  service.restore();
  return { service, calls, store };
}

const webhookTrigger = TriggerConfig.parse({ id: "t1", type: "webhook", webhookSecret: "s3cr3t" });
const cronTrigger = TriggerConfig.parse({ id: "t2", type: "cron", cron: "0 * * * *" });

function graphWith(triggers: Graph["triggers"]): Graph {
  return { id: "g1", name: "G", nodes: [], edges: [], triggers };
}

describe("TriggerService", () => {
  it("registers, lists, and filters triggers by graph", () => {
    const { service } = makeService();
    service.upsert("g1", webhookTrigger);
    service.upsert("g1", cronTrigger);
    service.upsert("g2", TriggerConfig.parse({ id: "t3", type: "event", eventSource: { kind: "graph", id: "g1" } }));

    expect(service.list().map((t) => t.id).sort()).toEqual(["t1", "t2", "t3"]);
    expect(service.listByGraph("g1").map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(service.listByGraph("g2").map((t) => t.id)).toEqual(["t3"]);
  });

  it("persists triggers into the graph document", () => {
    const { store } = makeService();
    const service = new TriggerService({ db: store, startRun: () => Promise.resolve({ runId: "x" }) });
    service.upsert("g1", webhookTrigger);
    expect(store.getGraph("g1")?.triggers?.map((t) => t.id)).toEqual(["t1"]);
  });

  it("restores the index from persisted graphs on startup", () => {
    const { service } = makeService([graphWith([webhookTrigger, cronTrigger])]);
    expect(service.list().map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(service.listByGraph("g1")).toHaveLength(2);
  });

  it("fires a trigger and passes an object payload as source input", async () => {
    const { service, calls } = makeService([graphWith([webhookTrigger])]);
    const res = await service.fire("t1", { hello: "world" });
    expect(res.runId).toBe("run-1");
    expect(calls[0].graphId).toBe("g1");
    expect(calls[0].opts.trigger).toBe("t1");
    expect(calls[0].opts.input).toBe(JSON.stringify({ hello: "world" }));
  });

  it("fires with a string payload verbatim", async () => {
    const { service, calls } = makeService([graphWith([cronTrigger])]);
    await service.fire("t2", "raw text");
    expect(calls[0].opts.input).toBe("raw text");
  });

  it("validates the webhook secret and starts a run", async () => {
    const { service, calls } = makeService([graphWith([webhookTrigger])]);
    const res = await service.fireWebhook("g1", "s3cr3t", "payload");
    expect(res.runId).toBe("run-1");
    expect(calls[0].opts.input).toBe("payload");
  });

  it("rejects an invalid webhook secret with 401", async () => {
    const { service } = makeService([graphWith([webhookTrigger])]);
    await expect(service.fireWebhook("g1", "wrong", "x")).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a webhook for a graph with no matching trigger", async () => {
    const { service } = makeService([graphWith([])]);
    await expect(service.fireWebhook("g1", "s3cr3t", "x")).rejects.toBeInstanceOf(TriggerError);
  });

  it("removes a trigger and persists the change", async () => {
    const { service, store } = makeService([graphWith([webhookTrigger, cronTrigger])]);
    await service.remove("g1", "t1");
    expect(service.listByGraph("g1").map((t) => t.id)).toEqual(["t2"]);
    expect(store.getGraph("g1")?.triggers?.map((t) => t.id)).toEqual(["t2"]);
  });

  it("errors on an unknown trigger", async () => {
    const { service } = makeService();
    await expect(service.fire("nope")).rejects.toBeInstanceOf(TriggerError);
  });
});

describe("TriggerService events (4A.5)", () => {
  it("fires a graph-completion event trigger subscribed to that graph", async () => {
    const { service, calls } = makeService([
      graphWith([TriggerConfig.parse({ id: "ev1", type: "event", eventSource: { kind: "graph", id: "g1" } })]),
    ]);
    await service.onGraphFinished("g1", "completed");
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.trigger).toBe("ev1");
  });

  it("does not fire on a non-completed status", async () => {
    const { service, calls } = makeService([
      graphWith([TriggerConfig.parse({ id: "ev1", type: "event", eventSource: { kind: "graph", id: "g1" } })]),
    ]);
    await service.onGraphFinished("g1", "failed");
    expect(calls).toHaveLength(0);
  });

  it("fires a subscriber graph's trigger when the source graph finishes", async () => {
    // g2 holds the event trigger; g1 (auto-seeded) is the source it listens to.
    const { service, calls } = makeService([
      { id: "g2", name: "G2", nodes: [], edges: [], triggers: [TriggerConfig.parse({ id: "ev2", type: "event", eventSource: { kind: "graph", id: "g1" } })] },
    ]);
    await service.onGraphFinished("g1", "completed");
    expect(calls).toHaveLength(1);
    expect(calls[0].graphId).toBe("g2");
  });

  it("fires artifact event triggers by artifact id", async () => {
    const { service, calls } = makeService([
      graphWith([TriggerConfig.parse({ id: "ev3", type: "event", eventSource: { kind: "artifact", id: "art-9" } })]),
    ]);
    await service.onArtifact("art-9");
    expect(calls).toHaveLength(1);
    await service.onArtifact("art-other");
    expect(calls).toHaveLength(1);
  });
});

describe("TriggerService batch (4A.6)", () => {
  it("starts one run per row in the batch config", async () => {
    const trigger = TriggerConfig.parse({
      id: "b1",
      type: "batch",
      batch: { source: "rows", rows: [{ a: "1" }, { a: "2" }, { a: "3" }] },
    });
    const { service, calls } = makeService([graphWith([trigger])]);
    const runIds = await service.fireBatch("b1");
    expect(runIds).toHaveLength(3);
    expect(calls).toHaveLength(3);
    expect(calls[0].opts.input).toBe(JSON.stringify({ a: "1" }));
  });

  it("uses an explicit payload array over the stored rows", async () => {
    const trigger = TriggerConfig.parse({
      id: "b2",
      type: "batch",
      batch: { source: "rows", rows: [{ a: "1" }] },
    });
    const { service, calls } = makeService([graphWith([trigger])]);
    const runIds = await service.fireBatch("b2", [{ x: "9" }, { x: "8" }]);
    expect(runIds).toHaveLength(2);
    expect(calls[0].opts.input).toBe(JSON.stringify({ x: "9" }));
  });

  it("rejects firing a non-batch trigger as a batch", async () => {
    const { service } = makeService([graphWith([webhookTrigger])]);
    await expect(service.fireBatch("t1")).rejects.toMatchObject({ status: 400 });
  });
});

describe("TriggerService nextRunMap (4A.7 UI)", () => {
  it("maps only cron trigger ids to their next fire time", () => {
    const { service } = makeService([graphWith([cronTrigger, webhookTrigger])]);
    const map = service.nextRunMap("g1");
    expect(Object.keys(map).sort()).toEqual(["t2"]);
    expect(typeof map["t2"]).toBe("number");
    expect(map["t1"]).toBeUndefined();
  });

  it("returns an empty map when there are no cron triggers", () => {
    const { service } = makeService([graphWith([webhookTrigger])]);
    expect(service.nextRunMap("g1")).toEqual({});
  });
});
