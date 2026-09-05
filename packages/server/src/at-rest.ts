/**
 * At-rest encryption for secrets (security audit L3), with key rotation
 * (design-key-rotation.md).
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
 * Design: AES-256-GCM, one random 12-byte IV per encryption. Two envelope
 * formats:
 *  - `enc:v1:<iv b64>:<tag b64>:<cipher b64>` — pre-keyring rows; no key id, so
 *    decryption tries every key in the keyring (GCM authentication makes a
 *    wrong key fail, never mis-decrypt).
 *  - `enc:v2:<keyId>:<iv b64>:<tag b64>:<cipher b64>` — the keyring format.
 *    `keyId` is the first 6 hex chars of the derived key material, routing
 *    decryption to the exact key; encryption always uses the FIRST (newest)
 *    key so a rotation changes writes immediately while old rows stay
 *    readable (rolling rotation, see the runbook in design-key-rotation.md).
 * Values without either prefix are legacy plaintext and pass through
 * untouched, so an existing database keeps working and is encrypted lazily on
 * the next write.
 *
 * Keys come from an ordered keyring (newest first; the rest are kept only for
 * decryption until the re-encrypt script converges the rows and they are
 * removed from the ring):
 *  - `AGENT_WORLD_ENCRYPTION_KEYS` — comma-separated, newest first;
 *  - `AGENT_WORLD_ENCRYPTION_KEY` — single value, equals a one-element ring;
 *  - `.encryption-keys` — JSON array next to the sqlite db (0600);
 *  - `.encryption-key` — legacy single-value file, wrapped as a one-element
 *    ring (lazy migration, same rotation semantics);
 *  - otherwise a fresh key is generated and persisted to `.encryption-keys`.
 * Decrypting an unknown-format or tampered value throws (fail-closed): we
 * never return ciphertext to callers pretending it is plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Graph } from "@agent-world/core";

const ENC_PREFIX_V1 = "enc:v1:";
const ENC_PREFIX_V2 = "enc:v2:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
/** Short key identifier embedded in v2 ciphertext, e.g. `k2026a`-style. */
const KEY_ID_HEX = 6;

/** One entry of the ordered keyring: the derived key plus its short id. */
export interface RingKey {
  id: string;
  key: Buffer;
}

let cachedRing: RingKey[] | null = null;

/** Derive a 32-byte key from an env value (hex when it is 64 chars). */
function deriveKey(input: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(input)) return Buffer.from(input, "hex");
  return createHash("sha256").update(input, "utf8").digest();
}

/** Build a keyring from ordered key materials; duplicate materials collapse. */
function buildRing(materials: string[]): RingKey[] {
  const ring: RingKey[] = [];
  const seenMaterials = new Set<string>();
  for (const material of materials) {
    if (seenMaterials.has(material)) continue; // same material listed twice
    seenMaterials.add(material);
    const key = deriveKey(material);
    const id = key.toString("hex").slice(0, KEY_ID_HEX);
    if (ring.some((k) => k.id === id)) {
      // Distinct keys sharing a 6-hex-char prefix (1-in-16M per pair) would
      // make keyId routing ambiguous — fail loudly at load time instead.
      throw new Error(`encryption keyring has a duplicate key id: ${id}`);
    }
    ring.push({ id, key });
  }
  if (ring.length === 0) throw new Error("encryption keyring is empty");
  return ring;
}

/**
 * Load (and cache) the ordered encryption keyring: env first (list, then
 * legacy single value), then a persisted file next to the sqlite db so
 * local/headless deployments keep working across restarts. The first entry is
 * the encryption key; the rest decrypt only.
 */
export function getEncryptionRing(): RingKey[] {
  if (cachedRing) return cachedRing;
  const multi = process.env.AGENT_WORLD_ENCRYPTION_KEYS;
  if (multi && multi.trim()) {
    cachedRing = buildRing(multi.split(",").map((s) => s.trim()).filter(Boolean));
    return cachedRing;
  }
  if (process.env.AGENT_WORLD_ENCRYPTION_KEY) {
    cachedRing = buildRing([process.env.AGENT_WORLD_ENCRYPTION_KEY]);
    return cachedRing;
  }
  const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
  const keysFile = join(dirname(dbFile), ".encryption-keys");
  if (existsSync(keysFile)) {
    // The file existing means rows may already be sealed with a key inside it:
    // an unreadable ring must abort, never regenerate (that would brick data).
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(keysFile, "utf8"));
    } catch (err) {
      throw new Error(`could not parse ${keysFile}: ${(err as Error).message}`);
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      !parsed.every((v) => typeof v === "string" && v.trim())
    ) {
      throw new Error(`${keysFile} must be a non-empty JSON array of key strings`);
    }
    cachedRing = buildRing(parsed.map((s) => (s as string).trim()));
    return cachedRing;
  }
  const keyFile = join(dirname(dbFile), ".encryption-key");
  try {
    const existing = readFileSync(keyFile, "utf8").trim();
    if (/^[0-9a-fA-F]{64}$/.test(existing)) {
      cachedRing = buildRing([existing]);
      return cachedRing;
    }
  } catch {
    /* first boot */
  }
  const fresh = randomBytes(KEY_BYTES).toString("hex");
  try {
    writeFileSync(keysFile, JSON.stringify([fresh]), { mode: 0o600 });
  } catch (err) {
    // Persisting is best-effort: without it the key changes every restart and
    // previously encrypted rows become undecryptable, so warn loudly.
    console.warn("[at-rest] could not persist encryption key, encrypted data will not survive restart:", err);
  }
  cachedRing = buildRing([fresh]);
  return cachedRing;
}

/** The first (newest) keyring entry — the one new ciphertext is sealed with. */
export function getEncryptionKey(): Buffer {
  return getEncryptionRing()[0]!.key;
}

/** Decrypt one (iv, tag, cipher) triple with a specific key; throws on mismatch. */
function decryptWith(key: Buffer, ivB64: string, tagB64: string, dataB64: string): string {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch (err) {
    throw new Error(`failed to decrypt stored value: ${(err as Error).message}`);
  }
}

/** True when the value is already sealed under either envelope format. */
function isEncrypted(v: string): boolean {
  return v.startsWith(ENC_PREFIX_V1) || v.startsWith(ENC_PREFIX_V2);
}

/** Encrypt a string with the newest key; returns `enc:v2:<keyId>:<iv>:<tag>:<cipher>`. */
export function encryptString(plain: string): string {
  const primary = getEncryptionRing()[0]!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, primary.key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${ENC_PREFIX_V2}${primary.id}:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

/** Decrypt a value; legacy plaintext (no prefix) is returned unchanged. */
export function decryptString(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const ring = getEncryptionRing();
  if (stored.startsWith(ENC_PREFIX_V2)) {
    const parts = stored.slice(ENC_PREFIX_V2.length).split(":");
    if (parts.length !== 4) throw new Error("malformed encrypted value");
    const [keyId = "", ivB64 = "", tagB64 = "", dataB64 = ""] = parts;
    const entry = ring.find((k) => k.id === keyId);
    if (!entry) throw new Error(`unknown encryption key id: ${keyId}`);
    return decryptWith(entry.key, ivB64, tagB64, dataB64);
  }
  // v1 predates the keyring: no id to route by, so try every key. GCM's auth
  // tag makes a wrong key fail instead of mis-decrypting, and the key that
  // sealed the row is somewhere in the ring until re-encryption converges.
  const parts = stored.slice(ENC_PREFIX_V1.length).split(":");
  if (parts.length !== 3) throw new Error("malformed encrypted value");
  const [ivB64 = "", tagB64 = "", dataB64 = ""] = parts;
  for (const { key } of ring) {
    try {
      return decryptWith(key, ivB64, tagB64, dataB64);
    } catch {
      /* try the next key */
    }
  }
  throw new Error("failed to decrypt stored value: no keyring key matches (v1)");
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
const ENC_PREFIX_V1_ENCODED = encodeURIComponent(ENC_PREFIX_V1);
const ENC_PREFIX_V2_ENCODED = encodeURIComponent(ENC_PREFIX_V2);

/** True when the URL param value is already a sealed ciphertext (either format). */
function isEncodedEncrypted(v: string): boolean {
  return v.startsWith(ENC_PREFIX_V1_ENCODED) || v.startsWith(ENC_PREFIX_V2_ENCODED);
}

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
 * `…?access_token=enc%3Av2%3A…&t=1`.
 *
 * The ciphertext is percent-encoded because it is base64 and a raw `+` inside a
 * query string decodes server-side as a space, which would silently corrupt the
 * token. Values that already carry an encoded prefix (either format) are left
 * alone, so sealing twice is a no-op.
 */
function sealUrlQuery(value: string): string {
  return value.replace(QUERY_PARAM, (pair, sep: string, name: string, eq: string, val: string) => {
    if (!val || !QUERY_SECRET.test(name)) return pair;
    if (isEncodedEncrypted(val)) return pair;
    return `${sep}${name}${eq}${encodeURIComponent(encryptString(val))}`;
  });
}

/** Reverse of {@link sealUrlQuery}; a malformed or tampered value throws. */
function openUrlQuery(value: string): string {
  return value.replace(QUERY_PARAM, (pair, sep: string, name: string, eq: string, val: string) => {
    if (!isEncodedEncrypted(val)) return pair;
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

/** Encrypt unless already encrypted (either format), so sealing is idempotent. */
function sealValue(v: string): string {
  return isEncrypted(v) ? v : encryptString(v);
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
