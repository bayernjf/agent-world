import type { Graph } from "@agent-world/core";
import { compile } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function makeGraph(brandTerms: string, minBrandCoverage?: number): Graph {
  return {
    id: "bg",
    name: "bg",
    nodes: [
      {
        id: "in",
        kind: "source",
        name: "IN",
        x: 0,
        y: 0,
        source: { brandTerms },
      },
      {
        id: "a",
        kind: "agent",
        name: "W",
        x: 1,
        y: 0,
        agent: { model: "t", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 },
      },
      {
        id: "g",
        kind: "gate",
        name: "QC",
        x: 2,
        y: 0,
        gate: { maxAttempts: 1, criterion: "", onExhausted: "halt", minBrandCoverage },
      },
    ],
    edges: [
      { id: "e1", from: "in", to: "a", kind: "flow" },
      { id: "e2", from: "a", to: "g", kind: "flow" },
    ],
  };
}

async function collect(g: Graph) {
  const { plan } = compile(g);
  if (!plan) throw new Error("no plan");
  const events: Array<{ type: string; passed?: boolean; reason?: string }> = [];
  for await (const e of execute({
    runId: "r1",
    graph: g,
    plan,
    worker: fakeWorker({ chunkDelayMs: 0, failFirstAttempts: 0 }),
    input: "",
  })) {
    events.push(e as { type: string; passed?: boolean; reason?: string });
  }
  return events;
}

describe("brand-term gate coverage", () => {
  it("fails the gate when brand coverage is below the threshold", async () => {
    const events = await collect(makeGraph("ZzzBrandXy", 1));
    const verdict = events.find((e) => e.type === "gate.verdict");
    expect(verdict).toBeDefined();
    expect(verdict!.passed).toBe(false);
    expect(verdict!.reason).toContain("品牌词覆盖率");
  });

  it("passes when no coverage threshold is set, even if brand terms are absent", async () => {
    const events = await collect(makeGraph("ZzzBrandXy", undefined));
    const verdict = events.find((e) => e.type === "gate.verdict");
    expect(verdict).toBeDefined();
    expect(verdict!.passed).toBe(true);
  });
});

describe("brand_terms store", () => {
  it("adds, lists and deletes brand terms, rejecting empty ones", () => {
    const U = "u1";
    const db = openDb(":memory:");
    const a = db.addBrandTerm(U, "显瘦", "版型");
    expect(a.term).toBe("显瘦");
    const b = db.addBrandTerm(U, " 透气 ");
    expect(b.term).toBe("透气");

    const all = db.listBrandTerms(U);
    expect(all).toHaveLength(2);
    expect(all.map((x) => x.term).sort()).toEqual(["显瘦", "透气"]);

    db.deleteBrandTerm(a.id, U);
    expect(db.listBrandTerms(U)).toHaveLength(1);

    expect(() => db.addBrandTerm(U, "   ")).toThrow();
  });
});
