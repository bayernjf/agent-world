import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-products-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
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

function authed(token: string): Record<string, string> {
  return { cookie: `auth_token=${token}`, "content-type": "application/json" };
}

describe("products CRUD (F4)", () => {
  it("creates, lists, updates and deletes a product", async () => {
    const token = await register("products@example.com");
    const headers = authed(token);

    const created = await app.request("/api/products", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "复古托特包", sku: "SKU-001", brand: "某某品牌", category: "箱包", price: 99.9 }),
    });
    expect(created.status).toBe(201);
    const product = (await created.json()) as { id: string; name: string; status: string };
    expect(product.name).toBe("复古托特包");
    expect(product.status).toBe("active");

    const list = await app.request("/api/products", { headers });
    const rows = (await list.json()) as Array<{ name: string }>;
    expect(rows.some((r) => r.name === "复古托特包")).toBe(true);

    const patched = await app.request(`/api/products/${product.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "archived", price: 79.9 }),
    });
    expect(patched.status).toBe(200);
    const updated = (await patched.json()) as { status: string; price: number };
    expect(updated.status).toBe("archived");
    expect(updated.price).toBe(79.9);

    const del = await app.request(`/api/products/${product.id}`, { method: "DELETE", headers });
    expect(del.status).toBe(204);

    const listAfter = await app.request("/api/products", { headers });
    const rowsAfter = (await listAfter.json()) as Array<{ name: string }>;
    expect(rowsAfter.some((r) => r.name === "复古托特包")).toBe(false);
  });

  it("rejects a product with an empty name", async () => {
    const token = await register("products-empty@example.com");
    const res = await app.request("/api/products", {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ name: "  " }),
    });
    expect(res.status).toBe(400);
  });

  it("isolates products between users", async () => {
    const a = await register("products-a@example.com");
    const b = await register("products-b@example.com");
    await app.request("/api/products", {
      method: "POST",
      headers: authed(a),
      body: JSON.stringify({ name: "A商品" }),
    });
    const listB = await app.request("/api/products", { headers: authed(b) });
    const rowsB = (await listB.json()) as Array<{ name: string }>;
    expect(rowsB.some((r) => r.name === "A商品")).toBe(false);
  });
});

describe("products CSV import/export (F4)", () => {
  it("imports rows, maps extra columns to attributes, and reports failures", async () => {
    const token = await register("products-import@example.com");
    const headers = authed(token);
    const csv =
      "name,sku,brand,category,price,material\n复古托特包,SKU-001,某某品牌,箱包,99.9,帆布\n,SKU-002,某品牌,箱包,88,皮质\n";
    const res = await app.request("/api/products/import", {
      method: "POST",
      headers,
      body: JSON.stringify({ csv }),
    });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { imported: number; failed: number; errors: string[] };
    expect(report.imported).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.errors.length).toBe(1);

    const list = await app.request("/api/products", { headers });
    const rows = (await list.json()) as Array<{ name: string; attributes: Record<string, unknown> }>;
    const p = rows.find((r) => r.name === "复古托特包");
    expect(p).toBeDefined();
    expect(p!.attributes.material).toBe("帆布");
  });

  it("exports a CSV with the expected header", async () => {
    const token = await register("products-export@example.com");
    const headers = authed(token);
    await app.request("/api/products", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "导出商品" }),
    });
    const res = await app.request("/api/products/export", { headers });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.startsWith("name,sku,brand,category,price")).toBe(true);
    expect(text).toContain("导出商品");
  });
});

describe("brand assets CRUD (F4)", () => {
  it("creates, lists and deletes a brand asset", async () => {
    const token = await register("assets@example.com");
    const headers = authed(token);
    const created = await app.request("/api/brand-assets", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "logo", label: "主 Logo", tags: ["品牌", "官方"] }),
    });
    expect(created.status).toBe(201);
    const asset = (await created.json()) as { id: string; label: string; tags: string[] };
    expect(asset.label).toBe("主 Logo");
    expect(asset.tags).toEqual(["品牌", "官方"]);

    const list = await app.request("/api/brand-assets", { headers });
    const rows = (await list.json()) as Array<{ label: string }>;
    expect(rows.some((r) => r.label === "主 Logo")).toBe(true);

    const del = await app.request(`/api/brand-assets/${asset.id}`, { method: "DELETE", headers });
    expect(del.status).toBe(204);
  });
});
