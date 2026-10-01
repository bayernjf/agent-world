import { afterEach, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb, type Db } from "./db.js";
import { dispatchGate, readHaltedTtlDays } from "./dispatch-gate.js";

/**
 * Stale-halted auto-scrap (2026-10-02 M1 incident):
 * five halted translation runs (09-13..09-19) sat undecided for two weeks and
 * filled the owner's concurrency slot (pro limit 5), so every cron dispatch was
 * rejected with "并发上限 5 已满" even after the monthly token quota reset.
 * The fix: before dispatch, auto-scrap halted runs older than
 * `HALTED_RUN_TTL_DAYS` (default 7) — event-stream-consistent, halt info kept.
 */

const U = "u-halted-ttl-test";

function minimalGraph(): Graph {
  return { id: "g-halted-ttl", name: "TTL", nodes: [], edges: [] };
}

async function seedHaltedRun(db: Db, runId: string, startedAt: number, haltedAt: number, reason = "human:确认可否发布") {
  await db.createRun({
    id: runId,
    userId: U,
    graph: minimalGraph(),
    budgetUsd: null,
    at: startedAt,
    input: "x",
  });
  await db.record(runId, {
    type: "run.finished",
    runId,
    status: "halted",
    haltedNodeId: "rev",
    reason,
    seq: 0,
    ts: haltedAt,
  });
  await db.finishRun(runId, U, "halted", haltedAt, { nodeId: "rev", reason });
}

describe("scrapStaleHaltedRuns", () => {
  let db: Db;

  afterEach(() => {
    db.close();
  });

  it("scraps only stale halted runs, keeps halt info, appends run.finished", async () => {
    db = openDb(":memory:");
    await db.createUser(U, "ttl@test.dev", "secret123");
    const now = Date.now();
    await seedHaltedRun(db, "r-stale", now - 9 * 86_400_000, now - 8 * 86_400_000);
    await seedHaltedRun(db, "r-fresh", now - 2 * 86_400_000, now - 86_400_000);

    const n = await db.scrapStaleHaltedRuns(U, now - 7 * 86_400_000);
    expect(n).toBe(1);

    const stale = await db.getRun("r-stale", U);
    expect(stale?.status).toBe("failed");
    // halt context preserved for audit
    expect(stale?.halted_node_id).toBe("rev");
    expect(stale?.halted_reason).toBe("human:确认可否发布");

    const fresh = await db.getRun("r-fresh", U);
    expect(fresh?.status).toBe("halted");

    // event log: run.finished(failed) appended right after the halt event
    const evs = await db.events("r-stale");
    const last = evs[evs.length - 1];
    expect(last).toMatchObject({ type: "run.finished", status: "failed", seq: 1 });
  });

  it("no-op when nothing is stale and active runs drop to zero", async () => {
    db = openDb(":memory:");
    await db.createUser(U, "ttl2@test.dev", "secret123");
    const now = Date.now();
    await seedHaltedRun(db, "r-only", now - 86_400_000, now - 2 * 86_400_000);

    expect(await db.scrapStaleHaltedRuns(U, now - 7 * 86_400_000)).toBe(0);
    expect(await db.activeRuns(U)).toBe(1); // fresh halted still counts
  });
});

describe("dispatchGate stale-halted hook", () => {
  let db: Db;

  afterEach(() => {
    db.close();
  });

  it("scraps stale halted runs before dispatch even with the gate off", async () => {
    db = openDb(":memory:");
    await db.createUser(U, "ttl3@test.dev", "secret123");
    const now = Date.now();
    await seedHaltedRun(db, "r-gate", now - 9 * 86_400_000, now - 8 * 86_400_000);

    await dispatchGate({ db, graph: minimalGraph(), userId: U, trigger: "test", mode: "off" });

    const run = await db.getRun("r-gate", U);
    expect(run?.status).toBe("failed");
    expect(await db.activeRuns(U)).toBe(0);
  });

  it("leaves fresh halted runs alone when gate is on (still blocks, but keeps the queue)", async () => {
    db = openDb(":memory:");
    await db.createUser(U, "ttl4@test.dev", "secret123");
    const now = Date.now();
    await seedHaltedRun(db, "r-keep", now - 86_400_000, now - 2 * 86_400_000);

    await dispatchGate({ db, graph: minimalGraph(), userId: U, trigger: "test", mode: "observe" });
    const run = await db.getRun("r-keep", U);
    expect(run?.status).toBe("halted");
  });
});

describe("readHaltedTtlDays", () => {
  it("parses env and falls back to 7 days", () => {
    expect(readHaltedTtlDays("3")).toBe(3);
    expect(readHaltedTtlDays("")).toBe(7);
    expect(readHaltedTtlDays("abc")).toBe(7);
    expect(readHaltedTtlDays(undefined)).toBe(7);
  });
});
