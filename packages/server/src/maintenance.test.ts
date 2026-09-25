import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@agent-world/core";
import { openDb, type Db } from "./db.js";
import {
  AUDIT_RETENTION_DAYS,
  EVENT_RETENTION_DAYS,
  MaintenanceLoop,
  pruneRetention,
} from "./maintenance.js";

const DAY_MS = 86_400_000;

const cleanups: Array<() => Promise<void>> = [];

/** A throwaway db per case — pruneRetention is a whole-table DELETE, so sharing
 *  one file would let each case see the previous case's leftovers. */
function freshDb(name: string): Db {
  const dir = mkdtempSync(join(tmpdir(), `aw-${name}-`));
  const db = openDb(join(dir, "t.sqlite"));
  cleanups.push(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

/** One row in `events`. Both ts and the run/graph stamps are explicit args. */
async function seedEvent(db: Db, at: number, tag: string): Promise<void> {
  const graph = { id: `g-${tag}`, name: `G ${tag}`, nodes: [], edges: [] };
  await db.saveGraph(graph, at, "u1");
  await db.createRun({ id: `r-${tag}`, userId: "u1", graph, budgetUsd: null, at, trigger: "manual" });
  await db.record(`r-${tag}`, { type: "run.started", seq: 1, ts: at } as RunEvent);
}

/**
 * One row in `audit_log`. `insertAudit` takes created_at from the clock rather
 * than an argument, so aging an audit row means moving the clock before it.
 */
async function seedAudit(db: Db, at: number, id: string): Promise<void> {
  vi.setSystemTime(at);
  await db.insertAudit({ id, userId: "u1", action: "graph.save" });
}

afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pruneRetention", () => {
  it("clears both tables outside their windows, keeps rows inside, and is idempotent", async () => {
    const db = freshDb("windows");
    const now = Date.parse("2026-09-25T00:00:00Z");
    vi.useFakeTimers();
    await seedEvent(db, now - (EVENT_RETENTION_DAYS + 10) * DAY_MS, "old");
    await seedEvent(db, now - (EVENT_RETENTION_DAYS - 10) * DAY_MS, "new");
    await seedAudit(db, now - (AUDIT_RETENTION_DAYS + 10) * DAY_MS, "au-old");
    await seedAudit(db, now - (EVENT_RETENTION_DAYS + 10) * DAY_MS, "au-inside-audit-window");

    expect(await pruneRetention(db, now)).toEqual({ events: 1, audit: 1 });
    expect(await db.events("r-old")).toHaveLength(0);
    expect(await db.events("r-new")).toHaveLength(1);
    expect(await pruneRetention(db, now)).toEqual({ events: 0, audit: 0 });
  });

  it("keeps a row sitting exactly on the cutoff (pruning is strictly older-than)", async () => {
    const db = freshDb("cutoff");
    const now = Date.parse("2026-12-31T00:00:00Z");
    vi.useFakeTimers();
    await seedEvent(db, now - EVENT_RETENTION_DAYS * DAY_MS, "edge");
    await seedAudit(db, now - EVENT_RETENTION_DAYS * DAY_MS, "au-edge");

    expect(await pruneRetention(db, now)).toEqual({ events: 0, audit: 0 });
    expect(await db.events("r-edge")).toHaveLength(1);
  });
});

function stubDb(events: () => Promise<number>, audit: () => Promise<number>) {
  const pruneOldEvents = vi.fn(events);
  const pruneAuditOlder = vi.fn(audit);
  return { db: { pruneOldEvents, pruneAuditOlder } as unknown as Db, pruneOldEvents, pruneAuditOlder };
}

describe("MaintenanceLoop", () => {
  it("prunes once on start, then once per interval, until stopped", async () => {
    vi.useFakeTimers();
    const { db, pruneOldEvents, pruneAuditOlder } = stubDb(async () => 0, async () => 0);
    const loop = new MaintenanceLoop(db, 60_000);

    loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(pruneOldEvents).toHaveBeenCalledTimes(1);

    loop.start(); // a second start() must not arm a second timer
    await vi.advanceTimersByTimeAsync(60_000 * 3);
    expect(pruneOldEvents).toHaveBeenCalledTimes(4);

    loop.stop();
    await vi.advanceTimersByTimeAsync(60_000 * 5);
    expect(pruneOldEvents).toHaveBeenCalledTimes(4);
    expect(pruneAuditOlder).toHaveBeenCalledTimes(4);
  });

  it("swallows a failing pass, keeps scheduling, and never leaks a rejection", async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { db, pruneOldEvents, pruneAuditOlder } = stubDb(
      async () => {
        throw new Error("SQLITE_BUSY");
      },
      async () => 0,
    );

    const loop = new MaintenanceLoop(db, 60_000);
    loop.start();
    await vi.advanceTimersByTimeAsync(60_000 * 2);
    loop.stop();
    process.off("unhandledRejection", unhandled);

    expect(pruneOldEvents).toHaveBeenCalledTimes(3);
    // events throws first, so audit is never reached — proof the pass aborts
    // where it fails rather than continuing past a broken table.
    expect(pruneAuditOlder).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });
});
