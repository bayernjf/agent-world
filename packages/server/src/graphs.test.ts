import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import type { Graph } from "@agent-world/core";

const U = "u1";

function emptyGraph(id: string, name: string): Graph {
  return { id, name, nodes: [], edges: [] };
}

describe("graphs db", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-graphs-"));
    db = openDb(join(dir, "test.sqlite"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates, lists, and deletes graphs", () => {
    expect(db.listGraphs(U)).toHaveLength(0);
    db.saveGraph(emptyGraph("a", "Alpha"), 1, U);
    db.saveGraph(emptyGraph("b", "Beta"), 2, U);
    expect(db.listGraphs(U).map((g) => g.id)).toEqual(["b", "a"]);

    db.deleteGraph("a", U);
    expect(db.listGraphs(U).map((g) => g.id)).toEqual(["b"]);
  });

  it("duplicates a graph with deep-copied nodes and edges", () => {
    const src: Graph = {
      id: "src",
      name: "Source",
      nodes: [{ id: "n1", kind: "textGen", name: "N1", x: 0, y: 0 }],
      edges: [{ id: "e1", from: "n1", to: "n1", kind: "flow" }],
    };
    db.saveGraph(src, 1, U);
    const copy = db.getGraph("src", U)!;
    copy.id = "copy";
    copy.nodes[0]!.id = "n2";
    db.saveGraph(copy, 2, U);

    const original = db.getGraph("src", U)!;
    expect(original.nodes[0]!.id).toBe("n1");
    expect(db.listGraphs(U)).toHaveLength(2);
  });
});

describe("graph optimistic locking", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-lock-"));
    db = openDb(join(dir, "test.sqlite"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("increments version on each save and reports it on read", () => {
    const r1 = db.saveGraph(emptyGraph("g", "G"), 1, U);
    expect(r1.ok).toBe(true);
    expect(r1.ok && r1.version).toBe(1);
    const r2 = db.saveGraph(emptyGraph("g", "G2"), 2, U);
    expect(r2.ok && r2.version).toBe(2);
    expect(db.getGraph("g", U)!.version).toBe(2);
  });

  it("rejects a conditional save against a stale version with conflict", () => {
    db.saveGraph(emptyGraph("g", "G"), 1, U);
    // Tab B saves first, bumping version to 2.
    db.saveGraph(emptyGraph("g", "From B"), 2, U);
    // Tab A still holds version 1 and tries to save.
    const stale = db.saveGraph(emptyGraph("g", "From A"), 3, U, 1);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.conflict).toBe(true);
      expect(stale.serverVersion).toBe(2);
    }
    // The stale write must not have overwritten tab B's document.
    expect(db.getGraph("g", U)!.name).toBe("From B");
  });
});
