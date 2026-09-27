import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

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

describe("GET /metrics with METRICS_TOKEN set", () => {
  const TOKEN = "scrape-sekret";
  beforeEach(() => {
    // Set for the whole block rather than per-test: the "refuses" cases have to
    // be in the authenticated configuration to mean anything.
    process.env.METRICS_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  it("refuses an unauthenticated scrape and says how to authenticate", async () => {
    const r = await app.request("/metrics");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe("Bearer");
    // A bare token without the scheme is not something a scraper can send, so
    // it is treated as missing rather than guessed at.
    expect((await app.request("/metrics", { headers: { authorization: TOKEN } })).status).toBe(401);
  });

  it("refuses a wrong token", async () => {
    const r = await app.request("/metrics", { headers: { authorization: "Bearer not-it" } });
    expect(r.status).toBe(401);
  });

  it("serves the exposition for the right token", async () => {
    const r = await app.request("/metrics", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("# TYPE http_requests_total counter");
  });

  it("goes back to open the moment the token is unset", async () => {
    process.env.METRICS_TOKEN = TOKEN;
    expect((await app.request("/metrics")).status).toBe(401);
    delete process.env.METRICS_TOKEN;
    expect((await app.request("/metrics")).status).toBe(200);
  });
});
