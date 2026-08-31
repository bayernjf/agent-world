import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The Hono app is a module singleton with DB/config env read at import time,
// so give it a scratch database before importing.
let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-api-sec-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
  const mod = await import("./index.js");
  app = mod.app;
});

afterAll(() => {
  delete process.env.DB_FILE;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function register(email: string, password = "secret123"): Promise<Response> {
  return app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

/** Extract the auth_token value from a set-cookie header. */
function authToken(res: Response): string {
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = /auth_token=([^;]+)/.exec(cookie);
  if (!m) throw new Error(`no auth_token in set-cookie: ${cookie}`);
  return m[1]!;
}

function authed(token: string, headers: Record<string, string> = {}): Record<string, string> {
  return { cookie: `auth_token=${token}`, ...headers };
}

const A_PROVIDERS = {
  providers: {
    my: {
      type: "openai-compatible",
      baseUrl: "https://a.example/v1",
      apiKey: "sk-aaa",
      models: ["m1"],
      enabled: true,
    },
  },
  defaultModel: "m1",
  defaultProvider: "my",
};

describe("per-user settings isolation", () => {
  let aToken: string;
  let bToken: string;

  beforeAll(async () => {
    aToken = authToken(await register("alice@test.dev"));
    bToken = authToken(await register("bob@test.dev"));
  });

  it("user A's saved provider key is invisible to user B", async () => {
    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: authed(aToken, { "content-type": "application/json" }),
      body: JSON.stringify(A_PROVIDERS),
    });
    expect(put.status).toBe(200);

    const bGet = await app.request("/api/settings", { headers: authed(bToken) });
    const bBody = (await bGet.json()) as { providers: Record<string, { apiKey?: string }> };
    // B never saved settings → falls back to the shared baseline, which must
    // not contain A's provider.
    expect(bBody.providers.my).toBeUndefined();
    expect(JSON.stringify(bBody)).not.toContain("sk-aaa");

    const aGet = await app.request("/api/settings", { headers: authed(aToken) });
    const aBody = (await aGet.json()) as { providers: Record<string, { apiKey?: string }> };
    expect(aBody.providers.my).toBeTruthy();
    // Keys come back redacted, never raw.
    expect(aBody.providers.my!.apiKey).not.toBe("sk-aaa");
    expect(aBody.providers.my!.apiKey).toBe("****");
  });

  it("user B saving settings does not clobber user A's", async () => {
    const bPut = await app.request("/api/settings", {
      method: "PUT",
      headers: authed(bToken, { "content-type": "application/json" }),
      body: JSON.stringify({
        providers: {
          theirs: {
            type: "openai-compatible",
            baseUrl: "https://b.example/v1",
            apiKey: "sk-bbb",
            models: ["m2"],
            enabled: true,
          },
        },
      }),
    });
    expect(bPut.status).toBe(200);

    const aGet = await app.request("/api/settings", { headers: authed(aToken) });
    const aBody = (await aGet.json()) as { providers: Record<string, { apiKey?: string }> };
    expect(aBody.providers.my).toBeTruthy();
    expect(aBody.providers.theirs).toBeUndefined();
    expect(JSON.stringify(aBody)).not.toContain("sk-bbb");
  });
});

describe("auth cookie Secure flag", () => {
  it("no Secure by default outside production", async () => {
    const res = await register("secure-none@test.dev");
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("Secure added when SECURE_COOKIES=1 on a non-loopback host", async () => {
    vi.stubEnv("SECURE_COOKIES", "1");
    try {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "app.example.com",
        },
        body: JSON.stringify({ email: "alice@test.dev", password: "secret123" }),
      });
      const cookie = res.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("loopback host keeps Secure off even when enabled", async () => {
    vi.stubEnv("SECURE_COOKIES", "1");
    try {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "localhost:8791",
        },
        body: JSON.stringify({ email: "alice@test.dev", password: "secret123" }),
      });
      const cookie = res.headers.get("set-cookie") ?? "";
      expect(cookie).not.toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("webhook trigger secret enforcement", () => {
  let aToken: string;
  let graphId: string;

  beforeAll(async () => {
    aToken = authToken(await register("carol@test.dev"));
    const created = await app.request("/api/graphs", {
      method: "POST",
      headers: authed(aToken, { "content-type": "application/json" }),
      body: JSON.stringify({ name: "hook-line" }),
    });
    graphId = ((await created.json()) as { id: string }).id;
  });

  it("rejects a webhook trigger with an empty secret", async () => {
    const res = await app.request(`/api/graphs/${graphId}/triggers`, {
      method: "POST",
      headers: authed(aToken, { "content-type": "application/json" }),
      body: JSON.stringify({
        id: "trg_hook",
        type: "webhook",
        webhookSecret: "",
        enabled: true,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: unknown };
    expect(JSON.stringify(body.error)).toContain("secret");
  });

  it("accepts a webhook trigger with a non-empty secret", async () => {
    const res = await app.request(`/api/graphs/${graphId}/triggers`, {
      method: "POST",
      headers: authed(aToken, { "content-type": "application/json" }),
      body: JSON.stringify({
        id: "trg_hook_ok",
        type: "webhook",
        webhookSecret: "s3cret",
        enabled: true,
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe("Authorization Bearer header auth", () => {
  let token: string;

  beforeAll(async () => {
    token = authToken(await register("dave@test.dev"));
  });

  it("accepts a Bearer token on a protected endpoint", async () => {
    const res = await app.request("/api/graphs", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a non-Bearer authorization header", async () => {
    const res = await app.request("/api/graphs", {
      headers: { authorization: `Basic ${token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("/api/providers/test key exfiltration guard", () => {
  let token: string;

  beforeAll(async () => {
    token = authToken(await register("erin@test.dev"));
    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: authed(token, { "content-type": "application/json" }),
      body: JSON.stringify({
        providers: {
          victim: {
            type: "openai-compatible",
            baseUrl: "https://real.example/v1",
            apiKey: "sk-victim-real",
            models: ["m1"],
            enabled: true,
          },
        },
      }),
    });
    expect(put.status).toBe(200);
  });

  it("refuses to pair the saved key with a caller-chosen baseUrl", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await app.request("/api/providers/test", {
        method: "POST",
        headers: authed(token, { "content-type": "application/json" }),
        body: JSON.stringify({
          baseUrl: "https://attacker.example/v1",
          apiKey: "", // forces server-side resolution of the saved key
          model: "m1",
          providerName: "victim",
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("Base URL");
      // The saved key must never leave the process toward the attacker host.
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still allows the saved key against its own saved baseUrl", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await app.request("/api/providers/test", {
        method: "POST",
        headers: authed(token, { "content-type": "application/json" }),
        body: JSON.stringify({
          baseUrl: "https://real.example/v1",
          apiKey: "****", // redacted, as the Settings UI sends it
          model: "m1",
          providerName: "victim",
        }),
      });
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url).startsWith("https://real.example/v1/")).toBe(true);
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-victim-real");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
