import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-metrics-"));
  process.env.DB_FILE = join(dir, "m.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
});

afterAll(() => {
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /metrics (Prometheus exposition)", () => {
  it("exposes metrics and records an /api request", async () => {
    await app.request("/api/health");
    const r = await app.request("/metrics");
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain("# TYPE runs_total counter");
    expect(text).toContain('http_requests_total{method="GET",status="200"}');
  });
});
