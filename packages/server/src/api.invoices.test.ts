import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { generateInvoice } from "./invoiceService.js";

let dir: string;
let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
let owner: { token: string; userId: string };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-invapi-"));
  process.env.DB_FILE = join(dir, "s.sqlite");
  process.env.ALLOW_REGISTRATION = "1";
  const mod = await import("./index.js");
  app = mod.app;
  db = openDb(process.env.DB_FILE!);
  owner = await register("owner@test.dev");
});

afterAll(async () => {
  await db.close();
  delete process.env.DB_FILE;
  delete process.env.ALLOW_REGISTRATION;
  rmSync(dir, { recursive: true, force: true });
});

async function register(email: string): Promise<{ token: string; userId: string }> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const token = /auth_token=([^;]+)/.exec(cookie)![1]!;
  const { user } = (await res.json()) as { user: { id: string } };
  return { token, userId: user.id };
}

describe("GET /api/invoices (M3 S2)", () => {
  it("returns an empty list for a fresh user", async () => {
    const { token } = await register("fresh-inv@test.dev");
    const res = await app.request("/api/invoices", {
      headers: { cookie: `auth_token=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: unknown[] };
    expect(body.invoices).toEqual([]);
  });

  it("401s without a session", async () => {
    const res = await app.request("/api/invoices");
    expect(res.status).toBe(401);
  });

  it("returns generated invoices for the current user", async () => {
    const { token, userId } = await register("has-inv@test.dev");
    await generateInvoice(db, userId);
    const res = await app.request("/api/invoices", {
      headers: { cookie: `auth_token=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: Array<{ id: string; plan: string; amountUsd: number }> };
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0].plan).toBe("free");
    expect(body.invoices[0].amountUsd).toBe(0);
    expect(body.invoices[0].id).toMatch(/^inv_/);
  });
});

describe("GET /api/invoices/:id (M3 S2)", () => {
  it("returns a single invoice by id", async () => {
    const { token, userId } = await register("single-inv@test.dev");
    const inv = await generateInvoice(db, userId);
    const res = await app.request(`/api/invoices/${inv.id}`, {
      headers: { cookie: `auth_token=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; plan: string; lineItems: unknown[] };
    expect(body.id).toBe(inv.id);
    expect(body.plan).toBe("free");
    expect(body.lineItems).toHaveLength(1);
  });

  it("404s for a nonexistent invoice", async () => {
    const { token } = await register("404-inv@test.dev");
    const res = await app.request("/api/invoices/inv_nonexistent", {
      headers: { cookie: `auth_token=${token}` },
    });
    expect(res.status).toBe(404);
  });

  it("403s when a user tries to view another user's invoice", async () => {
    const alice = await register("alice-inv@test.dev");
    const bob = await register("bob-inv@test.dev");
    const aliceInv = await generateInvoice(db, alice.userId);
    const res = await app.request(`/api/invoices/${aliceInv.id}`, {
      headers: { cookie: `auth_token=${bob.token}` },
    });
    expect(res.status).toBe(403);
  });

  it("401s without a session", async () => {
    const res = await app.request("/api/invoices/inv_anything");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/invoices/:id/download (M3 S3)", () => {
  it("returns an HTML invoice with attachment headers", async () => {
    const { token, userId } = await register("dl-inv@test.dev");
    const inv = await generateInvoice(db, userId);
    const res = await app.request(`/api/invoices/${inv.id}/download`, {
      headers: { cookie: `auth_token=${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain(`invoice_${inv.id}.html`);
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain(inv.id);
    expect(body).toContain("Invoice");
  });

  it("404s for a nonexistent invoice", async () => {
    const { token } = await register("dl-404@test.dev");
    const res = await app.request("/api/invoices/inv_nope/download", {
      headers: { cookie: `auth_token=${token}` },
    });
    expect(res.status).toBe(404);
  });

  it("403s when a user tries to download another user's invoice", async () => {
    const alice = await register("alice-dl@test.dev");
    const bob = await register("bob-dl@test.dev");
    const aliceInv = await generateInvoice(db, alice.userId);
    const res = await app.request(`/api/invoices/${aliceInv.id}/download`, {
      headers: { cookie: `auth_token=${bob.token}` },
    });
    expect(res.status).toBe(403);
  });

  it("401s without a session", async () => {
    const res = await app.request("/api/invoices/inv_anything/download");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/admin/invoices (M3 S4)", () => {
  it("lets the owner list all invoices across users", async () => {
    const alice = await register("alice-admin@test.dev");
    const bob = await register("bob-admin@test.dev");
    await generateInvoice(db, alice.userId);
    await generateInvoice(db, bob.userId);
    const res = await app.request("/api/admin/invoices", {
      headers: { cookie: `auth_token=${owner.token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: Array<{ id: string; userId: string }> };
    expect(body.invoices.length).toBeGreaterThanOrEqual(2);
  });

  it("403s for non-owner users", async () => {
    const { token } = await register("not-owner@test.dev");
    const res = await app.request("/api/admin/invoices", {
      headers: { cookie: `auth_token=${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("401s without a session", async () => {
    const res = await app.request("/api/admin/invoices");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/invoices/:id/mark-paid (M3 S4)", () => {
  it("lets the owner mark an open invoice as paid", async () => {
    const { userId } = await register("pay-me@test.dev");
    const inv = await generateInvoice(db, userId);
    const res = await app.request(`/api/admin/invoices/${inv.id}/mark-paid`, {
      method: "POST",
      headers: { cookie: `auth_token=${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "bank_transfer", notes: "test payment" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; invoice: { status: string; paidMethod: string } };
    expect(body.ok).toBe(true);
    expect(body.invoice.status).toBe("paid");
    expect(body.invoice.paidMethod).toBe("bank_transfer");
  });

  it("409s when marking an already-paid invoice", async () => {
    const { userId } = await register("already-paid@test.dev");
    const inv = await generateInvoice(db, userId);
    await app.request(`/api/admin/invoices/${inv.id}/mark-paid`, {
      method: "POST",
      headers: { cookie: `auth_token=${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "manual" }),
    });
    const res = await app.request(`/api/admin/invoices/${inv.id}/mark-paid`, {
      method: "POST",
      headers: { cookie: `auth_token=${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "manual" }),
    });
    expect(res.status).toBe(409);
  });

  it("403s for non-owner users", async () => {
    const { token, userId } = await register("not-owner-pay@test.dev");
    const inv = await generateInvoice(db, userId);
    const res = await app.request(`/api/admin/invoices/${inv.id}/mark-paid`, {
      method: "POST",
      headers: { cookie: `auth_token=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "manual" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/invoices/:id/void (M3 S4)", () => {
  it("lets the owner void an open invoice", async () => {
    const { userId } = await register("void-me@test.dev");
    const inv = await generateInvoice(db, userId);
    const res = await app.request(`/api/admin/invoices/${inv.id}/void`, {
      method: "POST",
      headers: { cookie: `auth_token=${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "duplicate" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; invoice: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.invoice.status).toBe("void");
  });

  it("409s when voiding a paid invoice", async () => {
    const { userId } = await register("paid-cant-void@test.dev");
    const inv = await generateInvoice(db, userId);
    await app.request(`/api/admin/invoices/${inv.id}/mark-paid`, {
      method: "POST",
      headers: { cookie: `auth_token=${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "manual" }),
    });
    const res = await app.request(`/api/admin/invoices/${inv.id}/void`, {
      method: "POST",
      headers: { cookie: `auth_token=${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    });
    expect(res.status).toBe(409);
  });

  it("403s for non-owner users", async () => {
    const { token, userId } = await register("not-owner-void@test.dev");
    const inv = await generateInvoice(db, userId);
    const res = await app.request(`/api/admin/invoices/${inv.id}/void`, {
      method: "POST",
      headers: { cookie: `auth_token=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    });
    expect(res.status).toBe(403);
  });
});
