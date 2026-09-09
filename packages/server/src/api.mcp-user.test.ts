import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-mcp-api-"));
  process.env.DB_FILE = join(dir, "mcp.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
});

afterAll(() => {
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

async function register(email: string): Promise<Record<string, string>> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const m = /auth_token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (!m) throw new Error(`register failed: ${res.status}`);
  return { cookie: `auth_token=${m[1]!}` };
}

const BASE = { providers: {}, defaultModel: "fake", defaultProvider: "fake" };

async function putSettings(cookie: Record<string, string>, body: unknown): Promise<Response> {
  return app.request("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json", ...cookie },
    body: JSON.stringify(body),
  });
}

async function getSettings(cookie: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await app.request("/api/settings", { headers: cookie });
  return (await res.json()) as Record<string, unknown>;
}

function startServer(): Promise<{ url: string; close: () => void; auth: string[] }> {
  const auth: string[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      auth.push(String(req.headers.authorization ?? ""));
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as { id?: unknown; method?: string };
        const result =
          body.method === "initialize"
            ? { protocolVersion: "2024-11-05", capabilities: {} }
            : { tools: [{ name: "echo" }, { name: "search" }] };
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      });
    });
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://localhost:${port}/mcp`, close: () => server.close(), auth });
    });
  });
}

describe("MCP server settings", () => {
  it("redacts auth header values but keeps the header names visible", async () => {
    const cookie = await register("mcp-redact@example.com");
    await putSettings(cookie, {
      ...BASE,
      mcpServers: [
        { id: "s1", transport: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer supersecrettoken" } },
      ],
    });
    const cfg = await getSettings(cookie);
    const servers = cfg.mcpServers as { headers: Record<string, string> }[];
    expect(Object.keys(servers[0].headers)).toEqual(["Authorization"]);
    expect(servers[0].headers.Authorization).not.toContain("supersecrettoken");
    expect(servers[0].headers.Authorization).toContain("*");
  });

  it("treats a masked header echoed back from the form as unchanged", async () => {
    const cookie = await register("mcp-roundtrip@example.com");
    const srv = await startServer();
    try {
      await putSettings(cookie, {
        ...BASE,
        mcpServers: [{ id: "s1", transport: "http", url: srv.url, headers: { Authorization: "Bearer realtoken123" } }],
      });
      // Simulate the UI saving an unrelated edit: it sends back what it was shown.
      const shown = (await getSettings(cookie)).mcpServers as { headers: Record<string, string> }[];
      await putSettings(cookie, {
        ...BASE,
        mcpServers: [{ id: "s1", transport: "http", url: srv.url, name: "renamed", headers: shown[0].headers }],
      });
      // The real token must still reach the remote server.
      await app.request("/api/mcp/s1/connect", { method: "POST", headers: cookie });
      expect(srv.auth.at(-1)).toBe("Bearer realtoken123");
    } finally {
      srv.close();
    }
  });

  it("rejects stdio — end users must not supply a command line to spawn", async () => {
    const cookie = await register("mcp-stdio@example.com");
    const res = await putSettings(cookie, {
      ...BASE,
      mcpServers: [{ id: "s1", transport: "stdio", command: "sh", args: ["-c", "id"] }],
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/mcp/:id/connect", () => {
  it("reports the discovered tool count on success", async () => {
    const cookie = await register("mcp-connect@example.com");
    const srv = await startServer();
    try {
      await putSettings(cookie, { ...BASE, mcpServers: [{ id: "s1", transport: "http", url: srv.url }] });
      const res = await app.request("/api/mcp/s1/connect", { method: "POST", headers: cookie });
      expect(res.status).toBe(200);
      const status = (await res.json()) as { connected: boolean; toolCount: number; toolNames: string[] };
      expect(status.connected).toBe(true);
      expect(status.toolCount).toBe(2);
      expect(status.toolNames).toEqual(["echo", "search"]);
    } finally {
      srv.close();
    }
  });

  it("reports the reason on failure instead of a stack trace", async () => {
    const cookie = await register("mcp-connect-fail@example.com");
    await putSettings(cookie, { ...BASE, mcpServers: [{ id: "s1", transport: "http", url: "http://127.0.0.1:1/mcp" }] });
    const res = await app.request("/api/mcp/s1/connect", { method: "POST", headers: cookie });
    expect(res.status).toBe(502);
    const status = (await res.json()) as { connected: boolean; error?: string };
    expect(status.connected).toBe(false);
    expect(status.error).toBeTruthy();
  });

  it("404s on a server the caller has not configured", async () => {
    const cookie = await register("mcp-connect-404@example.com");
    const res = await app.request("/api/mcp/nope/connect", { method: "POST", headers: cookie });
    expect(res.status).toBe(404);
  });

  it("never exposes another user's server", async () => {
    const alice = await register("mcp-alice@example.com");
    const bob = await register("mcp-bob@example.com");
    const srv = await startServer();
    try {
      await putSettings(alice, { ...BASE, mcpServers: [{ id: "shared", transport: "http", url: srv.url }] });
      await app.request("/api/mcp/shared/connect", { method: "POST", headers: alice });
      // Bob configured nothing under that id, so it does not exist for him.
      const res = await app.request("/api/mcp/shared/connect", { method: "POST", headers: bob });
      expect(res.status).toBe(404);
      const view = (await (await app.request("/api/mcp", { headers: bob })).json()) as { user: unknown[] };
      expect(view.user).toEqual([]);
    } finally {
      srv.close();
    }
  });
});

describe("GET /api/mcp", () => {
  it("separates operator-configured servers from the caller's own", async () => {
    const cookie = await register("mcp-list@example.com");
    const srv = await startServer();
    try {
      await putSettings(cookie, { ...BASE, mcpServers: [{ id: "s1", transport: "http", url: srv.url }] });
      const view = (await (await app.request("/api/mcp", { headers: cookie })).json()) as {
        operator: unknown[];
        user: { id: string; connected: boolean }[];
      };
      expect(Array.isArray(view.operator)).toBe(true);
      expect(view.user).toHaveLength(1);
      expect(view.user[0]).toMatchObject({ id: "s1", connected: true });
    } finally {
      srv.close();
    }
  });
});

describe("user skill cards over the settings API", () => {
  it("stores the three data kinds", async () => {
    const cookie = await register("cards-ok@example.com");
    const res = await putSettings(cookie, {
      ...BASE,
      skillCards: [
        { id: "local:tone", name: "语气", kind: "prompt-module", prompt: "写得简洁" },
        { id: "local:qc", name: "质检", kind: "judge", criterion: "无错别字" },
        { id: "local:shape", name: "结构", kind: "output-contract", fields: [{ name: "title", required: true }] },
      ],
    });
    expect(res.status).toBe(200);
    const cfg = await getSettings(cookie);
    expect((cfg.skillCards as unknown[]).length).toBe(3);
  });

  it("rejects a tool-kind card — that would run user code", async () => {
    const cookie = await register("cards-tool@example.com");
    const res = await putSettings(cookie, {
      ...BASE,
      skillCards: [{ id: "local:evil", name: "X", kind: "tool", config: { name: "rm" } }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects an id that would shadow a builtin card", async () => {
    const cookie = await register("cards-shadow@example.com");
    const res = await putSettings(cookie, {
      ...BASE,
      skillCards: [{ id: "web_fetch", name: "X", kind: "judge", criterion: "y" }],
    });
    expect(res.status).toBe(400);
  });
});
