import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { openDb } from "./db.js";
import { ArtifactStore } from "./artifact-store.js";

// Dogfood 2026-09-01 (tpl-product): generated images carried sizeBytes and a
// local `/api/artifacts/up-…` reference on the run's artifact row, but the
// bytes live under the referenced row — the route looked for a blob keyed by
// the run row itself and answered 404 "blob missing on disk".

let dir: string;
let db: ReturnType<typeof openDb>;
let store: ArtifactStore;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
const GRAPH: Graph = { id: "g-lref", name: "G", nodes: [], edges: [] };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-localref-"));
  process.env.DB_FILE = join(dir, "lref.sqlite");
  process.env.ARTIFACT_DIR = join(dir, "blobs");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  db = openDb(process.env.DB_FILE!);
  store = new ArtifactStore(process.env.ARTIFACT_DIR!);
  db.saveGraph(GRAPH, 1, "u-lref");
});

afterAll(() => {
  db.close();
  delete process.env.DB_FILE;
  delete process.env.ARTIFACT_DIR;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

async function register(email: string): Promise<string> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = /auth_token=([^;]+)/.exec(cookie);
  if (!m) throw new Error(`register failed: ${res.status}`);
  return m[1];
}

/** Seed the same two-row shape a generated image produces: an `up-…` row that
 *  owns the bytes, and a run row that only references it. */
async function seedLocalRefPair(userEmail: string, runId: string): Promise<string> {
  const user = db.findUserByEmail(userEmail)!;
  db.createRun({ id: runId, userId: user.id, graph: GRAPH, budgetUsd: null, at: Date.now() });
  const uploaded = await store.saveBinary({
    userId: user.id,
    data: PNG,
    kind: "image",
    mimeType: "image/png",
    label: "AI 配图",
  });
  db.insertArtifact(uploaded, user.id);
  const refRow = await store.save(
    { id: `${runId.slice(0, 8)}-banner-img-0`, kind: "image", uri: uploaded.uri ?? undefined, mimeType: "image/png", sizeBytes: PNG.length },
    { runId, nodeId: "banner" },
  );
  db.insertArtifact(refRow, user.id);
  return refRow.id;
}

describe("local-reference artifact serving", () => {
  let token: string;
  let refId: string;

  beforeAll(async () => {
    token = await register("owner@test.dev");
    refId = await seedLocalRefPair("owner@test.dev", "8f205215-d0a9-487b-bdd6-1b6050d3c037");
  });

  it("streams the referenced blob for a run row that points at a local /api/artifacts/ uri", async () => {
    const res = await app.request(`/api/artifacts/${refId}`, {
      headers: { cookie: `auth_token=${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("still refuses another user's reference row (ownership is not inherited)", async () => {
    const other = await register("intruder@test.dev");
    const res = await app.request(`/api/artifacts/${refId}`, {
      headers: { cookie: `auth_token=${other}` },
    });
    expect(res.status).toBe(404);
  });
});
