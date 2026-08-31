import type { Graph } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { buildABVariants, startABExperiment } from "./ab.js";
import { fakeWorker } from "./worker.js";

const abGraph: Graph = {
  id: "abg",
  name: "ab-graph",
  nodes: [
    { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
    {
      id: "a",
      kind: "textGen",
      name: "Writer",
      x: 1,
      y: 0,
      textGen: { model: "t", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 },
    },
    { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
  ],
  edges: [
    { id: "e1", from: "in", to: "a", kind: "flow" },
    { id: "e2", from: "a", to: "out", kind: "flow" },
  ],
};

const promptOf = (g: Graph, id: string) =>
  (g.nodes.find((n) => n.id === id) as { textGen: { prompt: string } }).textGen.prompt;

describe("buildABVariants", () => {
  it("clones the graph and substitutes each variant prompt, leaving the original untouched", () => {
    const snapshot = JSON.stringify(abGraph);
    const variants = buildABVariants(abGraph, "a", ["版本一", "版本二", "版本三"]);
    expect(variants.map((v) => v.arm)).toEqual(["A", "B", "C"]);
    expect(promptOf(variants[0].graph, "a")).toBe("版本一");
    expect(promptOf(variants[1].graph, "a")).toBe("版本二");
    expect(promptOf(variants[2].graph, "a")).toBe("版本三");
    expect(JSON.stringify(abGraph)).toBe(snapshot);
  });

  it("throws when the target is not an agent node", () => {
    expect(() => buildABVariants(abGraph, "in", ["x", "y"])).toThrow();
  });

  it("throws when the target node is missing", () => {
    expect(() => buildABVariants(abGraph, "nope", ["x", "y"])).toThrow();
  });
});

describe("startABExperiment + abReport", () => {
  it(
    "runs each variant as its own run and reports arms side by side",
    { timeout: 20000 },
    async () => {
      const db = openDb(":memory:");
      const { abGroup, arms } = await startABExperiment(db, fakeWorker({ chunkDelayMs: 0 }), {
        userId: "u1",
        graph: abGraph,
        targetNodeId: "a",
        variants: ["P1", "P2"],
        budgetUsd: null,
      });
      expect(arms.map((x) => x.arm)).toEqual(["A", "B"]);
      expect(arms.every((x) => typeof x.runId === "string" && x.runId.length > 0)).toBe(true);

      const deadline = Date.now() + 12000;
      let report = db.abReport(abGroup, "u1");
      while (Date.now() < deadline) {
        report = db.abReport(abGroup, "u1");
        if (report && report.arms.length === 2 && report.arms.every((a) => a.done === a.runs && a.runs > 0)) {
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }

    expect(report).not.toBeNull();
    report = report!;
    expect(report.arms).toHaveLength(2);
    for (const a of report.arms) {
      expect(a.runs).toBe(1);
      expect(a.passed).toBe(1);
      expect(a.passRate).toBe(1);
      expect(typeof a.avgScore).toBe("number");
      expect(a.prompt).not.toBeNull();
    }
    expect(report.recommendedArm).not.toBeNull();
  });

  it("abReport returns null for an unknown group", () => {
    const db = openDb(":memory:");
    expect(db.abReport("does-not-exist", "u1")).toBeNull();
  });
});
