import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@agent-world/core";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aw-maint-"));
  db = openDb(join(dir, "m.sqlite"));
});

afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("db maintenance (prune + integrity)", () => {
  it("verifyIntegrity returns true for a fresh db", async () => {
    expect(await db.verifyIntegrity()).toBe(true);
  });

  it("pruneOldEvents deletes old events and keeps recent ones", async () => {
    const graph = { id: "g", name: "G", nodes: [], edges: [] };
    await db.saveGraph(graph, Date.now(), "u1");
    await db.createRun({ id: "r1", userId: "u1", graph, budgetUsd: null, at: Date.now(), trigger: "manual" });

    const old = Date.now() - 200 * 86_400_000;
    const recent = Date.now();
    await db.record("r1", { type: "run.started", seq: 1, ts: old } as RunEvent);
    await db.record("r1", { type: "run.finished", seq: 2, ts: recent } as RunEvent);

    const pruned = await db.pruneOldEvents(Date.now() - 90 * 86_400_000);
    expect(pruned).toBe(1);

    const remaining = await db.events("r1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.seq).toBe(2);
  });

  it("pruneAuditOlder keeps audit rows inside the 180-day window", async () => {
    const now = Date.now();
    vi.useFakeTimers();
    try {
      // insertAudit stamps created_at from the clock, so age the rows by moving it.
      vi.setSystemTime(now - 200 * 86_400_000);
      await db.insertAudit({ id: "audit-old", userId: "u9", action: "graph.save" });
      vi.setSystemTime(now - 10 * 86_400_000);
      await db.insertAudit({ id: "audit-new", userId: "u9", action: "graph.save" });
    } finally {
      vi.useRealTimers();
    }

    expect(await db.pruneAuditOlder(now - 180 * 86_400_000)).toBe(1);

    const rows = await db.listAudit("u9", { limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("audit-new");
  });
});
