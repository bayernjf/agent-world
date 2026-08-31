import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Artifact, Graph } from "@agent-world/core";
import { openDb } from "./db.js";
import { ArtifactStore } from "./artifact-store.js";
import { guardedFetch } from "./ssrf.js";

// /api/proxy egress goes through guardedFetch — mock it so the size-cap tests
// do not touch the network. Hoisted before index.js is imported.
vi.mock("./ssrf.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ssrf.js")>();
  return {
    ...actual,
    guardedFetch: vi.fn(),
  };
});

let dir: string;
let db: ReturnType<typeof openDb>;
let store: ArtifactStore;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
const GRAPH: Graph = { id: "g-l27", name: "G", nodes: [], edges: [] };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-l27-"));
  process.env.DB_FILE = join(dir, "l27.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  db = openDb(process.env.DB_FILE!);
  store = new ArtifactStore(join(dir, "blobs"));
  db.saveGraph(GRAPH, 1, "u-l27");
});

afterAll(() => {
  db.close();
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
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

async function seedRemoteArtifact(userEmail: string, id: string, uri: string): Promise<void> {
  const user = db.findUserByEmail(userEmail)!;
  db.createRun({ id: `run-${id}`, userId: user.id, graph: GRAPH, budgetUsd: null, at: Date.now() });
  const artifact: Artifact = { id, kind: "image", uri };
  const saved = await store.save(artifact, { runId: `run-${id}`, nodeId: "n1" });
  db.insertArtifact(saved, user.id);
}

describe("isSafeRedirectUri (audit L2)", () => {
  let isSafeRedirectUri: (uri: string) => boolean;
  beforeAll(async () => {
    const mod = await import("./index.js");
    isSafeRedirectUri = mod.isSafeRedirectUri;
  });

  it("allows http(s) only", () => {
    expect(isSafeRedirectUri("https://x.com/a")).toBe(true);
    expect(isSafeRedirectUri("http://x.com/a")).toBe(true);
    expect(isSafeRedirectUri("file:///etc/passwd")).toBe(false);
    expect(isSafeRedirectUri("data:text/html,x")).toBe(false);
    expect(isSafeRedirectUri("javascript:alert(1)")).toBe(false);
  });
});

describe("artifact redirect protocol guard (audit L2)", () => {
  let token: string;
  beforeAll(async () => {
    token = await register("l2@test.dev");
  });

  it("redirects http(s) artifact uris to their location", async () => {
    await seedRemoteArtifact("l2@test.dev", "ok-http", "https://cdn.example.com/a.png");
    const res = await app.request("/api/artifacts/ok-http", { headers: { cookie: `auth_token=${token}` } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cdn.example.com/a.png");
  });

  it("refuses non-http(s) artifact uris (file:/data:…) instead of redirecting", async () => {
    await seedRemoteArtifact("l2@test.dev", "evil-file", "file:///etc/passwd");
    await seedRemoteArtifact("l2@test.dev", "evil-data", "data:text/html,<script>");
    const a = await app.request("/api/artifacts/evil-file", { headers: { cookie: `auth_token=${token}` } });
    expect(a.status).toBe(404);
    expect(a.headers.get("location")).toBeNull();
    const b = await app.request("/api/artifacts/evil-data", { headers: { cookie: `auth_token=${token}` } });
    expect(b.status).toBe(404);
  });
});

describe("/api/proxy response size cap (audit L7)", () => {
  let token: string;
  beforeAll(async () => {
    token = await register("l7@test.dev");
    // Default mock: a small ok response unless a specific test overrides it.
    vi.mocked(guardedFetch).mockImplementation(async () => new Response(new Uint8Array(8), { status: 200 }));
  });

  function proxy(url: string): Promise<Response> {
    return app.request(url, { headers: { cookie: `auth_token=${token}` } });
  }

  it("serves a small upstream body", async () => {
    const res = await proxy("/api/proxy?url=http://example.com/small");
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).byteLength).toBe(8);
  });

  it("rejects an oversized upstream body while streaming (25 MiB cap)", async () => {
    const big = new Uint8Array(26 * 1024 * 1024); // > 25 MiB
    vi.mocked(guardedFetch).mockImplementationOnce(async () => new Response(big, { status: 200 }));
    const res = await proxy("/api/proxy?url=http://example.com/huge");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("too large");
  });

  it("rejects an upstream that advertises an oversized content-length up front", async () => {
    vi.mocked(guardedFetch).mockImplementationOnce(async () =>
      new Response(null, { status: 200, headers: { "content-length": "99999999" } }),
    );
    const res = await proxy("/api/proxy?url=http://example.com/declared-huge");
    expect(res.status).toBe(502);
  });
});
