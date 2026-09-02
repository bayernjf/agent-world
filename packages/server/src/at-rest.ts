/**
 * At-rest encryption for secrets (security audit L3).
 *
 * Two kinds of secrets are encrypted before they touch disk:
 *  - provider API keys, inside the per-user `settings.data` JSON;
 *  - every credential carried by a graph document / snapshot — trigger webhook
 *    secrets, node-level provider keys (imageGen / videoGen / audioGen /
 *    generic `apiKey`), notify `secret` and `webhookUrl` (group-bot URLs embed
 *    their token in the path), connector `auth.token`, and auth-ish HTTP header
 *    values on both http nodes and http connectors.
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

/**
 * Object keys whose string values are credentials, matched case-insensitively.
 *
 * Keyed by name rather than by a hard-coded field path so the walk covers
 * wherever a credential is nested today (node configs, `source.connector.http`,
 * triggers) and wherever it gets nested next. The L3 fix mapped only
 * `triggers[].webhookSecret`, which left every node-level key in plaintext —
 * the same defect class in a sibling branch.
 *
 * Header names are keys of a record, so the auth-ish ones are listed here too
 * and get sealed by the same rule. Boundary, stated honestly: a credential
 * hidden under an unlisted custom header name (e.g. `X-My-Auth`) is NOT caught.
 */
const SECRET_KEYS =
  /^(apikey|api_key|secret|webhooksecret|token|accesstoken|refreshtoken|webhookurl|authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-token|x-goog-api-key|ocp-apim-subscription-key)$/i;

/** True when a subtree carries at least one secret-keyed non-empty string. */
function containsSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecret);
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && v && SECRET_KEYS.test(k)) return true;
      if (containsSecret(v)) return true;
    }
  }
  return false;
}

/**
 * Rewrite every secret-keyed string in a document with `fn`, preserving key
 * order (content hashes are computed on the plaintext and must stay
 * comparable). Returns the ORIGINAL reference when nothing changed, so graphs
 * without credentials keep their identity and cost nothing.
 */
function mapSecrets(value: unknown, fn: (v: string) => string): { out: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = mapSecrets(v, fn);
      if (r.changed) changed = true;
      return r.out;
    });
    return changed ? { out, changed } : { out: value, changed: false };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && v && SECRET_KEYS.test(k)) {
        const next = fn(v);
        out[k] = next;
        if (next !== v) changed = true;
      } else {
        const r = mapSecrets(v, fn);
        out[k] = r.out;
        if (r.changed) changed = true;
      }
    }
    return changed ? { out, changed } : { out: value, changed: false };
  }
  return { out: value, changed: false };
}

/** Encrypt unless already encrypted, so sealing is idempotent. */
function sealValue(v: string): string {
  return v.startsWith(ENC_PREFIX) ? v : encryptString(v);
}

function hasSecrets(graph: Graph): boolean {
  return containsSecret(graph);
}

/** Encrypt every credential inside a graph document (returns a copy). */
export function sealGraphDoc(graph: Graph): Graph {
  if (!hasSecrets(graph)) return graph;
  const { out } = mapSecrets(graph, sealValue);
  return out as Graph;
}

/** Decrypt every credential inside a graph document (returns a copy). */
export function openGraphDoc(graph: Graph): Graph {
  // Drop "ghost" edges whose endpoints no longer exist. A corrupted save can
  // leave pipes referencing node ids that aren't in the graph; they are
  // invisible on the canvas (no endpoint to click), so the UI can never
  // delete them and compile() would keep reporting "Edge references a missing
  // plant" forever. A valid graph never has such edges, so this normalization
  // self-heals those rows on load. Returns the same reference when clean.
  const liveIds = new Set(graph.nodes.map((n) => n.id));
  const hasOrphanEdges = graph.edges.some((e) => !liveIds.has(e.from) || !liveIds.has(e.to));
  const opened = hasOrphanEdges
    ? { ...graph, edges: graph.edges.filter((e) => liveIds.has(e.from) && liveIds.has(e.to)) }
    : graph;

  if (!hasSecrets(opened)) return opened;
  const { out } = mapSecrets(opened, decryptString);
  return out as Graph;
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
