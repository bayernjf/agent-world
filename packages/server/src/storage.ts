import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Storage abstraction for generated/uploaded artifacts (4.4 / 4E).
 *
 * The engine only ever talks to an ArtifactStore, which delegates byte
 * persistence to a StorageBackend. Two implementations ship today:
 *   - LocalStorageBackend: files on the local disk (default, zero-config)
 *   - S3StorageBackend:    any S3-compatible object store (AWS / MinIO / OSS)
 * In-memory is provided for tests. Swapping backends is a single env line:
 *   STORAGE_BACKEND=s3  plus the S3_* credentials.
 */

export interface StorageBackend {
  readonly kind: "local" | "s3" | "memory";
  /** Store `data` under `key` (opaque string; for local it is a relative path). */
  put(key: string, data: Buffer): Promise<void> | void;
  /** Return the bytes for `key`, or null if missing. */
  get(key: string): Promise<Buffer | null> | Buffer | null;
  /** Remove `key`. Missing keys are silently ignored. */
  delete(key: string): Promise<void> | void;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/** Files on the local filesystem. `key` is joined onto `baseDir`. */
export class LocalStorageBackend implements StorageBackend {
  readonly kind = "local" as const;
  constructor(private readonly baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }
  private path(key: string): string {
    return join(this.baseDir, key);
  }
  put(key: string, data: Buffer): void {
    mkdirSync(dirname(this.path(key)), { recursive: true });
    writeFileSync(this.path(key), data);
  }
  get(key: string): Buffer | null {
    try {
      return readFileSync(this.path(key));
    } catch {
      return null;
    }
  }
  delete(key: string): void {
    try {
      rmSync(this.path(key), { force: true });
    } catch {
      // ignore
    }
  }
}

/** Volatile backend used by tests. Never touches disk or the network. */
export class InMemoryStorageBackend implements StorageBackend {
  readonly kind = "memory" as const;
  private readonly map = new Map<string, Buffer>();
  put(key: string, data: Buffer): void {
    this.map.set(key, data);
  }
  get(key: string): Buffer | null {
    return this.map.get(key) ?? null;
  }
  delete(key: string): void {
    this.map.delete(key);
  }
}

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Override for MinIO / Aliyun OSS (e.g. https://play.min.io). */
  endpoint?: string;
  /** Key prefix; useful to isolate multiple deployments in one bucket. */
  prefix?: string;
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
function hmacHex(key: string | Buffer, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

/** AWS Signature Version 4, header style, for the S3 service. */
function signS3(opts: {
  method: string;
  url: string;
  region: string;
  accessKey: string;
  secretKey: string;
  body: Buffer;
}): Record<string, string> {
  const u = new URL(opts.url);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(opts.body);
  const canonicalHeaders =
    `host:${u.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest =
    `${opts.method}\n${u.pathname}${u.search}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/${opts.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;
  const kDate = hmacHex(`AWS4${opts.secretKey}`, dateStamp);
  const kRegion = hmacHex(kDate, opts.region);
  const kService = hmacHex(kRegion, "s3");
  const kSigning = hmacHex(kService, "aws4_request");
  const signature = hmacHex(kSigning, stringToSign);
  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** S3-compatible object storage via the REST API (no AWS SDK dependency). */
export class S3StorageBackend implements StorageBackend {
  readonly kind = "s3" as const;
  constructor(private readonly cfg: S3Config) {}

  private objectUrl(key: string): string {
    const host = this.cfg.endpoint ?? `https://s3.${this.cfg.region}.amazonaws.com`;
    const encKey = key
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    const prefix = this.cfg.prefix ? `${this.cfg.prefix.replace(/\/$/, "")}/` : "";
    return `${host}/${this.cfg.bucket}/${prefix}${encKey}`;
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.request("PUT", key, data);
  }
  async get(key: string): Promise<Buffer | null> {
    try {
      return await this.request("GET", key);
    } catch (e) {
      // Treat "not found" as a missing key rather than a hard error.
      if (e instanceof StorageError && /HTTP 404/.test(e.message)) return null;
      throw e;
    }
  }
  async delete(key: string): Promise<void> {
    await this.request("DELETE", key);
  }

  private async request(method: "GET" | "PUT" | "DELETE", key: string, body?: Buffer): Promise<Buffer | null> {
    const url = this.objectUrl(key);
    const payload = body ?? Buffer.alloc(0);
    const headers = signS3({
      method,
      url,
      region: this.cfg.region,
      accessKey: this.cfg.accessKeyId,
      secretKey: this.cfg.secretAccessKey,
      body: payload,
    });
    if (body) headers["content-length"] = String(body.length);
    const res = await fetch(url, { method, headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new StorageError(`S3 ${method} ${key} failed: HTTP ${res.status} ${text}`);
    }
    if (method === "GET") return Buffer.from(await res.arrayBuffer());
    return null;
  }
}

export interface StorageConfig {
  backend: "local" | "s3";
  localDir?: string;
  s3?: S3Config;
}

function defaultLocalDir(): string {
  const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
  return join(dirname(resolve(dbFile)), "artifacts");
}

export function createStorageBackend(cfg: StorageConfig): StorageBackend {
  if (cfg.backend === "s3" && cfg.s3) return new S3StorageBackend(cfg.s3);
  return new LocalStorageBackend(cfg.localDir ?? defaultLocalDir());
}

/** Build a StorageConfig from environment variables (one-line switch). */
export function storageConfigFromEnv(): StorageConfig {
  const backend = process.env.STORAGE_BACKEND === "s3" ? "s3" : "local";
  const localDir = process.env.ARTIFACT_DIR ?? undefined;
  const s3: S3Config | undefined =
    backend === "s3"
      ? {
          bucket: process.env.S3_BUCKET ?? "",
          region: process.env.S3_REGION ?? "us-east-1",
          accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
          endpoint: process.env.S3_ENDPOINT || undefined,
          prefix: process.env.S3_PREFIX || undefined,
        }
      : undefined;
  return { backend, localDir, s3 };
}
