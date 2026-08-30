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
      kind: "agent",
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

  it("saveVersion stores the content hash alongside the snapshot", () => {
    db.saveGraph(graph("g", "G", 1), 1, U);
    const snapshot = JSON.stringify(graph("g", "G", 1));
    db.saveVersion("g", "v1", snapshot, "", contentHash(snapshot));
    const list = db.listVersions("g", U);
    expect(list).toHaveLength(1);
    expect(list[0]!.contentHash).toBe(contentHash(snapshot));
  });

  it("saveAutoSnapshot captures the old graph content before overwrite", () => {
    const g1 = graph("g", "G", 1);
    db.saveGraph(g1, 1, U);
    const id = db.saveAutoSnapshot("g", JSON.stringify(g1), 0, 30);
    expect(id).not.toBeNull();

    // Overwrite with different content, then check the snapshot round-trips.
    db.saveGraph(graph("g", "G", 3), 2, U);
    const list = db.listVersions("g", U);
    expect(list).toHaveLength(1);
    expect(list[0]!.note).toBe("auto");
    expect(list[0]!.name).toMatch(/^auto-/);
    expect(list[0]!.contentHash).toBe(contentHash(JSON.stringify(g1)));

    const v = db.getVersion(list[0]!.id, U)!;
    expect(JSON.parse(v.snapshot)).toEqual(g1);
  });

  it("throttles: same content within the window is skipped, different content is not", () => {
    const g1 = graph("g", "G", 1);
    db.saveGraph(g1, 1, U);
    // First call always captures (no prior snapshot to compare with).
    expect(db.saveAutoSnapshot("g", JSON.stringify(g1), 60 * 60 * 1000, 30)).not.toBeNull();
    // Same content within the window: skipped.
    expect(db.saveAutoSnapshot("g", JSON.stringify(g1), 60 * 60 * 1000, 30)).toBeNull();
    expect(db.listVersions("g", U)).toHaveLength(1);

    // Different content within the window is still captured (hash mismatch).
    const g2 = graph("g", "G", 2);
    expect(db.saveAutoSnapshot("g", JSON.stringify(g2), 60 * 60 * 1000, 30)).not.toBeNull();
    expect(db.listVersions("g", U)).toHaveLength(2);

    // Zero interval means "never throttle": identical content is captured again.
    expect(db.saveAutoSnapshot("g", JSON.stringify(g2), 0, 30)).not.toBeNull();
    expect(db.listVersions("g", U)).toHaveLength(3);
  });

  it("rolls auto snapshots down to maxKeep but never prunes manual ones", () => {
    db.saveGraph(graph("g", "G", 1), 1, U);
    // A manual snapshot that must survive pruning.
    db.saveVersion("g", "manual", JSON.stringify(graph("g", "G", 1)), "keep me");

    for (let i = 0; i < 6; i++) {
      db.saveAutoSnapshot("g", JSON.stringify(graph("g", `G${i}`, i)), 0, 3);
    }

    const list = db.listVersions("g", U);
    const autos = list.filter((v) => v.note === "auto");
    const manuals = list.filter((v) => v.note !== "auto");
    expect(autos).toHaveLength(3); // rolled down to maxKeep=3
    expect(manuals).toHaveLength(1); // untouched
    // The newest autos survive (G5..G3), the oldest (G0..G2) are pruned.
    const v = db.getVersion(autos[0]!.id, U)!;
    expect(JSON.parse(v.snapshot).name).toBe("G5");
  });

  it("restores an auto snapshot through the same path as a manual one", () => {
    const g1 = graph("g", "G", 1);
    db.saveGraph(g1, 1, U);
    db.saveAutoSnapshot("g", JSON.stringify(g1), 0, 30);
    db.saveGraph(graph("g", "G-changed", 5), 2, U);

    const list = db.listVersions("g", U);
    const v = db.getVersion(list[0]!.id, U)!;
    const restored = JSON.parse(v.snapshot) as Graph;
    db.saveGraph(restored, 3, U);
    expect(db.getGraph("g", U)!.nodes).toHaveLength(1);
  });
});
