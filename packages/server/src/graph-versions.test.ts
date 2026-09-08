import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, contentHash } from "./db.js";
import type { Graph } from "@agent-world/core";

const U = "u1";

function graph(id: string, name: string, nodeCount: number): Graph {
  return {
    id,
    name,
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `n${i}`,
      kind: "textGen",
      name: `N${i}`,
      x: i * 100,
      y: 0,
    })),
    edges: [],
  };
}

describe("graph versions db", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-versions-"));
    db = openDb(join(dir, "test.sqlite"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("saveVersion stores the content hash alongside the snapshot", async () => {
    await db.saveGraph(graph("g", "G", 1), 1, U);
    const snapshot = JSON.stringify(graph("g", "G", 1));
    await db.saveVersion("g", "v1", snapshot, "", contentHash(snapshot));
    const list = await db.listVersions("g", U);
    expect(list).toHaveLength(1);
    expect(list[0]!.contentHash).toBe(contentHash(snapshot));
  });

  it("saveAutoSnapshot captures the old graph content before overwrite", async () => {
    const g1 = graph("g", "G", 1);
    await db.saveGraph(g1, 1, U);
    const id = await db.saveAutoSnapshot("g", JSON.stringify(g1), 0, 30);
    expect(id).not.toBeNull();

    // Overwrite with different content, then check the snapshot round-trips.
    await db.saveGraph(graph("g", "G", 3), 2, U);
    const list = await db.listVersions("g", U);
    expect(list).toHaveLength(1);
    expect(list[0]!.note).toBe("auto");
    expect(list[0]!.name).toMatch(/^auto-/);
    expect(list[0]!.contentHash).toBe(contentHash(JSON.stringify(g1)));

    const v = await await await db.getVersion(list[0]!.id, U)!;
    expect(JSON.parse(v.snapshot)).toEqual(g1);
  });

  it("throttles: same content within the window is skipped, different content is not", async () => {
    const g1 = graph("g", "G", 1);
    await db.saveGraph(g1, 1, U);
    // First call always captures (no prior snapshot to compare with).
    expect(await db.saveAutoSnapshot("g", JSON.stringify(g1), 60 * 60 * 1000, 30)).not.toBeNull();
    // Same content within the window: skipped.
    expect(await db.saveAutoSnapshot("g", JSON.stringify(g1), 60 * 60 * 1000, 30)).toBeNull();
    expect(await db.listVersions("g", U)).toHaveLength(1);

    // Different content within the window is still captured (hash mismatch).
    const g2 = graph("g", "G", 2);
    expect(await db.saveAutoSnapshot("g", JSON.stringify(g2), 60 * 60 * 1000, 30)).not.toBeNull();
    expect(await db.listVersions("g", U)).toHaveLength(2);

    // Zero interval means "never throttle": identical content is captured again.
    expect(await db.saveAutoSnapshot("g", JSON.stringify(g2), 0, 30)).not.toBeNull();
    expect(await db.listVersions("g", U)).toHaveLength(3);
  });

  it("rolls auto snapshots down to maxKeep but never prunes manual ones", async () => {
    await db.saveGraph(graph("g", "G", 1), 1, U);
    // A manual snapshot that must survive pruning.
    await db.saveVersion("g", "manual", JSON.stringify(graph("g", "G", 1)), "keep me");

    for (let i = 0; i < 6; i++) {
      await db.saveAutoSnapshot("g", JSON.stringify(graph("g", `G${i}`, i)), 0, 3);
    }

    const list = await db.listVersions("g", U);
    const autos = list.filter((v) => v.note === "auto");
    const manuals = list.filter((v) => v.note !== "auto");
    expect(autos).toHaveLength(3); // rolled down to maxKeep=3
    expect(manuals).toHaveLength(1); // untouched
    // The newest autos survive (G5..G3), the oldest (G0..G2) are pruned.
    const v = await await await db.getVersion(autos[0]!.id, U)!;
    expect(JSON.parse(v.snapshot).name).toBe("G5");
  });

  it("restores an auto snapshot through the same path as a manual one", async () => {
    const g1 = graph("g", "G", 1);
    await db.saveGraph(g1, 1, U);
    await db.saveAutoSnapshot("g", JSON.stringify(g1), 0, 30);
    await db.saveGraph(graph("g", "G-changed", 5), 2, U);

    const list = await db.listVersions("g", U);
    const v = await await await db.getVersion(list[0]!.id, U)!;
    const restored = JSON.parse(v.snapshot) as Graph;
    await db.saveGraph(restored, 3, U);
    expect((await db.getGraph("g", U))!.nodes).toHaveLength(1);
  });

  it("getLatestRunContentHash returns the hash of the most recent run's graph", async () => {
    expect(await db.getLatestRunContentHash("g", U)).toBeNull(); // never ran

    const g1 = graph("g", "G", 1);
    await db.createRun({ id: "r1", userId: U, graph: g1, budgetUsd: null, at: 100 });
    await db.createRun({ id: "r2", userId: U, graph: graph("g", "G", 2), budgetUsd: null, at: 200 });
    expect(await db.getLatestRunContentHash("g", U)).toBe(contentHash(JSON.stringify(graph("g", "G", 2))));

    // A snapshot of the same content matches the run hash (panel flag logic).
    await db.saveGraph(g1, 1, U);
    await db.saveAutoSnapshot("g", JSON.stringify(g1), 0, 30);
    expect((await db.listVersions("g", U))[0]!.contentHash).not.toBe(await db.getLatestRunContentHash("g", U));
  });
});
