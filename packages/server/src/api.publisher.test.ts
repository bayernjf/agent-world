import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-publisher-"));
  process.env.DB_FILE = join(dir, "publisher.sqlite");
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

function headers(token: string): Record<string, string> {
  return { cookie: `auth_token=${token}`, "content-type": "application/json" };
}

const CLEAN = { title: "新品发布", body: "这是一篇合规的产品介绍，没有极限词，内容正常。" };

describe("platform drafts HTTP contract (ops M2)", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/api/platform-drafts", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("creates a draft, refuses douyin with 422 and validates input", async () => {
    const token = await register("publisher-1@example.com");
    const douyin = await app.request("/api/platform-drafts", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ platform: "douyin", ...CLEAN }),
    });
    expect(douyin.status).toBe(422);

    const bad = await app.request("/api/platform-drafts", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ platform: "wechat", title: "", body: "" }),
    });
    expect(bad.status).toBe(400);

    const ok = await app.request("/api/platform-drafts", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ platform: "wechat", ...CLEAN }),
    });
    expect(ok.status).toBe(201);
    const draft = (await ok.json()) as { id: string; status: string };
    expect(draft.status).toBe("draft");
  });

  it("cannot publish without the review and human approve gates (409)", async () => {
    const token = await register("publisher-2@example.com");
    const created = await app.request("/api/platform-drafts", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ platform: "xiaohongshu", ...CLEAN }),
    });
    const { id } = (await created.json()) as { id: string };

    const premature = await app.request(`/api/platform-drafts/${id}/approve`, {
      method: "POST",
      headers: headers(token),
    });
    expect(premature.status).toBe(409);

    const list = await app.request("/api/platform-drafts", { headers: headers(token) });
    const drafts = (await list.json()) as Array<{ id: string; status: string }>;
    expect(drafts.find((d) => d.id === id)?.status).toBe("draft");
  });

  it("walks draft -> review -> approved -> published with an offline receipt", async () => {
    const token = await register("publisher-3@example.com");
    const created = await app.request("/api/platform-drafts", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ platform: "zhihu", ...CLEAN }),
    });
    const { id } = (await created.json()) as { id: string };

    const review = await app.request(`/api/platform-drafts/${id}/review`, {
      method: "POST",
      headers: headers(token),
    });
    expect(review.status).toBe(200);
    expect((await review.json()) as { status: string }).toMatchObject({ status: "pending_review" });

    const approve = await app.request(`/api/platform-drafts/${id}/approve`, {
      method: "POST",
      headers: headers(token),
    });
    expect(approve.status).toBe(200);
    const published = (await approve.json()) as {
      status: string;
      externalId: string;
      externalUrl: string | null;
    };
    expect(published.status).toBe("published");
    expect(published.externalId.startsWith("offline-zhihu-")).toBe(true);
    expect(published.externalUrl).toBeNull();

    // Terminal: a published draft cannot be approved or moved again.
    const again = await app.request(`/api/platform-drafts/${id}/approve`, {
      method: "POST",
      headers: headers(token),
    });
    expect(again.status).toBe(409);
  });

  it("blocks review on an editor-QA failure (422)", async () => {
    const token = await register("publisher-4@example.com");
    const created = await app.request("/api/platform-drafts", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        platform: "wechat",
        title: "全网最好的产品",
        body: "国家级品质，史上最低价，正常长度的正文内容。",
      }),
    });
    const { id } = (await created.json()) as { id: string };
    const review = await app.request(`/api/platform-drafts/${id}/review`, {
      method: "POST",
      headers: headers(token),
    });
    expect(review.status).toBe(422);
    const list = await app.request("/api/platform-drafts", { headers: headers(token) });
    const drafts = (await list.json()) as Array<{ id: string; status: string }>;
    expect(drafts.find((d) => d.id === id)?.status).toBe("draft");
  });
});
