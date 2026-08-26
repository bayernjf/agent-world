import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { Artifact } from "@agent-world/core";
import {
  LocalStorageBackend,
  type StorageBackend,
  type StorageConfig,
  createStorageBackend,
  storageConfigFromEnv,
} from "./storage.js";

const MIME_BY_KIND: Record<Artifact["kind"], string> = {
  text: "text/plain",
  json: "application/json",
  image: "application/octet-stream",
  audio: "application/octet-stream",
  video: "application/octet-stream",
  file: "application/octet-stream",
  uri: "application/octet-stream",
};

function isRemoteUri(uri: string | undefined | null): boolean {
  return !!uri && (uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("data:"));
}

export interface StoredArtifact {
  id: string;
  runId: string;
  nodeId: string;
  attempt: number | null;
  kind: Artifact["kind"];
  mimeType: string;
  label: string | null;
  sizeBytes: number;
  /**
   * - "local"  -> bytes live in the StorageBackend, served via /api/artifacts/:id
   * - "uri"    -> an external URL stored verbatim (the route redirects to it)
   * - "inline" -> metadata only, no bytes
   */
  storage: "local" | "uri" | "inline";
  uri: string | null;
  createdAt: number;
}

/**
 * Persists artifacts (text/JSON/image/audio/video/file). Bytes are delegated to
 * a StorageBackend — local disk by default, S3 when STORAGE_BACKEND=s3. The rest
 * of the engine only depends on this class, so swapping storage is config-only.
 */
export class ArtifactStore {
  private readonly backend: StorageBackend;

  constructor(dirOrBackend: string | StorageBackend) {
    this.backend =
      typeof dirOrBackend === "string" ? new LocalStorageBackend(dirOrBackend) : dirOrBackend;
  }

  static defaultPath(): string {
    const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
    return join(dirname(resolve(dbFile)), "artifacts");
  }
  static local(dir: string): ArtifactStore {
    return new ArtifactStore(dir);
  }
  static withBackend(backend: StorageBackend): ArtifactStore {
    return new ArtifactStore(backend);
  }
  /** Build a store from a StorageConfig (defaults to env via storageConfigFromEnv). */
  static fromEnv(cfg: StorageConfig = storageConfigFromEnv()): ArtifactStore {
    return new ArtifactStore(createStorageBackend(cfg));
  }

  /** Relative storage key for a (runId, artifactId) pair. */
  private keyFor(runId: string, id: string): string {
    return join(runId.slice(0, 2), runId, id);
  }

  async save(
    artifact: Artifact,
    meta: { runId: string; nodeId: string; attempt?: number; now?: number },
  ): Promise<StoredArtifact> {
    const createdAt = meta.now ?? Date.now();
    const mimeType = artifact.mimeType ?? MIME_BY_KIND[artifact.kind];

    if (isRemoteUri(artifact.uri)) {
      return {
        id: artifact.id,
        runId: meta.runId,
        nodeId: meta.nodeId,
        attempt: meta.attempt ?? null,
        kind: artifact.kind,
        mimeType,
        label: artifact.label ?? null,
        sizeBytes: artifact.sizeBytes ?? 0,
        storage: "uri",
        uri: artifact.uri!,
        createdAt,
      };
    }

    if (artifact.content != null) {
      const buf = Buffer.from(artifact.content, "utf-8");
      await this.backend.put(this.keyFor(meta.runId, artifact.id), buf);
      return {
        id: artifact.id,
        runId: meta.runId,
        nodeId: meta.nodeId,
        attempt: meta.attempt ?? null,
        kind: artifact.kind,
        mimeType,
        label: artifact.label ?? null,
        sizeBytes: buf.length,
        storage: "local",
        uri: `/api/artifacts/${encodeURIComponent(artifact.id)}`,
        createdAt,
      };
    }

    return {
      id: artifact.id,
      runId: meta.runId,
      nodeId: meta.nodeId,
      attempt: meta.attempt ?? null,
      kind: artifact.kind,
      mimeType,
      label: artifact.label ?? null,
      sizeBytes: 0,
      storage: "inline",
      uri: null,
      createdAt,
    };
  }

  /**
   * Persist raw uploaded bytes (e.g. a product photo from the source node) as a
   * local image/file artifact before any run exists.
   */
  async saveBinary(opts: {
    data: Buffer;
    kind: Artifact["kind"];
    mimeType?: string;
    label?: string;
  }): Promise<StoredArtifact> {
    const id = `up-${createHash("sha1").update(opts.data).digest("hex").slice(0, 12)}`;
    await this.backend.put(this.keyFor("uploads", id), opts.data);
    return {
      id,
      runId: "uploads",
      nodeId: "source",
      attempt: null,
      kind: opts.kind,
      mimeType: opts.mimeType ?? MIME_BY_KIND[opts.kind],
      label: opts.label ?? null,
      sizeBytes: opts.data.length,
      storage: "local",
      uri: `/api/artifacts/${encodeURIComponent(id)}`,
      createdAt: Date.now(),
    };
  }

  async open(
    runId: string,
    id: string,
  ): Promise<{ stream: ReadableStream; size: number; mime: string } | null> {
    const buf = await this.backend.get(this.keyFor(runId, id));
    if (!buf) return null;
    return {
      stream: new Blob([buf]).stream() as unknown as ReadableStream,
      size: buf.length,
      mime: "application/octet-stream",
    };
  }

  async readBytes(runId: string, id: string): Promise<Buffer | null> {
    return this.backend.get(this.keyFor(runId, id));
  }

  async remove(runId: string, id: string): Promise<void> {
    await this.backend.delete(this.keyFor(runId, id));
  }
}
