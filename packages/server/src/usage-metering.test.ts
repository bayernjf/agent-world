import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Graph, RunEvent } from "@agent-world/core";
import { openDb } from "./db.js";
import { currentPeriodStart } from "./subscription.js";
import {
  recordRunUsage,
  currentUsage,
} from "./subscriptionService.js";
import { backfillUsage } from "./usage-backfill.js";

const U = "u1";

// One text node + one video node so segment counting has something to see.
const graph: Graph = {
  id: "g1",
  name: "G1",
  nodes: [
    { id: "text", kind: "textGen", name: "Text", x: 0, y: 0 },
    { id: "vid", kind: "videoGen", name: "Video", x: 100, y: 0 },
  ],
  edges: [],
};

function nodeFinished(nodeId: string, attempt: number, seq: number, tokensIn = 100, tokensOut = 50): RunEvent {
  return {
    seq,
    ts: seq * 1000,
    version: 1,
    type: "node.finished",
    nodeId,
    attempt,
    output: "out",
    usage: { tokensIn, tokensOut, cachedTokens: 0, reasoningTokens: 0, costUsd: 0.01 },
  } as RunEvent;
}
function nodeFailed(nodeId: string, attempt: number, seq: number): RunEvent {
  return { seq, ts: seq * 1000, version: 1, type: "node.failed", nodeId, attempt, error: "boom", errorCode: "X" } as RunEvent;
}

describe("usage metering (M2 S3)", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-usage-"));
    db = openDb(join(dir, "test.sqlite"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("records normalized tokens, a run and one video segment on finish", async () => {
    const at = Date.parse("2026-09-10T00:00:00Z");
    await db.createRun({ id: "r1", userId: U, graph, budgetUsd: null, at });
    await db.record("r1", nodeFinished("text", 1, 1, 100, 50));
    await db.record("r1", nodeFinished("vid", 1, 2, 0, 0));
    await db.finishRun("r1", U, "done", at + 1000);

    const res = await recordRunUsage(db, U, graph, "r1", at);
    expect(res.normalizedTokens).toBe(100 + 50 * 4);
    expect(res.videoSegments).toBe(1);

    const period = currentPeriodStart(at);
    expect(await db.usageFor(U, "runs", period)).toBe(1);
    expect(await db.usageFor(U, "tokens_in", period)).toBe(100);
    expect(await db.usageFor(U, "tokens_out", period)).toBe(50);
    expect(await db.usageFor(U, "video_segments", period)).toBe(1);
  });

  it("counts a retried video node once (DISTINCT node, not attempts)", async () => {
    const at = Date.parse("2026-09-10T00:00:00Z");
    await db.createRun({ id: "r2", userId: U, graph, budgetUsd: null, at });
    await db.record("r2", nodeFailed("vid", 1, 1));
    await db.record("r2", nodeFinished("vid", 2, 2, 0, 0));
    await db.finishRun("r2", U, "done", at + 1000);

    const res = await recordRunUsage(db, U, graph, "r2", at);
    expect(res.videoSegments).toBe(1);
  });

  it("aggregates every dimension in currentUsage, weighting output 4x", async () => {
    const now = Date.parse("2026-09-10T12:00:00Z");
    await db.createRun({ id: "r3", userId: U, graph, budgetUsd: null, at: now });
    await db.record("r3", nodeFinished("text", 1, 1, 200, 25));
    await db.finishRun("r3", U, "done", now + 1000);
    await recordRunUsage(db, U, graph, "r3", now);

    const usage = await currentUsage(db, U, now);
    expect(usage.tokensIn).toBe(200);
    expect(usage.tokensOut).toBe(25);
    expect(usage.normalizedTokens).toBe(200 + 25 * 4);
    expect(usage.runs).toBe(1);
  });
});

describe("usage backfill (M2 S3)", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-backfill-"));
    db = openDb(join(dir, "test.sqlite"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("recomputes ledger from finished runs and is idempotent", async () => {
    const t1 = Date.parse("2026-09-03T00:00:00Z");
    const t2 = Date.parse("2026-09-04T00:00:00Z");
    for (const [id, at] of [["b1", t1], ["b2", t2]] as const) {
      await db.createRun({ id, userId: U, graph, budgetUsd: null, at });
      await db.record(id, nodeFinished("text", 1, 1, 100, 50));
      await db.record(id, nodeFinished("vid", 1, 2, 0, 0));
      await db.finishRun(id, U, "done", at + 1000);
    }

    const first = await backfillUsage(db);
    expect(first.runsProcessed).toBe(2);
    expect(first.users).toBe(1);
    const period = currentPeriodStart(t1);
    expect(await db.usageFor(U, "runs", period)).toBe(2);
    expect(await db.usageFor(U, "tokens_in", period)).toBe(200);
    expect(await db.usageFor(U, "video_segments", period)).toBe(2);

    // Re-run must overwrite, not accumulate → identical totals.
    await backfillUsage(db);
    expect(await db.usageFor(U, "runs", period)).toBe(2);
    expect(await db.usageFor(U, "tokens_in", period)).toBe(200);
    expect(await db.usageFor(U, "video_segments", period)).toBe(2);
  });

  it("ignores unfinished runs", async () => {
    const at = Date.parse("2026-09-05T00:00:00Z");
    await db.createRun({ id: "running1", userId: U, graph, budgetUsd: null, at });
    await db.record("running1", nodeFinished("text", 1, 1));
    // left in 'running' state
    const result = await backfillUsage(db);
    expect(result.runsProcessed).toBe(0);
  });
});
