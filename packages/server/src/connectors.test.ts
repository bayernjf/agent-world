import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveConnector } from "./connectors.js";

const dir = mkdtempSync(path.join(tmpdir(), "conn-"));
let server: Server;
let base = "";

// The http-connector cases talk to a real local server (127.0.0.1); the SSRF
// guard would refuse it. These tests exercise connector behavior, not the
// guard, so bypass the internal-address check the way the other legacy-host
// tests do.
beforeEach(() => vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1"));
afterEach(() => vi.unstubAllEnvs());

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ items: [{ name: "widget" }], note: "hi" }));
    } else if (req.url === "/text") {
      res.setHeader("content-type", "text/plain");
      res.end("plain body");
    } else if (req.url === "/json-auth") {
      if (req.headers.authorization !== "Bearer secret") {
        res.statusCode = 401;
        res.end("no auth");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url === "/post") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ body, xtest: req.headers["x-test"] ?? "" }));
      });
    } else {
      res.statusCode = 500;
      res.end("boom");
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveConnector - file", () => {
  it("reads a single text file", async () => {
    const f = path.join(dir, "a.txt");
    writeFileSync(f, "hello world");
    const r = await resolveConnector({ type: "file", file: { path: f } });
    expect(r.text).toContain("hello world");
    expect(r.images).toHaveLength(0);
  });

  it("reads a directory recursively and supports glob", async () => {
    writeFileSync(path.join(dir, "b.txt"), "bbb");
    const sub = path.join(dir, "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(path.join(sub, "c.txt"), "ccc");
    writeFileSync(path.join(sub, "c.md"), "ignore");
    const r = await resolveConnector({ type: "file", file: { path: path.join(dir, "**", "*.txt") } });
    expect(r.text).toContain("bbb");
    expect(r.text).toContain("ccc");
    expect(r.text).not.toContain("ignore");
    expect(r.images).toHaveLength(0);
  });

  it("returns image paths when asImages is set", async () => {
    const png = path.join(dir, "pic.png");
    writeFileSync(png, "binary");
    const r = await resolveConnector({ type: "file", file: { path: png, asImages: true } });
    expect(r.images).toEqual([png]);
    expect(r.text).toBe("");
  });
});

describe("resolveConnector - http", () => {
  it("fetches JSON and extracts fields", async () => {
    const r = await resolveConnector({
      type: "http",
      http: { url: `${base}/json`, method: "GET", extract: ["items.0.name", "note"] },
    });
    expect(r.text).toContain("widget");
    expect(r.text).toContain("hi");
  });

  it("fetches plain text verbatim", async () => {
    const r = await resolveConnector({ type: "http", http: { url: `${base}/text`, method: "GET" } });
    expect(r.text).toBe("plain body");
  });

  it("throws on non-2xx", async () => {
    await expect(
      resolveConnector({ type: "http", http: { url: `${base}/nope`, method: "GET" } }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("resolveConnector - form/manual", () => {
  it("manual returns empty material", async () => {
    const r = await resolveConnector({ type: "manual" });
    expect(r).toEqual({ text: "", images: [] });
  });

  it("form joins provided values", async () => {
    const r = await resolveConnector(
      { type: "form", form: { fields: [{ name: "name", label: "商品名" }] } },
      { name: "XYZ" },
    );
    expect(r.text).toContain("商品名: XYZ");
  });
});

describe("resolveConnector - http auth/body/headers", () => {
  it("sends Bearer auth and succeeds", async () => {
    const r = await resolveConnector({
      type: "http",
      http: { url: `${base}/json-auth`, method: "GET", auth: { type: "bearer", token: "secret" } },
    });
    expect(r.text).toContain('"ok": true');
  });

  it("fails without auth (401)", async () => {
    await expect(
      resolveConnector({ type: "http", http: { url: `${base}/json-auth`, method: "GET" } }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it("posts a JSON body", async () => {
    const r = await resolveConnector({
      type: "http",
      http: { url: `${base}/post`, method: "POST", body: { a: 1 } },
    });
    expect(JSON.parse(r.text).body).toBe('{"a":1}');
  });

  it("forwards custom request headers", async () => {
    const r = await resolveConnector({
      type: "http",
      http: { url: `${base}/post`, method: "POST", headers: { "x-test": "yes" }, body: "" },
    });
    expect(JSON.parse(r.text).xtest).toBe("yes");
  });
});

describe("resolveConnector - edge cases", () => {
  it("reads a file as base64 when encoding is set", async () => {
    const f = path.join(dir, "b64.txt");
    writeFileSync(f, "hello");
    const r = await resolveConnector({ type: "file", file: { path: f, encoding: "base64" } });
    expect(r.text).toContain(Buffer.from("hello").toString("base64"));
  });

  it("form with no values returns empty material", async () => {
    const r = await resolveConnector({ type: "form", form: { fields: [{ name: "name" }] } });
    expect(r).toEqual({ text: "", images: [] });
  });

  it("throws when file config is missing", async () => {
    await expect(resolveConnector({ type: "file" })).rejects.toThrow(/missing 'file'/);
  });

  it("throws when http config is missing", async () => {
    await expect(resolveConnector({ type: "http" })).rejects.toThrow(/missing 'http'/);
  });
});

describe("resolveConnector - database", () => {
  let dbPath: string;
  beforeAll(() => {
    dbPath = path.join(dir, "seed.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL);" +
        "INSERT INTO products (name, price) VALUES ('alpha', 1.5), ('beta', 2.5);",
    );
    db.close();
  });

  it("reads rows as pretty JSON", async () => {
    const r = await resolveConnector({
      type: "database",
      database: { driver: "sqlite", path: dbPath, query: "SELECT * FROM products ORDER BY id", format: "json" },
    });
    const rows = JSON.parse(r.text) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "alpha" });
  });

  it("supports bind parameters and csv format", async () => {
    const r = await resolveConnector({
      type: "database",
      database: { driver: "sqlite", path: dbPath, query: "SELECT name, price FROM products WHERE id > ?", params: [0], format: "csv" },
    });
    const lines = r.text.trim().split("\n");
    expect(lines[0]).toBe("name,price");
    expect(lines[1]).toContain("alpha");
  });

  it("rejects write statements", async () => {
    await expect(
      resolveConnector({
        type: "database",
        database: { driver: "sqlite", path: dbPath, query: "UPDATE products SET price = 0" },
      }),
    ).rejects.toThrow(/只允许 SELECT/);
  });

  it("rejects multi-statement queries", async () => {
    await expect(
      resolveConnector({
        type: "database",
        database: { driver: "sqlite", path: dbPath, query: "SELECT * FROM products; DROP TABLE products" },
      }),
    ).rejects.toThrow(/多语句/);
  });

  it("fails clearly when the database file is missing", async () => {
    await expect(
      resolveConnector({
        type: "database",
        database: { driver: "sqlite", path: path.join(dir, "nope.sqlite"), query: "SELECT 1" },
      }),
    ).rejects.toThrow(/无法打开数据库/);
  });

  it("throws when database config is missing", async () => {
    await expect(resolveConnector({ type: "database" })).rejects.toThrow(/missing 'database'/);
  });
});
