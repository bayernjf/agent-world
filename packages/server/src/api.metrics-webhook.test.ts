import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-metrics-webhook-"));
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

async function createTarget(token: string, metricsSecret?: string): Promise<string> {
  const res = await app.request("/api/publish-targets", {
    method: "POST",
    headers: authed(token),
    body: JSON.stringify({
      platform: "wechat",
      name: "中台",
      provider: "webhook",
      url: "https://mid-tier.example.com/publish",
      metricsSecret,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function webhook(targetId: string, opts: { secret?: string; timestamp?: number; metrics?: unknown[] }) {
  return app.request(`/api/metrics/webhook/${targetId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.timestamp != null ? { "x-webhook-timestamp": String(opts.timestamp) } : {}),
      ...(opts.secret != null ? { "x-webhook-secret": opts.secret } : {}),
    },
    body: JSON.stringify({ metrics: opts.metrics ?? [] }),
  });
}

const sampleMetrics = [
  { external_content_id: "note-1", impressions: 1000, clicks: 50, conversions: 5, gmv: 999 },
];

describe("POST /api/metrics/webhook/:targetId (F6)", () => {
  it("accepts a valid secret + fresh timestamp and records metrics", async () => {
    const token = await register("mw-ok@example.com");
    const targetId = await createTarget(token, "s3cret");
    const res = await webhook(targetId, { secret: "s3cret", timestamp: Date.now(), metrics: sampleMetrics });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { inserted: number }).inserted).toBe(1);
  });

  it("rejects a wrong secret", async () => {
    const token = await register("mw-bad-secret@example.com");
    const targetId = await createTarget(token, "s3cret");
    const res = await webhook(targetId, { secret: "wrong", timestamp: Date.now(), metrics: sampleMetrics });
    expect(res.status).toBe(401);
  });

  it("rejects a channel with no configured secret (no escape hatch)", async () => {
    const token = await register("mw-no-secret@example.com");
    const targetId = await createTarget(token, undefined);
    const res = await webhook(targetId, { secret: "anything", timestamp: Date.now(), metrics: sampleMetrics });
    expect(res.status).toBe(401);
  });

  it("rejects a missing timestamp (replay defence)", async () => {
    const token = await register("mw-no-ts@example.com");
    const targetId = await createTarget(token, "s3cret");
    const res = await webhook(targetId, { secret: "s3cret", metrics: sampleMetrics });
    expect(res.status).toBe(401);
  });

  it("rejects a stale timestamp outside the replay window", async () => {
    const token = await register("mw-stale-ts@example.com");
    const targetId = await createTarget(token, "s3cret");
    const res = await webhook(targetId, { secret: "s3cret", timestamp: Date.now() - 10 * 60 * 1000, metrics: sampleMetrics });
    expect(res.status).toBe(401);
  });

  it("skips metrics that link to nothing", async () => {
    const token = await register("mw-unlinked@example.com");
    const targetId = await createTarget(token, "s3cret");
    const res = await webhook(targetId, {
      secret: "s3cret",
      timestamp: Date.now(),
      metrics: [{ impressions: 5 }, { external_content_id: "note-2", impressions: 7 }],
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { inserted: number }).inserted).toBe(1);
  });
});
