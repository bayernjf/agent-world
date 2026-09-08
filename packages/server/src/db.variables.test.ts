import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";

function testGraph(id: string): Graph {
  return {
    id,
    name: `graph-${id}`,
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0, source: {} },
      { id: "depot", kind: "sink", name: "DEPOT", x: 100, y: 0 },
    ],
    edges: [{ id: "e1", from: "src", to: "depot", kind: "flow" }],
  };
}

describe("graph variables persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-var-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips variables across runs and keeps JSON types", async () => {
    const db = openDb(join(dir, "v.sqlite"));
    await db.saveGraph(testGraph("g1"), 0, "u1");
    await db.saveGraphVariables("g1", "u1", { brand: "可口可乐", stats: { count: 3 }, flag: false });
    expect(await db.loadGraphVariables("g1", "u1")).toEqual({
      brand: "可口可乐",
      stats: { count: 3 },
      flag: false,
    });
    // A later run only touches one key — per-key upsert keeps the others.
    await db.saveGraphVariables("g1", "u1", { stats: { count: 4 } });
    expect(await db.loadGraphVariables("g1", "u1")).toEqual({
      brand: "可口可乐",
      stats: { count: 4 },
      flag: false,
    });
    await db.close();
  });

  it("is tenant-scoped: another user cannot read or write a graph's variables", async () => {
    const db = openDb(join(dir, "v.sqlite"));
    await db.saveGraph(testGraph("g1"), 0, "u1");
    await db.saveGraphVariables("g1", "u1", { secret: 1 });
    expect(await db.loadGraphVariables("g1", "u2")).toEqual({});
    // Silent no-op write from another tenant.
    await db.saveGraphVariables("g1", "u2", { hacked: true });
    expect(await db.loadGraphVariables("g1", "u1")).toEqual({ secret: 1 });
    await db.close();
  });

  it("isolates variables per graph", async () => {
    const db = openDb(join(dir, "v.sqlite"));
    await db.saveGraph(testGraph("g1"), 0, "u1");
    await db.saveGraph(testGraph("g2"), 0, "u1");
    await db.saveGraphVariables("g1", "u1", { a: 1 });
    await db.saveGraphVariables("g2", "u1", { b: 2 });
    expect(await db.loadGraphVariables("g1", "u1")).toEqual({ a: 1 });
    expect(await db.loadGraphVariables("g2", "u1")).toEqual({ b: 2 });
    await db.close();
  });
});
