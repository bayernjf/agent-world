import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerConfig, type Graph } from "@agent-world/core";
import { TriggerService, type StartRunFn, type TriggerGraphStore } from "./triggers.js";
import { TriggerScheduler } from "./scheduler.js";

function makeStore(graph: Graph) {
  const graphs = new Map<string, Graph & { version: number }>();
  graphs.set(graph.id, { ...graph, version: 1 });
  const store: TriggerGraphStore = {
    listAllGraphs: () =>
      [...graphs.values()].map((g) => ({ id: g.id, name: g.name, version: g.version, updated_at: 0 })),
    getGraphById: (id) => graphs.get(id) ?? null,
    saveGraphUnscoped: (g) => {
      graphs.set(g.id, { ...g, version: (graphs.get(g.id)?.version ?? 0) + 1 });
      return { ok: true, version: 1 };
    },
  };
  return store;
}

function makeService(graph: Graph) {
  const store = makeStore(graph);
  const calls: Array<{ trigger: string; graphId: string }> = [];
  const startRun: StartRunFn = (graphArg, opts) => {
    calls.push({ trigger: opts.trigger, graphId: graphArg.id });
    return Promise.resolve({ runId: "r" });
  };
  const service = new TriggerService({ db: store, startRun });
  service.restore();
  return { service, calls };
}

describe("TriggerScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("computes the next run for a cron trigger", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const trigger = TriggerConfig.parse({ id: "c3", type: "cron", cron: "0 0 * * 0" }); // Sundays
    const { service } = makeService({ id: "g1", name: "G", nodes: [], edges: [], triggers: [trigger] });
    const scheduler = new TriggerScheduler(service);
    scheduler.start();
    // Thursday 2026-01-01 -> next Sunday 2026-01-04.
    expect(scheduler.nextRunAt("c3")).toBe(new Date("2026-01-04T00:00:00Z").getTime());
    scheduler.stop();
  });

  it("does not schedule disabled cron triggers", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const trigger = TriggerConfig.parse({ id: "c2", type: "cron", cron: "0 0 * * *", enabled: false });
    const { service, calls } = makeService({ id: "g1", name: "G", nodes: [], edges: [], triggers: [trigger] });
    const scheduler = new TriggerScheduler(service);
    scheduler.start();
    expect(scheduler.nextRunAt("c2")).toBeUndefined();
    scheduler.stop();
    expect(calls).toHaveLength(0);
  });

  it("fires a cron trigger at its scheduled time and reschedules", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const trigger = TriggerConfig.parse({ id: "c1", type: "cron", cron: "0 0 * * *" });
    const { service, calls } = makeService({ id: "g1", name: "G", nodes: [], edges: [], triggers: [trigger] });
    const scheduler = new TriggerScheduler(service);
    scheduler.start();

    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); // to 2026-01-02T00:00
    expect(calls).toHaveLength(1);
    expect(calls[0].trigger).toBe("c1");

    // Re-armed for the following day.
    expect(scheduler.nextRunAt("c1")).toBeGreaterThan(Date.now());
    scheduler.stop();
  });

  it("re-arms when a trigger is synced after an update", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const trigger = TriggerConfig.parse({ id: "c4", type: "cron", cron: "0 0 1 1 *" }); // Jan 1
    const { service } = makeService({ id: "g1", name: "G", nodes: [], edges: [], triggers: [trigger] });
    const scheduler = new TriggerScheduler(service);
    scheduler.start();
    // From 2026-01-01T00:00 -> next Jan 1 is 2027-01-01.
    expect(scheduler.nextRunAt("c4")).toBe(new Date("2027-01-01T00:00:00Z").getTime());

    const updated = TriggerConfig.parse({ id: "c4", type: "cron", cron: "0 * * * *" }); // hourly
    service.upsert("g1", updated);
    scheduler.sync(updated);
    // Next hour from 2026-01-01T00:00 is 01:00.
    expect(scheduler.nextRunAt("c4")).toBe(new Date("2026-01-01T01:00:00Z").getTime());
    scheduler.stop();
  });
});
