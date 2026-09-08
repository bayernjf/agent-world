import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-costs-unpriced-"));
  process.env.DB_FILE = join(dir, "costs.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
});

afterAll(() => {
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

async function register(email: string): Promise<string> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const m = /auth_token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (!m) throw new Error(`register failed: ${res.status}`);
  return m[1]!;
}

describe("GET /api/costs price-card gaps", () => {
  it("reports models whose price card would under-meter", async () => {
    const token = await register("costs-unpriced@example.com");
    const cookie = { cookie: `auth_token=${token}` };

    await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", ...cookie },
      body: JSON.stringify({
        providers: {
          priced: { type: "openai-compatible", models: ["good"], pricing: { good: { input: 1, output: 2 } } },
          blank: { type: "openai-compatible", models: ["silent-zero"] },
          half: { type: "openai-compatible", models: ["half"], pricing: { half: { input: 1 } } },
        },
        defaultProvider: "priced",
        defaultModel: "good",
      }),
    });

    const res = await app.request("/api/costs", { headers: cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      unpricedModels: Array<{ provider: string; model: string; level: string }>;
    };
    const gaps = body.unpricedModels.map((g) => `${g.provider}/${g.model}:${g.level}`);
    expect(gaps).toContain("blank/silent-zero:none");
    expect(gaps).toContain("half/half:partial");
    expect(gaps.some((g) => g.startsWith("priced/good"))).toBe(false);
  });
});
