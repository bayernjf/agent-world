import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-idem-"));
  process.env.DB_FILE = join(dir, "i.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  db = openDb(process.env.DB_FILE!);
});

afterAll(() => {
  db.close();
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

async function register(email: string): Promise<{ token: string; userId: string }> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const token = /auth_token=([^;]+)/.exec(cookie)![1]!;
  const { user } = await res.json() as { user: { id: string } };
  return { token, userId: user.id };
}

describe("idempotent run creation (Idempotency-Key)", () => {
  it("reuses the same runId for a duplicate key, new runId for a different key", async () => {
    const { token, userId } = await register("idem@test.dev");
    const graph: Graph = {
      id: "idem-graph",
      name: "Idem",
      nodes: [
        { id: "in", kind: "source", name: "IN", x: 0, y: 0 },
        {
          id: "a",
          kind: "textGen",
          name: "A",
          x: 1,
          y: 0,
          textGen: { model: "fake", prompt: "hi", skills: [], temperature: 0.7, timeoutMs: 60000 },
        },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "in", to: "a", kind: "flow" },
        { id: "e2", from: "a", to: "out", kind: "flow" },
      ],
    };
    db.saveGraph(graph, Date.now(), userId);

    const run = (key: string) =>
      app.request("/api/runs", {
        method: "POST",
        headers: { cookie: `auth_token=${token}`, "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ graphId: "idem-graph" }),
      });

    const first = await run("key-1");
    expect(first.status).toBe(200);
    const { runId: run1 } = await first.json() as { runId: string };

    const second = await run("key-1");
    expect(second.status).toBe(200);
    const { runId: run2, replay } = await second.json() as { runId: string; replay?: boolean };
    expect(run2).toBe(run1);
    expect(replay).toBe(true);

    const third = await run("key-2");
    const { runId: run3 } = await third.json() as { runId: string };
    expect(run3).not.toBe(run1);
  });
});
