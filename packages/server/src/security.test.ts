import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { applyCors, applySecurityHeaders, resolveCorsOrigins } from "./security.js";

describe("resolveCorsOrigins", () => {
  it("returns undefined when unset (allow-all default)", () => {
    expect(resolveCorsOrigins(undefined)).toBeUndefined();
    expect(resolveCorsOrigins("")).toBeUndefined();
  });

  it("returns '*' for an explicit wildcard", () => {
    expect(resolveCorsOrigins("*")).toBe("*");
  });

  it("collapses a single origin to a string", () => {
    expect(resolveCorsOrigins("https://app.example.com")).toBe("https://app.example.com");
  });

  it("splits a comma list into an array", () => {
    expect(resolveCorsOrigins("https://a.test, https://b.test")).toEqual([
      "https://a.test",
      "https://b.test",
    ]);
  });
});

describe("applySecurityHeaders", () => {
  it("sets hardening headers on every response", async () => {
    const app = new Hono();
    applySecurityHeaders(app);
    app.get("/", (c) => c.text("ok"));
    const res = await app.request("/");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Permissions-Policy")).toContain("geolocation=()");
  });
});

describe("applyCors", () => {
  it("reflects an allowed origin from the allowlist", async () => {
    const app = new Hono();
    applyCors(app, "https://allowed.test, https://other.test");
    app.get("/", (c) => c.text("ok"));
    const res = await app.request("/", { headers: { origin: "https://allowed.test" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://allowed.test");
  });

  it("omits ACAO for a disallowed origin", async () => {
    const app = new Hono();
    applyCors(app, "https://allowed.test");
    app.get("/", (c) => c.text("ok"));
    const res = await app.request("/", { headers: { origin: "https://evil.test" } });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("https://evil.test");
  });

  it("falls back to the local dev origin with credentials when no env is set", async () => {
    const app = new Hono();
    applyCors(app, undefined);
    app.get("/", (c) => c.text("ok"));
    const res = await app.request("/", { headers: { origin: "http://localhost:5173" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
