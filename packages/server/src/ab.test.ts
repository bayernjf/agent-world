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
      textGen: { model: "agnes-2.0-flash", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 },
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
      let report = await db.abReport(abGroup, "u1");
      while (Date.now() < deadline) {
        report = await db.abReport(abGroup, "u1");
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
      // G5.2: this graph has no gate downstream of the target → null, not a
      // fabricated verdict.
      expect(a.gate).toBeNull();
    }
    expect(report.recommendedArm).not.toBeNull();
  });

  it("abReport returns null for an unknown group", async () => {
    const db = openDb(":memory:");
    expect(await db.abReport("does-not-exist", "u1")).toBeNull();
  });
});

// G5.2: source → writer → quality gate (rework back to writer) → sink. The fake
// judge fails attempt 1 (score 3) and passes attempt 2 (score 9); the gate
// carries a minScore bar of 6, so the final verdict clears it.
const abGraphWithGate: Graph = {
  id: "abgg",
  name: "ab-graph-gate",
  nodes: [
    { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
    {
      id: "a",
      kind: "textGen",
      name: "Writer",
      x: 1,
      y: 0,
      textGen: { model: "agnes-2.0-flash", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60000 },
    },
    {
      id: "q",
      kind: "gate",
      name: "QC",
      x: 2,
      y: 0,
      gate: { maxAttempts: 3, criterion: "be persuasive", onExhausted: "halt", skills: [], minScore: 6 },
    },
    { id: "out", kind: "sink", name: "OUT", x: 3, y: 0 },
  ],
  edges: [
    { id: "e1", from: "in", to: "a", kind: "flow" },
    { id: "e2", from: "a", to: "q", kind: "flow" },
    { id: "e3", from: "q", to: "out", kind: "flow" },
    { id: "e4", from: "q", to: "a", kind: "rework" },
  ],
};

describe("G5.2 abReport downstream gate verdict projection", () => {
  it(
    "projects the gate's final verdict, score, quality bar and attempt history per arm",
    { timeout: 20000 },
    async () => {
      const db = openDb(":memory:");
      const { abGroup } = await startABExperiment(db, fakeWorker({ chunkDelayMs: 0 }), {
        userId: "u1",
        graph: abGraphWithGate,
        targetNodeId: "a",
        variants: ["P1", "P2"],
        budgetUsd: null,
        input: "seed input for the gate test",
      });

      const deadline = Date.now() + 15000;
      let report = await db.abReport(abGroup, "u1");
      while (Date.now() < deadline) {
        report = await db.abReport(abGroup, "u1");
        if (report && report.arms.length === 2 && report.arms.every((a) => a.done === a.runs && a.runs > 0)) {
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }

      expect(report).not.toBeNull();
      report = report!;
      expect(report.arms).toHaveLength(2);
      for (const a of report.arms) {
        expect(a.gate).not.toBeNull();
        expect(a.gate!.gateNodeId).toBe("q");
        // Final verdict after rework: fake judge passes attempt 2 with score 9.
        expect(a.gate!.passed).toBe(true);
        expect(a.gate!.score).toBe(9);
        // criterion-aware fake judge passes on the retry with this prefix.
        expect(a.gate!.reason).toContain("Meets criterion");
        expect(a.gate!.minScore).toBe(6);
        expect(a.gate!.meetsBar).toBe(true);
        expect(a.gate!.history.length).toBeGreaterThanOrEqual(1);
        // Nothing rewrites content between the writer and its immediate gate.
        expect(a.gate!.mutatesInBetween).toBe(false);
      }
    },
  );
});
