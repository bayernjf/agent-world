import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import type { Graph, RunEvent } from "@agent-world/core";

const U = "u1";
const graph: Graph = {
  id: "g1",
  name: "G1",
  nodes: [{ id: "n1", kind: "textGen", name: "N1", x: 0, y: 0 }],
  edges: [],
};

function started(seq: number): RunEvent {
  return {
    seq,
    ts: seq * 1000,
    version: 1,
    type: "run.started",
    runId: "r1",
    graphId: "g1",
    budgetUsd: null,
  } as RunEvent;
}

describe("events pagination", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-events-"));
    db = openDb(join(dir, "test.sqlite"));
    db.saveGraph(graph, 1, U);
    db.createRun({ id: "r1", userId: U, graph, budgetUsd: null, at: 1000 });
    for (let i = 0; i < 10; i++) db.record("r1", started(i));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns all events without a window", () => {
    expect(db.events("r1")).toHaveLength(10);
  });

  it("pages from an exclusive cursor and reports nextCursor", () => {
    const first = db.eventsRange("r1", -1, 4);
    expect(first.events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(first.nextCursor).toBe(3);

    const second = db.eventsRange("r1", first.nextCursor!, 4);
    expect(second.events.map((e) => e.seq)).toEqual([4, 5, 6, 7]);
    expect(second.nextCursor).toBe(7);

    const last = db.eventsRange("r1", second.nextCursor!, 4);
    expect(last.events.map((e) => e.seq)).toEqual([8, 9]);
    expect(last.nextCursor).toBeNull();
  });
});
