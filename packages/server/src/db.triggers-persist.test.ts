import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aw-trg-"));
  db = openDb(join(dir, "t.sqlite"));
});

afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("trigger persistence via saveGraphUnscoped", () => {
  it("persists triggers added to an existing graph (NULL-owner upsert bug)", async () => {
    const graph = { id: "g1", name: "G1", nodes: [], edges: [] };
    await db.saveGraph(graph, Date.now(), "u1");

    // TriggerService.upsert does exactly this: read the graph document, push
    // the trigger, saveGraphUnscoped. The ON CONFLICT branch of insertGraph
    // only fires when graphs.user_id = excluded.user_id; saveGraphUnscoped
    // used to pass NULL as the owner, so the update was silently skipped and
    // the trigger never hit disk (lost on restart).
    const existing = (await db.getGraphById("g1"))!;
    const saved = {
      ...existing,
      triggers: [{ id: "trg1", type: "cron", cron: "0 * * * *", enabled: true }],
    };
    await db.saveGraphUnscoped(saved, Date.now());

    const reloaded = await db.getGraphById("g1");
    expect(reloaded?.triggers).toEqual([
      { id: "trg1", type: "cron", cron: "0 * * * *", enabled: true },
    ]);
  });

  it("keeps version/lineage intact when upserting an existing graph", async () => {
    const graph = { id: "g2", name: "G2", nodes: [], edges: [] };
    await db.saveGraph(graph, Date.now(), "u1", undefined, "tpl-x");

    const existing = (await db.getGraphById("g2"))!;
    const vBefore = existing.version;
    await db.saveGraphUnscoped(
      { ...existing, triggers: [{ id: "trg2", type: "cron", cron: "0 9 * * 1", enabled: true }] },
      Date.now(),
    );

    const reloaded = (await db.getGraphById("g2"))!;
    expect(reloaded.triggers).toHaveLength(1);
    expect(reloaded.version).toBe(vBefore + 1);
    const meta = await db.getGraphMeta("g2");
    expect(meta.originTemplateId).toBe("tpl-x");
  });
});
