import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The Hono app is a module singleton with DB/config env read at import time,
// so give it a scratch database before importing.
let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-templates-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
  // These tests exercise the template API, not registration policy; allow
  // account creation despite the M3 self-registration gate.
  vi.stubEnv("ALLOW_REGISTRATION", "1");
  const mod = await import("./index.js");
  app = mod.app;
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
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = /auth_token=([^;]+)/.exec(cookie);
  if (!m) throw new Error(`no auth_token in set-cookie: ${cookie}`);
  return m[1]!;
}

function authed(token: string): Record<string, string> {
  return { cookie: `auth_token=${token}`, "content-type": "application/json" };
}

interface TemplatePayload {
  id: string;
  fields?: { key: string; label: string; placeholder: string; defaultValue: string }[];
}

async function createFromTemplate(token: string, body: object) {
  const res = await app.request("/api/graphs", {
    method: "POST",
    headers: authed(token),
    body: JSON.stringify(body),
  });
  return res;
}

describe("template instantiation API", () => {
  it("GET /api/templates exposes declared fields without applyTo plumbing", async () => {
    const token = await register(`tpl-list-${Date.now()}@t.test`);
    const res = await app.request("/api/templates", { headers: authed(token) });
    expect(res.status).toBe(200);
    const templates = (await res.json()) as TemplatePayload[];
    const patrol = templates.find((t) => t.id === "tpl-patrol-alert");
    expect(patrol?.fields).toEqual([
      {
        key: "targetUrl",
        label: "监控目标地址",
        placeholder: "https://your-service.example.com/health",
        defaultValue: "https://httpbin.org/status/200",
      },
      {
        key: "alarmWebhookUrl",
        label: "告警通知 Webhook（群机器人地址）",
        placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/xxxx",
        defaultValue: "",
      },
    ]);
    // Since the blank canvas split (BLANK_TEMPLATE lives outside TEMPLATES),
    // the template API must not list it — the web picker renders blank
    // separately as the first creation card.
    expect(templates.find((t) => t.id === "tpl-blank")).toBeUndefined();
    // Field-less templates still get an empty array, not undefined, for a stable shape.
    const evidence = templates.find((t) => t.id === "tpl-evidence-brief");
    expect(evidence?.fields).toEqual([]);
  });

  it("POST /api/graphs applies fieldValues to the instantiated graph", async () => {
    const token = await register(`tpl-create-${Date.now()}@t.test`);
    const res = await createFromTemplate(token, {
      template: "tpl-patrol-alert",
      fieldValues: { targetUrl: "https://example.com/health" },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const graphRes = await app.request(`/api/graphs/${id}`, { headers: authed(token) });
    const graph = (await graphRes.json()) as {
      nodes: { name: string; http?: { url: string } }[];
    };
    const probe = graph.nodes.find((n) => n.name === "健康检查")!;
    expect(probe.http?.url).toBe("https://example.com/health");
  });

  it("POST /api/graphs without fieldValues keeps template defaults", async () => {
    const token = await register(`tpl-default-${Date.now()}@t.test`);
    const res = await createFromTemplate(token, { template: "tpl-patrol-alert" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const graphRes = await app.request(`/api/graphs/${id}`, { headers: authed(token) });
    const graph = (await graphRes.json()) as {
      nodes: { name: string; http?: { url: string } }[];
    };
    const probe = graph.nodes.find((n) => n.name === "健康检查")!;
    expect(probe.http?.url).toBe("https://httpbin.org/status/200");
  });
});
