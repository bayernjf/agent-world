/**
 * At-rest encryption for secrets (security audit L3).
 *
 * Two kinds of secrets are encrypted before they touch disk:
 *  - provider API keys, inside the per-user `settings.data` JSON;
 *  - webhook secrets, inside graph docs / snapshots (`triggers[].webhookSecret`).
 *
 * Design: AES-256-GCM, one random 12-byte IV per encryption, stored as
 * `enc:v1:<iv b64>:<tag b64>:<cipher b64>`. Values without the prefix are
 * legacy plaintext and pass through untouched, so an existing database keeps
 * working and is encrypted lazily on the next write.
 *
 * The key comes from `AGENT_WORLD_ENCRYPTION_KEY` (hex 64 chars, or any
 * string derived via sha256) or, when unset, from a persisted 0600
 * `.encryption-key` file next to the sqlite db (same pattern as auth.ts).
 * Decrypting an unknown-format or tampered value throws (fail-closed): we
 * never return ciphertext to callers pretending it is plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Graph } from "@agent-world/core";

const ENC_PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

/** Derive a 32-byte key from an env value (hex when it is 64 chars). */
function deriveKey(input: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(input)) return Buffer.from(input, "hex");
  return createHash("sha256").update(input, "utf8").digest();
}

/**
 * Load (and cache) the encryption key: env first, then a persisted file next
 * to the sqlite db so local/headless deployments keep working across restarts.
 */
export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (process.env.AGENT_WORLD_ENCRYPTION_KEY) {
    cachedKey = deriveKey(process.env.AGENT_WORLD_ENCRYPTION_KEY);
    return cachedKey;
  }
  const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
  const keyFile = join(dirname(dbFile), ".encryption-key");
  try {
    const existing = readFileSync(keyFile, "utf8").trim();
    if (/^[0-9a-fA-F]{64}$/.test(existing)) {
      cachedKey = Buffer.from(existing, "hex");
      return cachedKey;
    }
  } catch {
    /* first boot */
  }
  const fresh = randomBytes(KEY_BYTES).toString("hex");
  try {
    writeFileSync(keyFile, fresh, { mode: 0o600 });
  } catch (err) {
    // Persisting is best-effort: without it the key changes every restart and
    // previously encrypted rows become undecryptable, so warn loudly.
    console.warn("[at-rest] could not persist encryption key, encrypted data will not survive restart:", err);
  }
  cachedKey = Buffer.from(fresh, "hex");
  return cachedKey;
}

/** Encrypt a string; returns `enc:v1:<iv>:<tag>:<cipher>` (all base64). */
export function encryptString(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getEncryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${ENC_PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a value; legacy plaintext (no prefix) is returned unchanged. */
export function decryptString(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const body = stored.slice(ENC_PREFIX.length);
  const parts = body.split(":");
  if (parts.length !== 3) throw new Error("malformed encrypted value");
  const [ivB64 = "", tagB64 = "", dataB64 = ""] = parts;
  const decipher = createDecipheriv(ALGO, getEncryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch (err) {
    throw new Error(`failed to decrypt stored value: ${(err as Error).message}`);
  }
}

function hasSecrets(graph: Graph): boolean {
  return !!graph.triggers?.some((t) => t.webhookSecret);
}

/** Encrypt the webhook secrets inside a graph document (returns a copy). */
export function sealGraphDoc(graph: Graph): Graph {
  if (!hasSecrets(graph)) return graph;
  return {
    ...graph,
    triggers: graph.triggers!.map((t) =>
      t.webhookSecret ? { ...t, webhookSecret: encryptString(t.webhookSecret) } : t,
    ),
  };
}

/** Decrypt the webhook secrets inside a graph document (returns a copy). */
export function openGraphDoc(graph: Graph): Graph {
  if (!hasSecrets(graph)) return graph;
  return {
    ...graph,
    triggers: graph.triggers!.map((t) =>
      t.webhookSecret ? { ...t, webhookSecret: decryptString(t.webhookSecret) } : t,
    ),
  };
}

/**
 * String-level helpers for the db serialization boundary: seal before
 * `JSON.stringify(graph)` hits disk, open after `JSON.parse(doc)`. Both keep
 * field order, so content hashes computed on the plaintext stay comparable
 * across encrypted and legacy rows.
 */
export function sealDocString(doc: string): string {
  return JSON.stringify(sealGraphDoc(JSON.parse(doc) as Graph));
}

export function openDocString(stored: string): string {
  return JSON.stringify(openGraphDoc(JSON.parse(stored) as Graph));
}
