import type { Db } from "./db.js";
import type { ArtifactStore } from "./artifact-store.js";

/** Maximum artifact size to inline as a data URI (5 MB). */
export const MAX_INLINE_BYTES = 5 * 1024 * 1024;

/** Sniff image mime type from magic bytes (first 12 bytes). */
export function sniffImageMime(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "AVIF") return "image/avif";
  return "application/octet-stream";
}

/**
 * Build a readArtifact function that inlines local /api/artifacts/<id> URIs
 * as data:<mime>;base64,... URIs. Cloud vision models can't reach our
 * localhost, so relative URLs must be inlined before being sent.
 *
 * Fallback: up-<hash> artifacts are stored under runId "uploads" by
 * saveBinary, but may predate the db.insertArtifact fix. If the DB has no
 * metadata, read bytes directly from the uploads directory and sniff mime.
 */
export function createReadArtifact(db: Db, artifacts: ArtifactStore) {
  return async (uri: string): Promise<string | null> => {
    const m = /^\/api\/artifacts\/([^/]+)$/.exec(uri);
    if (!m) return null;
    const id = decodeURIComponent(m[1]!);
    const meta = db.getArtifact(id);
    if (meta) {
      if (meta.sizeBytes > MAX_INLINE_BYTES) return null;
      const buf = await artifacts.readBytes(meta.runId, id);
      if (!buf) return null;
      return `data:${meta.mimeType};base64,${buf.toString("base64")}`;
    }
    if (id.startsWith("up-")) {
      const buf = await artifacts.readBytes("uploads", id);
      if (!buf || buf.length > MAX_INLINE_BYTES) return null;
      return `data:${sniffImageMime(buf)};base64,${buf.toString("base64")}`;
    }
    return null;
  };
}
