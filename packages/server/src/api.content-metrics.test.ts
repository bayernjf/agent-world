import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerMetricsAdapter } from "./rpa/index.js";

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
let token = "";
const authed = () => ({ cookie: `auth_token=${token}` });

async function registerUser(): Promise<string> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `metrics-${Date.now()}@test.dev`, password: "passw0rd-long" }),
  });
  const m = /auth_token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (!m) throw new Error(`register failed: ${res.status}`);
  return m[1];
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-content-metrics-"));
  process.env.DB_FILE = join(dir, "m.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  token = await registerUser();
});

afterAll(() => {
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/metrics/rpa (collectMetrics wiring, B4)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const r = await app.request("/api/metrics/rpa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "test-platform" }),
    });
    expect(r.status).toBe(401);
  });

  it("rejects an unregistered platform with 404", async () => {
    const r = await app.request("/api/metrics/rpa", {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ platform: "no-such-platform" }),
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("unknown_platform");
  });

  it("collects via the registered adapter, writes rows back and surfaces them in /api/performance", async () => {
    const seen: Array<{ since: number; stateDir: string }> = [];
    registerMetricsAdapter({
      platform: "test-platform",
      async login(stateFile) {
        seen.push({ since: 0, stateDir: stateFile });
        return { ok: true };
      },
      async fetchMetrics(_session, since) {
        seen[seen.length - 1].since = since;
        return [
          { external_content_id: "rpa-note-1", impressions: 500, clicks: 20, conversions: 1, gmv: 9.9 },
          { external_content_id: "rpa-note-2", impressions: 300, clicks: 10, conversions: 0, gmv: 0 },
        ];
      },
    });

    const r = await app.request("/api/metrics/rpa", {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ platform: "test-platform", since: 123456789, graphId: "g-1" }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; collected: number; inserted: number };
    expect(body.ok).toBe(true);
    expect(body.collected).toBe(2);
    expect(body.inserted).toBe(2);
    expect(seen[0].since).toBe(123456789);
    expect(seen[0].stateDir).toContain("rpa-state");

    const perf = await app.request("/api/performance?groupBy=platform", { headers: authed() });
    expect(perf.status).toBe(200);
    const perfBody = (await perf.json()) as Array<{ group: string; impressions: number }>;
    const tp = perfBody.find((row) => row.group === "test-platform");
    expect(tp).toBeDefined();
    expect(tp!.impressions).toBe(800);
  });

  it("surfaces adapter failures as 502 with a readable error", async () => {
    registerMetricsAdapter({
      platform: "broken-platform",
      async login() {
        throw new Error("no credentials yet");
      },
      async fetchMetrics() {
        return [];
      },
    });
    const r = await app.request("/api/metrics/rpa", {
      method: "POST",
      headers: { "content-type": "application/json", ...authed() },
      body: JSON.stringify({ platform: "broken-platform" }),
    });
    expect(r.status).toBe(502);
    const body = (await r.json()) as { error: string; message: string };
    expect(body.error).toBe("rpa_collect_failed");
    expect(body.message).toContain("no credentials yet");
  });
});
