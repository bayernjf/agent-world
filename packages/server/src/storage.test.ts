import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryStorageBackend,
  LocalStorageBackend,
  S3StorageBackend,
  StorageError,
  createStorageBackend,
  storageConfigFromEnv,
} from "./storage.js";

describe("LocalStorageBackend", () => {
  let dir: string;
  let backend: LocalStorageBackend;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-store-"));
    backend = new LocalStorageBackend(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips bytes and reports missing keys as null", async () => {
    await backend.put("a/b.txt", Buffer.from("hi"));
    expect((await backend.get("a/b.txt"))?.toString()).toBe("hi");
    expect(await backend.get("nope")).toBeNull();
    await backend.delete("a/b.txt");
    expect(await backend.get("a/b.txt")).toBeNull();
  });
});

describe("InMemoryStorageBackend", () => {
  it("round-trips bytes", async () => {
    const b = new InMemoryStorageBackend();
    await b.put("k", Buffer.from("x"));
    expect((await b.get("k"))?.toString()).toBe("x");
    expect(await b.get("missing")).toBeNull();
    await b.delete("k");
    expect(await b.get("k")).toBeNull();
  });
});

describe("S3StorageBackend", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async (_url: string, init: { method?: string }) => {
      const body = init?.method === "GET" ? "s3-bytes" : "";
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("PUTs to the object URL with an AWS SigV4 Authorization header", async () => {
    const b = new S3StorageBackend({
      bucket: "mybucket",
      region: "us-east-1",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
    await b.put("run/1.png", Buffer.from("data"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe("https://s3.us-east-1.amazonaws.com/mybucket/run/1.png");
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(init.headers["x-amz-content-sha256"]).toBeDefined();
    expect(init.headers["x-amz-date"]).toBeDefined();
  });

  it("GETs an object and returns its bytes", async () => {
    const b = new S3StorageBackend({
      bucket: "b",
      region: "eu-west-1",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      endpoint: "https://play.min.io",
    });
    const buf = await b.get("x/y");
    expect((fetchMock.mock.calls[0] as [string, unknown])[0]).toBe("https://play.min.io/b/x/y");
    expect(buf?.toString()).toBe("s3-bytes");
  });

  it("supports a key prefix", async () => {
    const b = new S3StorageBackend({
      bucket: "b",
      region: "us-east-1",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      prefix: "prod/",
    });
    await b.put("k", Buffer.from("d"));
    expect((fetchMock.mock.calls[0] as [string, unknown])[0]).toBe(
      "https://s3.us-east-1.amazonaws.com/b/prod/k",
    );
  });

  it("throws StorageError on non-2xx and resolves 404 to null on get", async () => {
    fetchMock.mockImplementation(async (_u: string, init: { method?: string }) => {
      if (init?.method === "GET") return new Response("nope", { status: 404 });
      return new Response("bad", { status: 500 });
    });
    const b = new S3StorageBackend({
      bucket: "b",
      region: "us-east-1",
      accessKeyId: "AK",
      secretAccessKey: "SK",
    });
    await expect(b.put("k", Buffer.from("d"))).rejects.toBeInstanceOf(StorageError);
    expect(await b.get("missing")).toBeNull();
  });
});

describe("createStorageBackend / storageConfigFromEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = saved;
  });

  it("defaults to local", () => {
    process.env = { ...saved };
    delete process.env.STORAGE_BACKEND;
    const cfg = storageConfigFromEnv();
    expect(cfg.backend).toBe("local");
    expect(createStorageBackend(cfg).kind).toBe("local");
  });

  it("selects s3 when STORAGE_BACKEND=s3", () => {
    process.env = {
      ...saved,
      STORAGE_BACKEND: "s3",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "AK",
      S3_SECRET_ACCESS_KEY: "SK",
    };
    const cfg = storageConfigFromEnv();
    expect(cfg.backend).toBe("s3");
    expect(createStorageBackend(cfg).kind).toBe("s3");
  });
});
