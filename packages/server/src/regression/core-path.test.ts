import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compile, instantiateTemplate, replay, TEMPLATES, type Graph } from "@agent-world/core";
import { ArtifactStore } from "../artifact-store.js";
import { execute, resume } from "../engine.js";
import { guardedFetch, hostIsInternal } from "../ssrf.js";
import { fakeWorker } from "../worker.js";

/**
 * Core-path regression baseline ("安全网").
 *
 * This file deliberately mirrors the product's highest-risk invariants as a
 * single, fast, repeatable suite — the things that must never regress:
 *   - compile → execute → done with typed artifacts flowing downstream
 *   - rework loop (gate rejects once, textGen reruns, passes)
 *   - resume from an interrupted run without duplicating upstream artifacts
 *   - binary artifacts persist with a real local uri + sizeBytes
 *   - auth register/login + protected-route guard
 *   - SSRF fail-closed on internal hosts
 *
 * Run with: pnpm --filter @agent-world/server test:regression
 * It is intentionally dependency-free (no shared test helpers) so it stays a
 * stable safety net even when other suites are refactored.
 */

// ─── engine helpers ──────────────────────────────────────────────────────────

function linearGraph(): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
      {
        id: "forge",
        kind: "textGen",
        name: "FORGE",
        x: 1,
        y: 0,
        textGen: {
          model: "test",
          prompt: "",
          skills: [],
          temperature: 0.7,
          timeoutMs: 60_000,
          retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
        },
      },
      { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "forge", kind: "flow" },
      { id: "e2", from: "forge", to: "depot", kind: "flow" },
    ],
  };
}

function gateGraph(): Graph {
  return {
    id: "g2",
    name: "g2",
    nodes: [
      { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
      {
        id: "forge",
        kind: "textGen",
        name: "FORGE",
        x: 1,
        y: 0,
        textGen: {
          model: "test",
          prompt: "",
          skills: [],
          temperature: 0.7,
          timeoutMs: 60_000,
          retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
        },
      },
      { id: "critic", kind: "gate", name: "CRITIC", x: 2, y: 0, gate: { maxAttempts: 3, criterion: "ok", onExhausted: "halt" } },
      { id: "depot", kind: "sink", name: "DEPOT", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "forge", kind: "flow" },
      { id: "e2", from: "forge", to: "critic", kind: "flow" },
      { id: "e3", from: "critic", to: "depot", kind: "flow" },
      { id: "r1", from: "critic", to: "forge", kind: "rework" },
    ],
  };
}

function okWorker(input: (input: string) => string) {
  return {
    runTextGen: async function* () {
      yield { type: "text-delta", text: "x" };
      return { output: "dummy", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0, units: {} } };
    },
    // overridden per-test when needed
    judge: undefined as any,
    __echoInput: input,
  } as any;
}

function echoWorker(): any {
  const w = okWorker((i) => i);
  w.runTextGen = async function* (args: any) {
    yield { type: "text-delta", text: "x" };
    return { output: `echo:${args.input}`, usage: { tokensIn: 1, tokensOut: 1, costUsd: 0, units: {} } };
  };
  return w;
}

async function drain(gen: AsyncGenerator<unknown, void, unknown>): Promise<any[]> {
  const out: any[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/**
 * Retry backoff for the cases that really execute a `code` node. The default
 * code-node retry is { maxRetries: 2, baseDelayMs: 1000 }; a no-op sleep turns
 * that into three attempts inside one microsecond, so a transient subprocess
 * failure on a loaded 2-vCPU runner is never actually backed off. Sleep for
 * real but capped: retries cost ≤ 200ms and mirror production behaviour instead
 * of hiding a broken sandbox.
 */
function backoffSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 100)));
}

/**
 * Assert a node reached node.finished, and name the reason when it did not.
 * A bare `expected false to be true` cannot tell a script error apart from a
 * starved subprocess — the CI log has to answer that by itself.
 */
function expectNodeFinished(events: any[], nodeId: string) {
  const finished = events.some((e) => e.type === "node.finished" && e.nodeId === nodeId);
  const failures = events.filter((e) => e.type === "node.failed" && e.nodeId === nodeId);
  const detail = failures.length
    ? `node.failed: ${failures.map((f) => `[${f.errorCode ?? "UNKNOWN"}] ${f.error}`).join(" | ")}`
    : "该节点没有任何 node.failed —— 它被调度器饿死了（没启动，或停在 running）";
  expect(
    finished,
    `node ${nodeId} 未到达 node.finished；${detail}；末尾事件: ${events.slice(-20).map((e) => e.type).join(" → ")}`,
  ).toBe(true);
}

// ─── engine core path ────────────────────────────────────────────────────────

describe("regression · engine core path", () => {
  it("compile → execute a linear pipeline to done, flowing typed artifacts downstream", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const worker = echoWorker();

    const events = await drain(
      execute({ runId: "r1", graph, plan: plan!, worker, budgetUsd: null, input: "raw", now: () => 0, sleep: async () => {} }),
    );

    expect(replay(events).status).toBe("done");
    const finished = events.filter((e) => e.type === "node.finished");
    expect(finished.map((e) => e.nodeId).sort()).toEqual(["depot", "forge", "intake"]);
    // The text node echoes upstream: the artifact content is the source input.
    const forgeText = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === "forge" && e.artifact.kind === "text",
    );
    expect(forgeText.artifact.content).toContain("raw");
  });

  it("contract: engine success emits run.finished status 'done' (event triggers key off it)", async () => {
    // TriggerService.onGraphFinished and post-run knowledge extraction fire on
    // the engine's real success status. It MUST be "done" — a nominal
    // "completed" here silently breaks graph-completion event triggers.
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const worker = echoWorker();
    const events = await drain(
      execute({ runId: "r-status", graph, plan: plan!, worker, budgetUsd: null, input: "raw", now: () => 0, sleep: async () => {} }),
    );
    const finished = events.find((e) => e.type === "run.finished");
    expect(finished).toBeTruthy();
    expect((finished as { status: string }).status).toBe("done");
  });

  it("rework loop: gate rejects once, forge reruns, pipeline still reaches done", async () => {
    const graph = gateGraph();
    const { plan } = compile(graph)!;
    const worker = echoWorker();
    let verdicts = 0;
    worker.judge = async () => {
      verdicts++;
      return { passed: verdicts >= 2, reason: verdicts >= 2 ? "ok" : "needs rework" };
    };

    const events = await drain(
      execute({ runId: "r2", graph, plan: plan!, worker, budgetUsd: null, input: "raw", now: () => 0, sleep: async () => {} }),
    );

    expect(replay(events).status).toBe("done");
    expect(verdicts).toBeGreaterThanOrEqual(2);
    const forgeRuns = events.filter((e) => e.type === "node.started" && e.nodeId === "forge");
    expect(forgeRuns.length).toBeGreaterThanOrEqual(2);
  });

  it("blank/empty graph fails closed with a clear error instead of a TypeError", async () => {
    // A brand-new "空白产线" canvas has no nodes/edges, so compile() yields a
    // null plan. execute() must reject with an actionable message, not blow up
    // dereferencing plan.loops/order/levels.
    const g: Graph = { id: "g", name: "g", nodes: [], edges: [] };
    const { plan } = compile(g);
    expect(plan).toBeNull();
    const worker: any = {
      runTextGen: async function* () {
        throw new Error("unreachable");
      },
      judge: async () => ({ passed: true, reason: "ok" }),
    };
    await expect(async () => {
      for await (const _e of execute({ runId: "r-blank", graph: g, plan: plan as any, worker, budgetUsd: null, input: "x", now: () => 0, sleep: async () => {} })) {
        /* drain */
      }
    }).rejects.toThrow(/graph does not compile/);
  });

  it("resume from an interrupted run reruns the failed node without duplicating upstream artifacts", async () => {
    // Regression guard for the reconstructState fix: node.finished may arrive
    // before artifact.produced (source nodes), so resume must not synthesize a
    // second text artifact and feed downstream the same upstream content twice.
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const failWorker: any = {
      runTextGen: async function* () {
        throw new Error("nope");
      },
      judge: async () => ({ passed: false, reason: "x" }),
    };

    const past = await drain(
      execute({ runId: "r3", graph, plan: plan!, worker: failWorker, budgetUsd: null, input: "raw", now: () => 0, sleep: async () => {} }),
    );
    expect(replay(past).status).toBe("failed");

    const okW = echoWorker();
    const cont = await drain(
      resume({ runId: "r3", graph, plan: plan!, worker: okW, budgetUsd: null, pastEvents: past, action: "continue", resetFrom: "forge", now: () => 0, sleep: async () => {} }),
    );
    expect(replay(cont).status).toBe("done");
    const forgeOut = cont.find((e) => e.type === "node.finished" && e.nodeId === "forge");
    // Upstream "raw" must appear exactly once, not "raw\n\nraw".
    expect(forgeOut.output).toBe("echo:raw");
  });

  it("error edge hands off to a catch node even when a human node will suspend the run", async () => {
    // review-publish: notify (no webhook configured) fails, its error edge must
    // still start notifyFallback instead of being starved by the suspended human.
    const t = TEMPLATES.find((x: { id: string }) => x.id === "tpl-review-publish")!;
    const graph = instantiateTemplate(t);
    const { plan } = compile(graph)!;
    const worker = fakeWorker({ failFirstAttempts: 0, chunkDelayMs: 0 });

    const events = await drain(
      execute({ runId: "r-rp", graph, plan: plan!, worker, budgetUsd: null, input: "测试内容", now: () => 0, sleep: backoffSleep }),
    );

    const notifyId = graph.nodes.find((n) => n.name === "送审通知")?.id;
    const fallbackId = graph.nodes.find((n) => n.name === "通知兜底")?.id;
    expect(notifyId).toBeTruthy();
    expect(fallbackId).toBeTruthy();
    // notify must fail (missing webhook)
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === notifyId)).toBe(true);
    // the error-edge catch node must actually run, not stay starved
    expectNodeFinished(events, fallbackId!);
    // and the human node paused the run for operator review
    expect(events.some((e) => e.type === "human.review")).toBe(true);
  });

  it("template code nodes read engine inputs via stdin (batch-content split)", async () => {
    // Guards the code-node I/O contract: engine writes { inputs } to stdin and
    // template scripts read it back — a bare `inputs` reference must not regress.
    const t = TEMPLATES.find((x: { id: string }) => x.id === "tpl-batch-content")!;
    const graph = instantiateTemplate(t);
    const { plan } = compile(graph)!;
    const worker = fakeWorker({ failFirstAttempts: 0, chunkDelayMs: 0 });

    const events = await drain(
      execute({ runId: "r-bc", graph, plan: plan!, worker, budgetUsd: null, input: "甲\n乙\n丙", now: () => 0, sleep: backoffSleep }),
    );

    const splitId = graph.nodes.find((n) => n.name === "拆条")?.id;
    expect(splitId).toBeTruthy();
    expectNodeFinished(events, splitId!);
    // split emits a json artifact with the two items — prove stdin inputs flowed in
    const splitArtifact = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === splitId && e.artifact.kind === "json",
    )?.artifact;
    expect(splitArtifact).toBeTruthy();
    expect(splitArtifact.content).toContain("甲");
    expect(splitArtifact.content).toContain("丙");
  });

  it("evidence-brief template runs end to end: split → sorted table → gate pass", async () => {
    // The lawyer evidence-list line: a real code-node parse of pasted material,
    // a real table sort, and the deterministic split→sheet contract between them.
    const t = TEMPLATES.find((x: { id: string }) => x.id === "tpl-evidence-brief")!;
    const graph = instantiateTemplate(t);
    const { plan } = compile(graph)!;
    const worker = fakeWorker({ failFirstAttempts: 0, chunkDelayMs: 0 });

    const input = [
      "诉讼请求：判令张三偿还借款 10 万元。",
      "",
      "2024年3月5日 微信聊天记录：张三说“欠你的 10 万，三个月内还”。",
      "",
      "2024/3/1 银行转账凭证：向张三转账 100,000 元。",
    ].join("\n");

    const events = await drain(
      execute({ runId: "r-ev", graph, plan: plan!, worker, budgetUsd: null, input, now: () => 0, sleep: backoffSleep }),
    );

    expect(replay(events).status).toBe("done");
    const splitId = graph.nodes.find((n) => n.name === "拆条编号")?.id;
    const sheetId = graph.nodes.find((n) => n.name === "时间索引")?.id;
    // split must emit one json row per pasted evidence chunk, with best-effort dates
    const splitArtifact = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === splitId && e.artifact.kind === "json",
    )?.artifact;
    expect(splitArtifact).toBeTruthy();
    expect(splitArtifact.content).toContain("微信聊天记录");
    expect(splitArtifact.content).toContain("转账凭证");
    expect(splitArtifact.content).toContain("2024-03-05"); // 中文日期归一化
    // The claim paragraph is evidence-free context: split must peel it off
    // into `claim` instead of numbering it as an evidence row (dogfood
    // tpl-evidence-brief: it used to float into the timeline table).
    const splitJson = JSON.parse(splitArtifact.content) as { claim: string; rows: { excerpt: string }[] };
    expect(splitJson.claim).toContain("诉讼请求");
    expect(splitJson.rows.some((r) => r.excerpt.includes("诉讼请求"))).toBe(false);
    // table sorts chronologically: the 03-01 transfer row precedes the 03-05 chat row
    const sheetArtifact = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === sheetId && e.artifact.kind === "json",
    )?.artifact;
    expect(sheetArtifact).toBeTruthy();
    const rows = JSON.parse(sheetArtifact.content).rows as { date: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const dates = rows.map((r) => r.date).filter(Boolean);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe("2024-03-01");
  });

  it("expense-review template runs end to end: rule flags → anomaly table sorted → gate pass", async () => {
    // The accounting line: deterministic rule checks in a real code-node sandbox,
    // a real table sort by issue count, and the check→anomalies contract.
    const t = TEMPLATES.find((x: { id: string }) => x.id === "tpl-expense-review")!;
    const graph = instantiateTemplate(t);
    const { plan } = compile(graph)!;
    const worker = fakeWorker({ failFirstAttempts: 0, chunkDelayMs: 0 });

    // Covers all three anomaly families plus one clean line and a header row
    // the script must skip. All dates are safely in the past.
    const input = [
      "日期, 单号, 科目, 金额",
      "2026-08-21, BX-2026-0142, 市内交通费, 68.5",
      "2026-08-22, BX-2026-0143, 业务招待餐费, 860",
      "2026-08-22, BX-2026-0143, 业务招待餐费, 860",
      "2026-08-25, BX-2026-0144, 机票, 1520",
      // Double-anomaly line: over the 1000 limit AND a duplicated voucher
      // number — issueCount must be 2 (dogfood tpl-expense-review), which is
      // what makes the issueCount-desc sort meaningful.
      "2026-08-25, BX-2026-0144, 设备采购, 2200",
      "8月28日, BX-2026-0145, 办公用品, 129",
    ].join("\n");

    const events = await drain(
      execute({ runId: "r-exp", graph, plan: plan!, worker, budgetUsd: null, input, now: () => 0, sleep: backoffSleep }),
    );

    expect(replay(events).status).toBe("done");
    const checkId = graph.nodes.find((n) => n.name === "规则校验")?.id;
    const tableId = graph.nodes.find((n) => n.name === "异常清单")?.id;
    const checkArtifact = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === checkId && e.artifact.kind === "json",
    )?.artifact;
    expect(checkArtifact).toBeTruthy();
    const flagged = JSON.parse(checkArtifact.content).rows as {
      voucherNo: string; amount: number | ""; flags: string; issueCount: number; risk: string; category: string;
    }[];
    expect(flagged).toHaveLength(6); // header skipped
    expect(flagged.filter((r) => r.flags.includes("重复单号")).map((r) => r.voucherNo)).toEqual(["BX-2026-0143", "BX-2026-0143", "BX-2026-0144", "BX-2026-0144"]);
    expect(flagged.find((r) => r.amount === 1520)?.flags).toContain("单笔超1000元");
    // issueCount is the real flag count, not a boolean: the double-anomaly
    // line carries 2.
    expect(flagged.find((r) => r.amount === 2200)?.issueCount).toBe(2);
    const noDate = flagged.find((r) => r.voucherNo === "BX-2026-0145")!;
    expect(noDate.flags).toContain("日期缺失");
    expect(noDate.category).toBe("办公用品"); // "8月28日" must not be mistaken for the category
    expect(flagged.find((r) => r.voucherNo === "BX-2026-0142")?.risk).toBe("合格");
    // table sorts anomalies first: issue counts non-increasing
    const tableArtifact = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === tableId && e.artifact.kind === "json",
    )?.artifact;
    expect(tableArtifact).toBeTruthy();
    const sorted = JSON.parse(tableArtifact.content).rows as { issueCount: number; amount: number }[];
    expect(sorted).toHaveLength(6);
    const counts = sorted.map((r) => r.issueCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    // Both double-anomaly rows (over-limit AND duplicated voucher number)
    // sort ahead of every single-flag row.
    expect(counts[0]).toBe(2);
    expect(counts[1]).toBe(2);
    expect(sorted.slice(0, 2).map((r) => r.amount).sort((a, b) => a - b)).toEqual([1520, 2200]);
  });

  it("reconciliation template runs end to end: pairwise match → difference table sorted → gate pass", async () => {
    // The accounting line, second template: two ledgers (bank vs book) are
    // paired by date+amount in a real code-node sandbox; mismatches become a
    // table sorted by amount, and the report/gate read the pairing summary.
    const t = TEMPLATES.find((x: { id: string }) => x.id === "tpl-reconciliation")!;
    const graph = instantiateTemplate(t);
    const { plan } = compile(graph)!;
    const worker = fakeWorker({ failFirstAttempts: 0, chunkDelayMs: 0 });

    // 3 bank lines + 3 book lines; two match exactly (08-01 100 / 08-05 200),
    // one bank-only (08-02 50) and one book-only (08-03 30).
    const input = [
      "银行流水",
      "2026-08-01 100.00 收款A",
      "2026-08-02 50.00 付款B",
      "2026-08-05 200.00 收款C",
      "企业账簿",
      "2026-08-01 100.00 收款A",
      "2026-08-03 30.00 付款D",
      "2026-08-05 200.00 收款C",
    ].join("\n");

    const events = await drain(
      execute({ runId: "r-rec", graph, plan: plan!, worker, budgetUsd: null, input, now: () => 0, sleep: backoffSleep }),
    );

    expect(replay(events).status).toBe("done");
    const recId = graph.nodes.find((n) => n.name === "逐笔配对")?.id;
    const recArtifact = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === recId && e.artifact.kind === "json",
    )?.artifact;
    expect(recArtifact).toBeTruthy();
    const rec = JSON.parse(recArtifact.content) as {
      rows: { side: string; amount: string; amountNum: number }[];
      summary: { bankCount: number; bookCount: number; matchedCount: number; diffCount: number };
    };
    expect(rec.summary).toEqual({ bankCount: 3, bookCount: 3, matchedCount: 2, diffCount: 2 });
    expect(rec.rows.map((r) => r.side).sort()).toEqual(["账有、银行无", "银行有、账无"]);
    expect(rec.rows.find((r) => r.amount === "50.00")?.side).toBe("银行有、账无");
    expect(rec.rows.find((r) => r.amount === "30.00")?.side).toBe("账有、银行无");

    // Table sorts differences by amount descending (numeric-aware, 50 > 30).
    const tableId = graph.nodes.find((n) => n.name === "差异清单")?.id;
    const tableArtifact = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === tableId && e.artifact.kind === "json",
    )?.artifact;
    expect(tableArtifact).toBeTruthy();
    const sorted = JSON.parse(tableArtifact.content).rows as { amountNum: number }[];
    expect(sorted.map((r) => r.amountNum)).toEqual([50, 30]);
  });

  it("recipe template runs end to end: the gate and the sink keep the full recipe, not only the nutrition JSON", async () => {
    // Dogfood tpl-recipe, two layers: (1) the nutrition code node used to
    // print only its JSON, so the gate judged the JSON alone and halted;
    // (2) after the gate saw the recipe, its pass-through artifact — which
    // is exactly its input — still reached the sink as JSON text only.
    // The nutrition script now carries the upstream recipe through and
    // appends the estimate, so both the judge input and the final artifact
    // contain the whole dish.
    const t = TEMPLATES.find((x: { id: string }) => x.id === "tpl-recipe")!;
    const graph = instantiateTemplate(t);
    const { plan } = compile(graph)!;
    const worker = fakeWorker({ failFirstAttempts: 0, chunkDelayMs: 0 });
    const gateInputs: string[] = [];
    const judge = worker.judge!;
    worker.judge = async (args: any) => {
      gateInputs.push(args.input);
      return judge(args);
    };

    const events = await drain(
      execute({ runId: "r-recipe", graph, plan: plan!, worker, budgetUsd: null, input: "鸡胸肉 300g、西兰花 200g；少油低盐", now: () => 0, sleep: backoffSleep }),
    );

    expect(replay(events).status).toBe("done");
    expectNodeFinished(events, graph.nodes.find((n) => n.name === "质检")!.id);
    expect(gateInputs.length).toBeGreaterThanOrEqual(1);
    for (const input of gateInputs) {
      expect(input).toContain("estimatedCalories"); // the nutrition estimate…
      expect(input).toContain("producing artifact"); // …and the text chain upstream
    }
    // The sink artifact is the gate's pass-through: the full recipe must survive.
    const depotId = graph.nodes.find((n) => n.kind === "sink")!.id;
    const depotArtifact = events.find(
      (e) => e.type === "artifact.produced" && e.nodeId === depotId,
    )?.artifact;
    expect(depotArtifact).toBeTruthy();
    expect(depotArtifact.content).toContain("estimatedCalories");
    expect(depotArtifact.content).toContain("producing artifact");
  });

  it("travel-plan template fans the user requirements into the planner", () => {
    // Dogfood tpl-travel-plan: the http research placeholder was the
    // planner's only upstream, so it produced a "please tell me your
    // destination" reply instead of an itinerary and the gate halted the run.
    const t = TEMPLATES.find((x: { id: string }) => x.id === "tpl-travel-plan")!;
    const planIn = t.graph.edges.filter((e) => e.to === "plan" && e.kind === "flow").map((e) => e.from);
    expect(planIn).toContain("intake");
    expect(planIn).toContain("research");
  });

  it("source node with a database connector pulls live rows end to end", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-reg-db-"));
    try {
      const dbPath = join(dir, "seed.db");
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(dbPath);
      db.exec(
        "CREATE TABLE feed (id INTEGER, msg TEXT); INSERT INTO feed VALUES (1,'hello'),(2,'world');",
      );
      db.close();

      const graph: Graph = {
        id: "g-db",
        name: "g-db",
        nodes: [
          {
            id: "intake",
            kind: "source",
            name: "INTAKE",
            x: 0,
            y: 0,
            source: {
              connector: {
                type: "database",
                database: { driver: "sqlite", path: dbPath, query: "SELECT * FROM feed ORDER BY id" },
              },
            },
          },
          { id: "depot", kind: "sink", name: "DEPOT", x: 1, y: 0 },
        ],
        edges: [{ id: "e1", from: "intake", to: "depot", kind: "flow" }],
      };
      const { plan } = compile(graph)!;
      const worker = fakeWorker({ failFirstAttempts: 0, chunkDelayMs: 0 });

      const events = await drain(
        execute({ runId: "r-db", graph, plan: plan!, worker, budgetUsd: null, input: "", now: () => 0, sleep: async () => {} }),
      );

      expect(replay(events).status).toBe("done");
      const sinkArtifact = events.find(
        (e) => e.type === "artifact.produced" && e.nodeId === "depot" && e.artifact.kind === "text",
      )?.artifact;
      expect(sinkArtifact).toBeTruthy();
      const rows = JSON.parse(sinkArtifact.content) as Array<{ id: number; msg: string }>;
      expect(rows.map((r) => r.msg)).toEqual(["hello", "world"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── artifact persistence ────────────────────────────────────────────────────

describe("regression · artifact persistence", () => {
  let dir: string;
  let store: ArtifactStore;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-reg-art-"));
    store = new ArtifactStore(dir);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves inline binary content to a local path with sizeBytes", async () => {
    const saved = await store.save(
      { id: "v0", kind: "video", content: Buffer.from("fake-mp4-bytes"), mimeType: "video/mp4" } as any,
      { runId: "r", nodeId: "video" },
    );
    expect(saved.storage).toBe("local");
    expect(saved.uri).toContain("/api/artifacts/");
    expect(saved.sizeBytes).toBe(14);
  });

  it("keeps a local /api/artifacts/ reference as local storage (not an inline stub)", async () => {
    const saved = await store.save(
      { id: "img-0", kind: "image", uri: "/api/artifacts/up-abc123", mimeType: "image/png" } as any,
      { runId: "r", nodeId: "img" },
    );
    expect(saved.storage).toBe("local");
    expect(saved.uri).toBe("/api/artifacts/up-abc123");
  });
});

// ─── auth ────────────────────────────────────────────────────────────────────

describe("regression · auth", () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof import("../index.js")>>["app"];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "aw-reg-auth-"));
    process.env.DB_FILE = join(dir, "auth.sqlite");
    process.env.ALLOW_REGISTRATION = "1";
    const mod = await import("../index.js");
    app = mod.app;
  });
  afterAll(() => {
    delete process.env.DB_FILE;
    delete process.env.ALLOW_REGISTRATION;
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("register → login → protected route", async () => {
    const reg = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "core@reg.test", password: "secret123" }),
    });
    expect(reg.status).toBe(201);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "core@reg.test", password: "secret123" }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toContain("auth_token=");

    // Protected route (/api/graphs): no auth → 401, with cookie → 200.
    const anon = await app.request("/api/graphs");
    expect(anon.status).toBe(401);
    const authed = await app.request("/api/graphs", { headers: { cookie } });
    expect(authed.status).toBe(200);
  });
});

// ─── SSRF fail-closed ────────────────────────────────────────────────────────

describe("regression · SSRF guard", () => {
  it("classifies internal hosts as internal", async () => {
    expect(await hostIsInternal("127.0.0.1")).toBe(true);
    expect(await hostIsInternal("169.254.169.254")).toBe(true);
    expect(await hostIsInternal("::ffff:7f00:1")).toBe(true);
  });

  it("guardedFetch refuses internal URLs without touching the network", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(guardedFetch("http://127.0.0.1/steal")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
