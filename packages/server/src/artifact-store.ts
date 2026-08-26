import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Artifact } from "@agent-world/core";

export type ArtifactStorage = "inline" | "uri" | "local";

export interface StoredArtifact {
  id: string;
  runId: string;
  nodeId: string;
  attempt: number | null;
  kind: Artifact["kind"];
  mimeType: string | null;
  label: string | null;
  sizeBytes: number;
  storage: ArtifactStorage;
  /** Remote URI for storage='uri'; served URI (/api/artifacts/:id) for 'local'. */
  uri: string | null;
  createdAt: number;
}

const MIME_BY_KIND: Record<Artifact["kind"], string> = {
  text: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  image: "image/png",
  video: "video/mp4",
  audio: "audio/mpeg",
  file: "application/octet-stream",
  uri: "application/octet-stream",
};

function isRemoteUri(uri: string | undefined): boolean {
  return !!uri && /^(https?:|data:|blob:)/i.test(uri);
}

/**
 * Persists artifact bytes to local disk and tracks where they live. Remote/data
 * URIs are passed through untouched (we never fetch arbitrary URLs server-side);
 * inline text/json content is written to the blob directory so every produced
 * artifact has a durable, addressable file rather than living only in the event
 * stream. Local blobs are stored by artifact id alone (no extension) so their
 * path is deterministic from (runId, id); the DB holds the MIME type.
 */
export class ArtifactStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
  }

  static defaultPath(): string {
    const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
    return join(dirname(resolve(dbFile)), "artifacts");
  }

  save(
    artifact: Artifact,
    meta: { runId: string; nodeId: string; attempt?: number; now?: number },
  ): StoredArtifact {
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
      const filePath = this.pathFor(meta.runId, artifact.id);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, buf);
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

  /** Absolute path to a locally-stored artifact, or null if it doesn't exist. */
  pathFor(runId: string, id: string): string {
    return join(this.dir, runId.slice(0, 2), runId, id);
  }

  open(
    runId: string,
    id: string,
  ): { stream: ReturnType<typeof createReadStream>; size: number; mime: string } | null {
    const path = this.pathFor(runId, id);
    if (!existsSync(path)) return null;
    return {
      stream: createReadStream(path),
      size: statSync(path).size,
      // Caller supplies the authoritative MIME from the DB; default octet-stream.
      mime: "application/octet-stream",
    };
  }

  readBytes(runId: string, id: string): Buffer | null {
    const path = this.pathFor(runId, id);
    return existsSync(path) ? readFileSync(path) : null;
  }
}
