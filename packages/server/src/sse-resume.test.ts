import { describe, it, expect, beforeAll } from "vitest";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";
import { signToken } from "./auth.js";
import type { RunEvent } from "@agent-world/core";

// Real-world network-drop test for SSE resume (roadmap 3.3).
//
// The client uses native EventSource and, on a dropped connection, reconnects
// with `?after=<lastSeq>`. This test drives the actual `/stream` endpoint: it
// opens the stream, cancels it mid-flight to simulate a drop, then reconnects
// with the resume point and asserts the reassembled event log has no gaps and
// no duplicates.

const tmp = path.join(
  os.tmpdir(),
  `aw-sse-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
);

const RUN = "sse-drop-run";
const COUNT = 10;
let authToken = "";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DB_FILE = tmp;
  const db = openDb(tmp);
  db.createRun({
    id: RUN,
    userId: "u1",
    graph: { id: "g", nodes: [], edges: [] } as never,
    budgetUsd: null,
    at: 0,
  });
  for (let seq = 0; seq < COUNT; seq++) {
    const ev = {
      seq,
      ts: seq,
      version: 1,
      type: "node.output",
      nodeId: "n1",
      output: { text: `e${seq}` },
    } as unknown as RunEvent;
    db.record(RUN, ev);
  }
  authToken = await signToken("u1", "u1@local.dev");
  db.close();
});

async function collect(
  app: Awaited<typeof import("./index.js")>["app"],
  after: number,
  dropAfterSeq: number | null,
  useHeader: boolean = false,
): Promise<number[]> {
  const params = new URLSearchParams();
  if (after >= 0 && !useHeader) params.set("after", String(after));
  params.set("token", authToken);
  const url = `/api/runs/${RUN}/stream?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (after >= 0 && useHeader) headers["Last-Event-ID"] = String(after);
  const res = await app.request(url, { headers });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const seqs: number[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = JSON.parse(dataLine.slice(5).trim()) as {
          event: RunEvent;
        };
        seqs.push(payload.event.seq);
        if (dropAfterSeq !== null && payload.event.seq >= dropAfterSeq) {
          await reader.cancel();
          return seqs;
        }
      }
    }
  } catch {
    // A cancelled stream can throw on the next read; that's expected here.
  }
  return seqs;
}

describe("SSE resume after a network drop", () => {
  it("reassembles the full log with no gaps or duplicates", async () => {
    const { app } = await import("./index.js");

    // First connection: read until seq 4, then drop (simulated network loss).
    const first = await collect(app, -1, 4);
    expect(first[first.length - 1]).toBe(4);

    // Reconnect from the last fully received seq, like the client does.
    const lastSeq = first[first.length - 1];
    const second = await collect(app, lastSeq, null);

    const all = [...first, ...second];
    expect(new Set(all).size).toBe(all.length); // no duplicates
    expect([...all].sort((a, b) => a - b)).toEqual(
      Array.from({ length: COUNT }, (_, i) => i), // full 0..9 coverage
    );
  });

  it("recovers from an immediate drop at seq 0", async () => {
    const { app } = await import("./index.js");

    const first = await collect(app, -1, 0);
    expect(first).toEqual([0]);

    const second = await collect(app, 0, null);
    const all = [...first, ...second];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort((a, b) => a - b)).toEqual(
      Array.from({ length: COUNT }, (_, i) => i),
    );
  });

  it("resumes via Last-Event-ID header (native EventSource behaviour)", async () => {
    const { app } = await import("./index.js");

    // First connection: read until seq 6, then drop.
    const first = await collect(app, -1, 6);
    expect(first[first.length - 1]).toBe(6);

    // Reconnect using the Last-Event-ID header (what native EventSource sends).
    const lastSeq = first[first.length - 1];
    const second = await collect(app, lastSeq, null, true);

    const all = [...first, ...second];
    expect(new Set(all).size).toBe(all.length); // no duplicates
    expect([...all].sort((a, b) => a - b)).toEqual(
      Array.from({ length: COUNT }, (_, i) => i), // full 0..9 coverage
    );
  });
});
