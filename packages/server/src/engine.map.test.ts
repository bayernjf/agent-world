import { compile, replay, type Graph, type MapConfig } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function graph(map: MapConfig, code: string): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      {
        id: "code",
        kind: "code",
        name: "CODE",
        x: 1,
        y: 0,
        code: { language: "javascript", code, timeoutMs: 5000 },
      },
      { id: "map", kind: "map", name: "MAP", x: 2, y: 0, map },
      { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "code", kind: "flow" },
      { id: "e2", from: "code", to: "map", kind: "flow" },
      { id: "e3", from: "map", to: "sink", kind: "flow" },
    ],
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
    now: () => 0,
    input,
  })) {
    events.push(e);
  }
  return events;
}

function jsonOf(events: any[], nodeId: string): string | undefined {
  return events.find(
    (e) => e.type === "artifact.produced" && e.nodeId === nodeId && e.artifact.kind === "json",
  )?.artifact.content;
}

describe("map node", () => {
  it("maps a single source object with ${item} placeholders, keeping types for pure placeholders", async () => {
    const events = await collect(
      graph(
        { template: '{"label": "${item.name}", "age": "${item.age}", "addr": "${item.addr}"}' },
        'console.log(JSON.stringify({ name: "Alice", age: 30, addr: { city: "杭州" } }))',
      ),
    );
    expect(replay(events).status).toBe("done");
    expect(JSON.parse(jsonOf(events, "map")!)).toEqual({
      label: "Alice",
      age: 30,
      addr: { city: "杭州" },
    });
  });

  it("iterates an array and emits one transformed copy per element", async () => {
    const events = await collect(
      graph(
        { iterate: "items", template: '{"title": "${item.name}", "price": "${item.price}"}' },
        'console.log(JSON.stringify({ items: [{ name: "a", price: 1 }, { name: "b", price: 2 }] }))',
      ),
    );
    expect(replay(events).status).toBe("done");
    expect(JSON.parse(jsonOf(events, "map")!)).toEqual([
      { title: "a", price: 1 },
      { title: "b", price: 2 },
    ]);
  });

  it("fails with VALIDATION when the iterate path is not an array", async () => {
    const events = await collect(
      graph({ iterate: "items", template: "{}" }, 'console.log(JSON.stringify({ items: "nope" }))'),
    );
    expect(replay(events).status).toBe("failed");
    expect(
      events.some(
        (e) => e.type === "node.failed" && e.nodeId === "map" && e.errorCode === "VALIDATION",
      ),
    ).toBe(true);
  });

  it("fails with VALIDATION when the template is not valid JSON", async () => {
    const events = await collect(
      graph({ template: "{ not json" }, 'console.log(JSON.stringify({ ok: true }))'),
    );
    expect(replay(events).status).toBe("failed");
    expect(
      events.some(
        (e) => e.type === "node.failed" && e.nodeId === "map" && e.errorCode === "VALIDATION",
      ),
    ).toBe(true);
  });
});
