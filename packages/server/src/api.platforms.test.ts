import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-platforms-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
  vi.stubEnv("ALLOW_REGISTRATION", "1");
  app = (await import("./index.js")).app;
});

afterAll(() => {
  delete process.env.DB_FILE;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function register(email: string): Promise<string> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const m = /auth_token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (!m) throw new Error("no auth_token in set-cookie");
  return m[1]!;
}

function authed(token: string): Record<string, string> {
  return { cookie: `auth_token=${token}`, "content-type": "application/json" };
}

describe("GET /api/platforms (F3)", () => {
  it("returns the five platform profiles and the ad-law baseline", async () => {
    const token = await register("platforms@example.com");
    const res = await app.request("/api/platforms", { headers: authed(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      profiles: Record<string, { label: string; titleMax: number }>;
      adLawBannedWords: string[];
    };
    expect(Object.keys(body.profiles).sort()).toEqual([
      "custom",
      "douyin",
      "taobao",
      "wechat",
      "xiaohongshu",
    ]);
    expect(body.profiles.xiaohongshu.titleMax).toBe(20);
    expect(body.adLawBannedWords).toContain("国家级");
  });
});

describe("banned-terms CRUD (F3)", () => {
  it("creates, lists and deletes a banned term scoped to the user", async () => {
    const token = await register("banned-terms@example.com");
    const headers = authed(token);

    const created = await app.request("/api/banned-terms", {
      method: "POST",
      headers,
      body: JSON.stringify({ term: "联名款", note: "规避用词" }),
    });
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; term: string };
    expect(row.term).toBe("联名款");

    const list = await app.request("/api/banned-terms", { headers });
    const rows = (await list.json()) as Array<{ id: string; term: string }>;
    expect(rows.some((r) => r.term === "联名款")).toBe(true);

    const del = await app.request(`/api/banned-terms/${row.id}`, { method: "DELETE", headers });
    expect(del.status).toBe(204);

    const listAfter = await app.request("/api/banned-terms", { headers });
    const rowsAfter = (await listAfter.json()) as Array<{ term: string }>;
    expect(rowsAfter.some((r) => r.term === "联名款")).toBe(false);
  });

  it("rejects an empty term with 400", async () => {
    const token = await register("banned-empty@example.com");
    const res = await app.request("/api/banned-terms", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ term: "  " }),
    });
    expect(res.status).toBe(400);
  });

  it("isolates banned terms between users", async () => {
    const a = await register("banned-a@example.com");
    const b = await register("banned-b@example.com");
    await app.request("/api/banned-terms", {
      method: "POST",
      headers: authed(a),
      body: JSON.stringify({ term: "A词" }),
    });
    const listB = await app.request("/api/banned-terms", { headers: authed(b) });
    const rowsB = (await listB.json()) as Array<{ term: string }>;
    expect(rowsB.some((r) => r.term === "A词")).toBe(false);
  });
});
