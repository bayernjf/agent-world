import { afterAll, describe, expect, it } from "vitest";
import { compile, type ConnectorConfig, type Graph } from "@agent-world/core";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const worker = () => fakeWorker({ chunkDelayMs: 0 });
const clock = () => 0;
const dir = mkdtempSync(path.join(tmpdir(), "conn-eng-"));
const agent = { model: "t", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 };

function makeGraph(connector: ConnectorConfig): Graph {
  return {
    id: "cg",
    name: "cg",
    nodes: [
      { id: "in", kind: "source", name: "IN", x: 0, y: 0, source: { connector } },
      { id: "a", kind: "agent", name: "A", x: 1, y: 0, agent },
      { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "in", to: "a", kind: "flow" },
      { id: "e2", from: "a", to: "out", kind: "flow" },
    ],
  };
}

describe("source connector (4B.5)", () => {
  it("pulls file content into the source node output", async () => {
    const f = path.join(dir, "src.txt");
    writeFileSync(f, "FROM FILE CONTENT");
    const g = makeGraph({ type: "file", file: { path: f } });
    const { plan } = compile(g);
    if (!plan) throw new Error("no plan");
    const events: unknown[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan, worker: worker(), budgetUsd: null, now: clock })) {
      events.push(e);
    }
    const src = events.find(
      (e) => (e as { type: string }).type === "node.finished" && (e as { nodeId: string }).nodeId === "in",
    ) as { output: string } | undefined;
    expect(src?.output).toContain("FROM FILE CONTENT");
  });

  it("fails the run with a CONNECTOR error when the connector is unreachable", async () => {
    const g = makeGraph({ type: "http", http: { url: "http://127.0.0.1:1/", method: "GET" } });
    const { plan } = compile(g);
    if (!plan) throw new Error("no plan");
    const events: unknown[] = [];
    for await (const e of execute({
      runId: "r",
      graph: g,
      plan,
      worker: worker(),
      budgetUsd: null,
      now: clock,
      sleep: async () => {},
    })) {
      events.push(e);
    }
    const failed = events.find(
      (e) => (e as { type: string }).type === "node.failed" && (e as { nodeId: string }).nodeId === "in",
    ) as { errorCode?: string } | undefined;
    expect(failed?.errorCode).toBe("CONNECTOR");
  });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
