/**
 * At-rest encryption for secrets (security audit L3).
 *
 * Two kinds of secrets are encrypted before they touch disk:
 *  - provider API keys, inside the per-user `settings.data` JSON;
 *  - every credential carried by a graph document / snapshot — trigger webhook
 *    secrets, node-level provider keys (imageGen / videoGen / audioGen /
 *    generic `apiKey`), notify `secret` and `webhookUrl` (group-bot URLs embed
 *    their token in the path), connector `auth.token`, HTTP header values
 *    whose name is auth-ish — on both http nodes and http connectors, including
 *    custom names no fixed list could enumerate (`X-My-Auth`, `X-Signature`) —
 *    and credential query params inside a URL (`…?access_token=…`, Azure's
 *    `?api-key=…`), where only the param value is sealed so the endpoint stays
 *    readable on disk.
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
 * Header names are keys of a record and are user-chosen, so an exact list can
 * never cover them: inside a `headers` record any name that looks auth-ish is
 * sealed too (see AUTHISH_HEADER). Benign headers stay readable on disk, which
 * is what makes a sealed doc debuggable.
 */
const SECRET_KEYS =
  /^(apikey|api_key|secret|webhooksecret|token|accesstoken|refreshtoken|webhookurl|authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-token|x-goog-api-key|ocp-apim-subscription-key)$/i;

/** Header names that carry a credential even though no list could name them. */
const AUTHISH_HEADER = /(auth|token|key|secret|credential|signature|password|passwd|session|cookie|bearer)/i;

/**
 * Field names whose value is a URL, so a credential may ride in its query
 * string (`?access_token=…`, Azure's `?api-key=…`). The URL itself stays
 * readable on disk; only the credential's value is sealed (see sealUrlQuery).
 */
const URL_KEYS =
  /^(url|uri|href|endpoint|hook|hookurl|baseurl|apiurl|serviceurl|fullurl|callbackurl|redirecturl|targeturl)$/i;

/**
 * Query-parameter names that are credentials. Matched exactly, because an
 * unanchored pattern would seal benign params (`author` contains "auth",
 * `keyboard` contains "key").
 */
const QUERY_SECRET =
  /^(token|access[-_]?token|refresh[-_]?token|id[-_]?token|api[-_]?key|apikey|key|app[-_]?key|secret|client[-_]?secret|app[-_]?secret|signature|sig|auth|authorization|password|passwd|pwd|credential|credentials|bearer|session|session[-_]?id|k)$/i;

/** Ciphertext placed inside a query string is percent-encoded; see § sealUrlQuery. */
const ENC_PREFIX_ENCODED = encodeURIComponent(ENC_PREFIX);

/** One `?name=value` / `&name=value` pair, stopping at the next `&` or `#`. */
const QUERY_PARAM = /([?&])([A-Za-z0-9_.%-]+)(=)([^&#]*)/g;

/**
 * True when the string under `key` is a credential. `parentKey` is the key of
 * the object holding it, which is how a `headers` record is recognised.
 */
function isSecretKey(key: string, parentKey?: string): boolean {
  if (SECRET_KEYS.test(key)) return true;
  return parentKey !== undefined && /^headers$/i.test(parentKey) && AUTHISH_HEADER.test(key);
}

/**
 * Seal the credential params inside a URL, leaving the URL itself readable:
 * `https://h/robot/send?access_token=SECRET&t=1` becomes
 * `…?access_token=enc%3Av1%3A…&t=1`.
 *
 * The ciphertext is percent-encoded because it is base64 and a raw `+` inside a
 * query string decodes server-side as a space, which would silently corrupt the
 * token. Values that already carry that encoded prefix are left alone, so
 * sealing twice is a no-op.
 */
function sealUrlQuery(value: string): string {
  return value.replace(QUERY_PARAM, (pair, sep: string, name: string, eq: string, val: string) => {
    if (!val || !QUERY_SECRET.test(name)) return pair;
    if (val.startsWith(ENC_PREFIX_ENCODED)) return pair;
    return `${sep}${name}${eq}${encodeURIComponent(encryptString(val))}`;
  });
}

/** Reverse of {@link sealUrlQuery}; a malformed or tampered value throws. */
function openUrlQuery(value: string): string {
  return value.replace(QUERY_PARAM, (pair, sep: string, name: string, eq: string, val: string) => {
    if (!val.startsWith(ENC_PREFIX_ENCODED)) return pair;
    return `${sep}${name}${eq}${decryptString(decodeURIComponent(val))}`;
  });
}

/** Applied to every credential-bearing string the walk finds. */
type SecretTransform = (key: string, parentKey: string | undefined, value: string) => string;

const sealTransform: SecretTransform = (key, parentKey, value) =>
  isSecretKey(key, parentKey) ? sealValue(value) : sealUrlQuery(value);

const openTransform: SecretTransform = (key, parentKey, value) =>
  isSecretKey(key, parentKey) ? decryptString(value) : openUrlQuery(value);

/** True when the string under `key` is worth running a transform on. */
function isCredentialCarrier(key: string, parentKey: string | undefined): boolean {
  return isSecretKey(key, parentKey) || URL_KEYS.test(key);
}

/**
 * Rewrite every credential in a document with `transform`, preserving key
 * order (content hashes are computed on the plaintext and must stay
 * comparable). Returns the ORIGINAL reference when nothing changed, so graphs
 * without credentials keep their identity and cost nothing.
 *
 * There is deliberately no separate "does this doc contain a secret?" probe:
 * the detector and the mutator drifting apart is how the first L3 fix shipped
 * with every node-level key still in plaintext. This walk is the answer.
 */
function mapSecrets(
  value: unknown,
  transform: SecretTransform,
  parentKey?: string,
): { out: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = mapSecrets(v, transform, parentKey);
      if (r.changed) changed = true;
      return r.out;
    });
    return changed ? { out, changed } : { out: value, changed: false };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && v && isCredentialCarrier(k, parentKey)) {
        const next = transform(k, parentKey, v);
        out[k] = next;
        if (next !== v) changed = true;
      } else {
        const r = mapSecrets(v, transform, k);
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

/** Encrypt every credential inside a graph document (returns a copy). */
export function sealGraphDoc(graph: Graph): Graph {
  return mapSecrets(graph, sealTransform).out as Graph;
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

  return mapSecrets(opened, openTransform).out as Graph;
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
