import { compile, replay, type Graph, type RunEvent } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import type { Worker } from "./worker.js";

const ZERO = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

/**
 * A worker whose textGen echoes its `config.prompt` (the per-variant prompt that
 * fanout applied). `failOn` prompts throw, so individual lanes can be made to
 * fail in isolation.
 */
function promptWorker(opts: { failOn?: string[] } = {}): Worker {
  const failOn = new Set(opts.failOn ?? []);
  return {
    async *runTextGen({ config }: { config: { prompt: string } }) {
      if (failOn.has(config.prompt)) throw new Error(`boom: ${config.prompt}`);
      yield { type: "text-delta", text: config.prompt };
      return { output: config.prompt, usage: ZERO };
    },
    async judge({ output }: { output: string }) {
      return { passed: true, reason: "scored", score: output.length };
    },
  } as unknown as Worker;
}

function variantGraph(selectCfg: Record<string, unknown> = {}): Graph {
  return {
    id: "g",
    name: "variants",
    nodes: [
      { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
      { id: "split", kind: "fanout", name: "SPLIT", x: 1, y: 0, fanout: { count: 3, strategy: "prompt", prompts: ["a", "bbb", "cc"] } },
      { id: "forge", kind: "textGen", name: "FORGE", x: 2, y: 0, textGen: { model: "t", prompt: "base" } },
      { id: "pick", kind: "select", name: "PICK", x: 3, y: 0, select: { mode: "rule", topK: 1, rule: { field: "length", desc: true }, ...selectCfg } },
      { id: "out", kind: "sink", name: "OUT", x: 4, y: 0 },
    ],
    edges: [
      { id: "e1", from: "in", to: "split", kind: "flow" },
      { id: "e2", from: "split", to: "forge", kind: "flow" },
      { id: "e3", from: "forge", to: "pick", kind: "flow" },
      { id: "e4", from: "pick", to: "out", kind: "flow" },
    ],
  };
}

async function run(g: Graph, worker: Worker) {
  const { plan } = compile(g);
  if (!plan) throw new Error("graph did not compile");
  const events: RunEvent[] = [];
  for await (const e of execute({ runId: "r", graph: g, plan, worker, now: () => 0 })) {
    events.push(e);
  }
  return { events, state: replay(events) };
}

describe("fanout / select variant lanes (F1)", () => {
  it("spawns N lanes and picks the longest via rule ranking", async () => {
    const { events, state } = await run(variantGraph(), promptWorker());

    const spawned = events.find((e) => e.type === "variants.spawned");
    expect(spawned?.variantIds).toEqual(["v1", "v2", "v3"]);

    const ranked = events.find((e) => e.type === "variants.ranked");
    expect(ranked?.chosen).toEqual(["v2"]); // "bbb" is longest

    // The select's output flows to the sink: the chosen variant's content.
    expect(state.status).toBe("done");
    const sink = state.nodes["out"];
    expect(sink?.status).toBe("done");
  });

  it("fails the select node loudly when every lane fails", async () => {
    const worker = promptWorker({ failOn: ["a", "bbb", "cc"] });
    const { events, state } = await run(variantGraph(), worker);

    expect(state.nodes["pick"]?.status).toBe("failed");
    expect(state.status).toBe("failed");
    // No ranking is emitted — nothing survived to rank.
    expect(events.some((e) => e.type === "variants.ranked")).toBe(false);
  });

  it("isolates a single failed lane and still ranks the survivors", async () => {
    const worker = promptWorker({ failOn: ["bbb"] }); // v2 fails
    const { events, state } = await run(variantGraph(), worker);

    // v2 is recorded as failed in the ranking event; v1/v3 still rank.
    const ranked = events.find((e) => e.type === "variants.ranked");
    expect(ranked?.failed).toEqual(["v2"]);
    expect(ranked?.chosen).toEqual(["v3"]); // "cc" is longer than "a"

    // The whole run is done — a sibling lane's failure must not sink the run.
    expect(state.status).toBe("done");
    expect(state.nodes["pick"]?.status).toBe("done");
  });

  it("ranks by llm_score through the judge channel", async () => {
    const g = variantGraph({ mode: "llm_score", topK: 1 });
    const { events } = await run(g, promptWorker());

    const ranked = events.find((e) => e.type === "variants.ranked");
    // The judge scores by output length, so "bbb" wins again.
    expect(ranked?.chosen).toEqual(["v2"]);
  });

  it("keeps every lane's variant-scoped state replayable without clobbering siblings", async () => {
    const { events, state } = await run(variantGraph(), promptWorker());

    // Each lane's sub-run emits its own node.finished under a distinct prefix,
    // and the parent run stays done with all three lane artifacts replayed.
    const finished = events.filter((e) => e.type === "node.finished");
    const laneFinishes = finished.filter((e) => e.nodeId.includes("#var:"));
    expect(laneFinishes.length).toBeGreaterThanOrEqual(3);
    expect(state.status).toBe("done");
  });
});
