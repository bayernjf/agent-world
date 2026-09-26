import type { Graph } from "@agent-world/core";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { buildABVariants, startABExperiment } from "./ab.js";
import { fakeWorker } from "./worker.js";
import { ArtifactStore } from "./artifact-store.js";
import { currentUsage } from "./subscriptionService.js";

/** 实验 run 现在也走 drainRun，媒体产物要落库，所以必须给一个真实的 store。 */
const testArtifacts = () => new ArtifactStore(mkdtempSync(join(tmpdir(), "aw-ab-")));

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
        artifacts: testArtifacts(),
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

  // 实验 run 曾经绕过 startRun 自己调 execute，于是用量归集（recordRunUsage）这条
  // 跨切面直接缺位——实验照跑、照出结果，但一次都没进账。现在走 drainRun 后归集
  // 必须发生：这条断言钉的就是「实验不是免费用量的后门」。
  it("folds each arm's usage into the monthly ledger, like any other dispatch", { timeout: 20000 }, async () => {
    const db = openDb(":memory:");
    const { arms } = await startABExperiment(db, fakeWorker({ chunkDelayMs: 0 }), {
      userId: "u1",
      graph: abGraph,
      targetNodeId: "a",
      variants: ["P1", "P2"],
      budgetUsd: null,
      artifacts: testArtifacts(),
    });
    expect(await currentUsage(db, "u1")).toMatchObject({ runs: 0 });

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if ((await currentUsage(db, "u1")).runs >= arms.length) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const usage = await currentUsage(db, "u1");
    expect(usage.runs).toBe(arms.length);
    // fake worker 出 token，所以不只是「记了一次运行」。
    expect(usage.normalizedTokens).toBeGreaterThan(0);
  });
});

describe("no dispatch path may drive the engine on its own", () => {
  // 与 dispatch-gate.test.ts 的「建 run 必须过闸门」同源：跨切面（合规词表/技能/
  // 搜索/媒体落库/月度预算/用量归集）漏一个不报错、只静默跑歪，所以派发口不许自己
  // 拼参数调引擎，必须走 run.ts 的 drainRun。
  it("execute/resume/fork are only called from run.ts, always via drainRun", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        if (entry.name === "run.ts" || entry.name === "engine.ts") continue;
        const source = readFileSync(full, "utf8");
        // 只看「从 engine.js 引入了 execute/resume/fork」的文件：别的文件里
        // `xxx.execute(` / `child_process.fork(` 是同名，与本守护无关。
        const engineImport = source.match(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"[^"]*engine\.js"/);
        if (engineImport && /\b(execute|resume|fork)\b/.test(engineImport[1]!) && !source.includes("drainRun")) {
          offenders.push(relative(process.cwd(), full));
        }
      }
    };
    walk(process.cwd() + "/src");

    expect(
      offenders,
      `这些文件自己调引擎，等于新开一条绕过跨切面的派发路径：${offenders.join(", ")}`,
    ).toEqual([]);
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
        artifacts: testArtifacts(),
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
