import { describe, expect, it, beforeEach, vi } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Graph } from "@agent-world/core";

// The module caches its keyring, so every test re-imports it fresh after
// arranging env vars — the cache must never leak a key across tests.
async function fresh() {
  vi.resetModules();
  return await import("./at-rest.js");
}

const K1 = "a".repeat(64); // hex-64 → id "aaaaaa"
const K2 = "b".repeat(64); // hex-64 → id "bbbbbb"
const K3 = "c".repeat(64); // hex-64 → id "cccccc"

/** Seal a v1 envelope with a specific key, for legacy-row tests. */
function sealV1(plain: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

const baseGraph = (over: Partial<Graph> = {}): Graph =>
  ({
    id: "g1",
    name: "g",
    version: 1,
    nodes: [],
    edges: [],
    ...over,
  }) as Graph;

const withSecret = (secret: string): Graph =>
  baseGraph({ triggers: [{ type: "webhook", webhookSecret: secret, enabled: true }] });

describe("at-rest encryption (audit L3)", () => {
  beforeEach(() => {
    delete process.env.AGENT_WORLD_ENCRYPTION_KEYS;
    delete process.env.AGENT_WORLD_ENCRYPTION_KEY;
    delete process.env.DB_FILE;
  });

  it("round-trips through encrypt/decrypt", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = K1;
    const { encryptString, decryptString } = await fresh();
    const stored = encryptString("sk-abc123");
    expect(stored.startsWith("enc:v2:")).toBe(true);
    expect(stored).not.toContain("sk-abc123");
    expect(decryptString(stored)).toBe("sk-abc123");
  });

  it("derives a 32-byte key from an arbitrary env string", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = "super-secret-value";
    const { getEncryptionKey } = await fresh();
    expect(getEncryptionKey().length).toBe(32);
  });

  it("treats legacy plaintext as-is (no prefix)", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = K1;
    const { decryptString } = await fresh();
    expect(decryptString("sk-plain-old")).toBe("sk-plain-old");
  });

  it("fails closed on a malformed or tampered value", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = K1;
    const { encryptString, decryptString } = await fresh();
    expect(() => decryptString("enc:v1:not-a-valid-payload")).toThrow();
    expect(() => decryptString("enc:v2:aaaaaa:only:two:parts")).toThrow();
    expect(() => decryptString("enc:v2:zzzzzz:a:b:c")).toThrow(/unknown encryption key id/);
    const stored = encryptString("sk-x");
    const [keyId, iv, tag, data] = stored.slice("enc:v2:".length).split(":");
    // flip one byte in the ciphertext → auth tag mismatch
    const tampered = Buffer.from(data, "base64");
    tampered[0] ^= 0xff;
    expect(() => decryptString(`enc:v2:${keyId}:${iv}:${tag}:${tampered.toString("base64")}`)).toThrow();
  });

  it("encrypts twice with different IVs", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = K1;
    const { encryptString, decryptString } = await fresh();
    const a = encryptString("same");
    const b = encryptString("same");
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe("same");
    expect(decryptString(b)).toBe("same");
  });

  it("seal/open round-trip a webhook secret without mutating the input", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = K1;
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const g = withSecret("wh-secret");
    const sealed = sealGraphDoc(g);
    expect(g.triggers![0].webhookSecret).toBe("wh-secret"); // input untouched
    expect(sealed.triggers![0].webhookSecret).not.toContain("wh-secret");
    expect(sealed.triggers![0].webhookSecret.startsWith("enc:v2:")).toBe(true);
    expect(openGraphDoc(sealed).triggers![0].webhookSecret).toBe("wh-secret");
  });

  it("leaves graphs without webhook secrets unchanged", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = K1;
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const g = baseGraph();
    expect(sealGraphDoc(g)).toBe(g);
    expect(openGraphDoc(g)).toBe(g);
  });

  it("drops orphan edges whose endpoints are missing on open", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = K1;
    const { openGraphDoc } = await fresh();
    const g = baseGraph({
      nodes: [
        { id: "a", kind: "source", name: "A", x: 0, y: 0 },
        { id: "b", kind: "sink", name: "B", x: 1, y: 1 },
      ],
      edges: [
        { id: "e1", from: "a", to: "b", kind: "flow" },
        { id: "e2", from: "a", to: "ghost", kind: "flow" },
        { id: "e3", from: "ghost2", to: "b", kind: "flow" },
      ],
    });
    const opened = openGraphDoc(g);
    expect(opened.edges).toEqual([{ id: "e1", from: "a", to: "b", kind: "flow" }]);
    // input untouched; only the returned copy is cleaned
    expect(g.edges).toHaveLength(3);
  });
});

// The L3 fix sealed only `triggers[].webhookSecret`. Every other credential a
// graph document can carry — node-level provider keys, notify secret/webhook
// URL, connector auth tokens, auth-ish HTTP headers — stayed plaintext in
// sqlite, in version snapshots and in graph exports. Sealing is now a walk
// keyed by field name, so these cover the paths that were missed.
describe("at-rest encryption — node-level credentials", () => {
  const nodeGraph = (node: Record<string, unknown>): Graph =>
    baseGraph({ nodes: [node] as never, edges: [] });
  const cfgOf = (g: Graph, kind: string): Record<string, unknown> =>
    (g.nodes[0] as unknown as Record<string, unknown>)[kind] as Record<string, unknown>;

  beforeEach(async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = undefined;
    process.env.AGENT_WORLD_ENCRYPTION_KEY = K1;
    await fresh();
  });

  it("seals the provider apiKey on every media node kind and the generic node", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    for (const kind of ["imageGen", "videoGen", "audioGen", "generic"]) {
      const g = nodeGraph({ id: "n", kind, name: "N", x: 0, y: 0, [kind]: { model: "m", apiKey: "sk-node-key" } });
      const sealed = sealGraphDoc(g);
      expect(JSON.stringify(sealed), kind).not.toContain("sk-node-key");
      expect(String(cfgOf(sealed, kind).apiKey).startsWith("enc:v2:"), kind).toBe(true);
      expect(cfgOf(openGraphDoc(sealed), kind).apiKey, kind).toBe("sk-node-key");
      // the caller's graph object is never mutated in place
      expect(cfgOf(g, kind).apiKey, kind).toBe("sk-node-key");
    }
  });

  it("seals the notify secret and webhook URL, whose path embeds the bot token", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const url = "https://open.feishu.cn/open-apis/bot/v2/hook/BOT-TOKEN";
    const g = nodeGraph({
      id: "n", kind: "notify", name: "N", x: 0, y: 0,
      notify: { provider: "feishu", webhookUrl: url, secret: "sign-secret", message: "hello" },
    });
    const json = JSON.stringify(sealGraphDoc(g));
    expect(json).not.toContain("BOT-TOKEN");
    expect(json).not.toContain("sign-secret");
    expect(json).toContain("hello"); // non-credential fields stay readable for debugging
    const opened = cfgOf(openGraphDoc(sealGraphDoc(g)), "notify");
    expect(opened.webhookUrl).toBe(url);
    expect(opened.secret).toBe("sign-secret");
  });

  it("seals connector auth tokens and auth headers nested under source.connector.http", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const g = nodeGraph({
      id: "n", kind: "source", name: "N", x: 0, y: 0,
      source: {
        connector: {
          type: "http",
          http: {
            url: "https://api.example.com/x",
            auth: { type: "bearer", token: "conn-token" },
            headers: { authorization: "Bearer hdr-token", "content-type": "application/json" },
          },
        },
      },
    });
    const json = JSON.stringify(sealGraphDoc(g));
    expect(json).not.toContain("conn-token");
    expect(json).not.toContain("hdr-token");
    expect(json).toContain("application/json"); // benign header untouched
    expect(json).toContain("https://api.example.com/x"); // the endpoint is not a secret
    const http = (cfgOf(openGraphDoc(sealGraphDoc(g)), "source") as any).connector.http;
    expect(http.auth.token).toBe("conn-token");
    expect(http.headers.authorization).toBe("Bearer hdr-token");
    expect(http.headers["content-type"]).toBe("application/json");
  });

  it("is idempotent — sealing a sealed doc does not double-wrap", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const g = nodeGraph({ id: "n", kind: "imageGen", name: "N", x: 0, y: 0, imageGen: { model: "m", apiKey: "sk-once" } });
    const once = sealGraphDoc(g);
    const twice = sealGraphDoc(once);
    expect(cfgOf(twice, "imageGen").apiKey).toBe(cfgOf(once, "imageGen").apiKey);
    expect(cfgOf(openGraphDoc(twice), "imageGen").apiKey).toBe("sk-once");
  });

  it("opens legacy plaintext node credentials unchanged", async () => {
    const { openGraphDoc } = await fresh();
    const g = nodeGraph({ id: "n", kind: "audioGen", name: "N", x: 0, y: 0, audioGen: { model: "tts-1", apiKey: "sk-legacy-plain" } });
    expect(cfgOf(openGraphDoc(g), "audioGen").apiKey).toBe("sk-legacy-plain");
  });

  it("preserves key order so plaintext content hashes stay comparable", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const g = nodeGraph({
      id: "n", kind: "notify", name: "N", x: 0, y: 0,
      notify: { provider: "feishu", webhookUrl: "https://x/hook/T", message: "m" },
    });
    const opened = cfgOf(openGraphDoc(sealGraphDoc(g)), "notify");
    expect(Object.keys(opened)).toEqual(["provider", "webhookUrl", "message"]);
  });

  it("leaves a graph with no credentials anywhere as the same reference", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const g = nodeGraph({ id: "n", kind: "textGen", name: "N", x: 0, y: 0, textGen: { model: "m", prompt: "p", skills: [] } });
    expect(sealGraphDoc(g)).toBe(g);
    expect(openGraphDoc(g)).toBe(g);
  });

  it("seals a credential hidden under a custom header name no list could enumerate", async () => {
    // The exact SECRET_KEYS list covers `authorization` / `x-api-key` and friends,
    // but header names are user-chosen: dogfood pipelines have used whatever the
    // upstream API asked for. Name-pattern matching inside a headers record is
    // what closes that gap.
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const g = nodeGraph({
      id: "n", kind: "http", name: "N", x: 0, y: 0,
      http: {
        url: "https://api.example.com/x",
        headers: {
          "X-My-Auth": "custom-header-token",
          "X-Signature": "sig-9f8e7d",
          "Content-Type": "application/json",
        },
      },
    });
    const json = JSON.stringify(sealGraphDoc(g));
    expect(json).not.toContain("custom-header-token");
    expect(json).not.toContain("sig-9f8e7d");
    expect(json).toContain("application/json"); // benign headers stay debuggable
    expect(json).toContain("https://api.example.com/x");

    const opened = cfgOf(openGraphDoc(sealGraphDoc(g)), "http").headers as Record<string, string>;
    expect(opened["X-My-Auth"]).toBe("custom-header-token");
    expect(opened["X-Signature"]).toBe("sig-9f8e7d");
    expect(opened["Content-Type"]).toBe("application/json");
  });

  it("keeps the same reference when a headers record holds nothing auth-ish", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const g = nodeGraph({
      id: "n", kind: "http", name: "N", x: 0, y: 0,
      http: { url: "https://api.example.com/x", headers: { "Content-Type": "application/json", Accept: "*/*" } },
    });
    expect(sealGraphDoc(g)).toBe(g);
    expect(openGraphDoc(g)).toBe(g);
  });
});

// The boundary ff223bb left open: a credential riding in a URL's query string.
// Real pipelines hit this constantly — DingTalk/WeCom bots take
// `?access_token=…`, Azure OpenAI takes `?api-key=…`, and those URLs sit in
// http node `url` and connector `url` fields, in version snapshots and exports.
describe("at-rest encryption — credentials inside a URL query string", () => {
  const nodeGraph = (node: Record<string, unknown>): Graph =>
    baseGraph({ nodes: [node] as never, edges: [] });
  const cfgOf = (g: Graph, kind: string): Record<string, unknown> =>
    (g.nodes[0] as unknown as Record<string, unknown>)[kind] as Record<string, unknown>;
  const httpUrl = (g: Graph): string => String(cfgOf(g, "http").url);
  const withHttpUrl = (url: string): Graph =>
    nodeGraph({ id: "n", kind: "http", name: "N", x: 0, y: 0, http: { method: "POST", url, body: "{}" } });

  beforeEach(async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = undefined;
    process.env.AGENT_WORLD_ENCRYPTION_KEY = K1;
    await fresh();
  });

  it("seals the token param and nothing else, so the endpoint stays debuggable", async () => {
    const { sealGraphDoc } = await fresh();
    const url = "https://oapi.dingtalk.com/robot/send?access_token=DING-BOT-TOKEN&timestamp=1700000000";
    const json = JSON.stringify(sealGraphDoc(withHttpUrl(url)));
    expect(json).not.toContain("DING-BOT-TOKEN");
    // the host, path and benign params are still readable on disk
    expect(json).toContain("https://oapi.dingtalk.com/robot/send?access_token=");
    expect(json).toContain("&timestamp=1700000000");
    // …and the ciphertext is percent-encoded: a raw base64 `+` in a query
    // string is decoded server-side as a space, which would corrupt the token.
    expect(httpUrl(sealGraphDoc(withHttpUrl(url)))).toContain("enc%3Av2%3A");
  });

  it("round-trips the URL byte for byte", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const url = "https://x.openai.azure.com/openai/deployments/gpt?api-key=AZURE-KEY&api-version=2024-02-01#seg";
    const sealed = sealGraphDoc(withHttpUrl(url));
    expect(httpUrl(sealed)).not.toBe(url);
    expect(httpUrl(openGraphDoc(sealed))).toBe(url);
  });

  it("is idempotent — an already-sealed param value is not wrapped again", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const g = withHttpUrl("https://h/send?token=twice-sealed");
    const once = sealGraphDoc(g);
    const twice = sealGraphDoc(once);
    expect(httpUrl(twice)).toBe(httpUrl(once));
    expect(httpUrl(openGraphDoc(twice))).toBe("https://h/send?token=twice-sealed");
  });

  it("fails closed on a tampered param value instead of returning ciphertext", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const sealed = httpUrl(sealGraphDoc(withHttpUrl("https://h/send?token=intact-value")));
    const body = sealed.slice(sealed.indexOf("enc%3Av2%3A"));
    expect(() => httpUrl(openGraphDoc(withHttpUrl(`https://h/send?token=${body}%3Ax`)))).toThrow();
  });

  it("leaves an empty credential param alone", async () => {
    const { sealGraphDoc } = await fresh();
    const g = withHttpUrl("https://h/send?token=&q=1");
    expect(sealGraphDoc(g)).toBe(g);
  });

  it("does not seal a benign param that merely contains a credential word", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    // QUERY_SECRET matches names exactly for this reason: `author` contains
    // "auth" and `keyboard` contains "key", and neither is a secret.
    const url = "https://h/list?author=jane&keyboard=1&sig=KEEP-ME";
    const sealed = httpUrl(sealGraphDoc(withHttpUrl(url)));
    expect(sealed).toContain("author=jane");
    expect(sealed).toContain("keyboard=1");
    expect(sealed).not.toContain("KEEP-ME");
    expect(httpUrl(openGraphDoc(withHttpUrl(sealed)))).toBe(url);
  });

  it("leaves a URL without credential params at the same reference", async () => {
    const { sealGraphDoc, openGraphDoc } = await fresh();
    const g = withHttpUrl("https://api.example.com/v1/items?page=2&sort=updated_at");
    expect(sealGraphDoc(g)).toBe(g);
    expect(openGraphDoc(g)).toBe(g);
  });
});

// design-key-rotation.md P1: the ordered keyring. The first key encrypts;
// every other key only decrypts (historical). v2 ciphertext names its key by
// id; v1 predates the ring so decryption tries every key in turn — GCM never
// mis-decrypts with a wrong key, it just fails.
describe("at-rest encryption — keyring (design-key-rotation P1)", () => {
  beforeEach(() => {
    delete process.env.AGENT_WORLD_ENCRYPTION_KEYS;
    delete process.env.AGENT_WORLD_ENCRYPTION_KEY;
    delete process.env.DB_FILE;
  });

  it("seals with the first key and stamps its id; an older v2 row still decrypts", async () => {
    // Row written when K1 was the only key.
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = K1;
    const m1 = await fresh();
    const oldRow = m1.encryptString("sk-rotate");

    // Rotation: K2 is now first; K1 is kept for decryption only.
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = `${K2},${K1}`;
    const m2 = await fresh();
    const newRow = m2.encryptString("sk-rotate");

    expect(newRow.startsWith(`enc:v2:bbbbbb:`)).toBe(true);
    expect(m2.decryptString(oldRow)).toBe("sk-rotate"); // sealed with K1
    expect(m2.decryptString(newRow)).toBe("sk-rotate"); // sealed with K2
  });

  it("routes v2 by keyId; an unknown id fails closed", async () => {
    // Row written when K1 was the only key.
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = K1;
    const m1 = await fresh();
    const k1Row = m1.encryptString("sk-a"); // stamped with K1's id
    // Rotate K1 away entirely: only K2 in the ring.
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = K2;
    const m2 = await fresh();
    expect(() => m2.decryptString(k1Row)).toThrow(/unknown encryption key id/);
  });

  it("decrypts legacy v1 rows by trying every ring key", async () => {
    // v1 row sealed with K1 while the ring is [K2, K1] — the rolling window
    // before re-encryption converges. The read path must keep working.
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = `${K2},${K1}`;
    const { decryptString } = await fresh();
    expect(decryptString(sealV1("legacy-v1-secret", K1))).toBe("legacy-v1-secret");
    expect(decryptString(sealV1("legacy-v1-secret", K2))).toBe("legacy-v1-secret");
  });

  it("fails closed when no ring key can open a v1 row", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = K2;
    const { decryptString } = await fresh();
    expect(() => decryptString(sealV1("gone", K1))).toThrow(/no keyring key matches/);
  });

  it("treats the single-value env var as a one-element ring", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = K1;
    const { getEncryptionRing, encryptString } = await fresh();
    expect(getEncryptionRing()).toHaveLength(1);
    expect(encryptString("x").startsWith("enc:v2:aaaaaa:")).toBe(true);
  });

  it("collapses a material listed twice instead of duplicating the ring", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = `${K1},${K1},${K2}`;
    const { getEncryptionRing } = await fresh();
    expect(getEncryptionRing().map((k) => k.id)).toEqual(["aaaaaa", "bbbbbb"]);
  });

  it("derives passphrase keys and still gives them distinct ids", async () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEYS = "first-passphrase,second-passphrase";
    const { getEncryptionRing, encryptString, decryptString } = await fresh();
    const ring = getEncryptionRing();
    expect(ring).toHaveLength(2);
    const sealed = encryptString("sk-pass");
    expect(sealed.startsWith(`enc:v2:${ring[0]!.id}:`)).toBe(true);
    expect(decryptString(sealed)).toBe("sk-pass");
  });

  it("reads the keyring from a .encryption-keys JSON array next to the db", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-ring-"));
    try {
      writeFileSync(join(dir, ".encryption-keys"), JSON.stringify([K2, K1]), { mode: 0o600 });
      process.env.DB_FILE = join(dir, "g.sqlite");
      const { getEncryptionRing, encryptString, decryptString } = await fresh();
      expect(getEncryptionRing().map((k) => k.id)).toEqual(["bbbbbb", "aaaaaa"]);
      const sealed = encryptString("file-ring");
      expect(sealed.startsWith("enc:v2:bbbbbb:")).toBe(true);
      expect(decryptString(sealed)).toBe("file-ring");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wraps the legacy .encryption-key file as a one-element ring", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-legacy-"));
    try {
      writeFileSync(join(dir, ".encryption-key"), K3, { mode: 0o600 });
      process.env.DB_FILE = join(dir, "g.sqlite");
      const { getEncryptionRing, encryptString } = await fresh();
      expect(getEncryptionRing().map((k) => k.id)).toEqual(["cccccc"]);
      expect(encryptString("x").startsWith("enc:v2:cccccc:")).toBe(true);
      // lazy migration: the legacy file is left in place, read as a ring
      expect(readFileSync(join(dir, ".encryption-key"), "utf8").trim()).toBe(K3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("generates and persists a fresh .encryption-keys file on first boot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-fresh-"));
    try {
      process.env.DB_FILE = join(dir, "g.sqlite");
      const m1 = await fresh();
      const sealed = m1.encryptString("boot");
      const persisted = JSON.parse(readFileSync(join(dir, ".encryption-keys"), "utf8")) as string[];
      expect(persisted).toHaveLength(1);
      expect(sealed.startsWith(`enc:v2:${persisted[0]!.slice(0, 6)}:`)).toBe(true);
      // and the persisted ring decrypts what the in-memory one sealed
      const m2 = await fresh();
      expect(m2.decryptString(sealed)).toBe("boot");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to regenerate a key when .encryption-keys is malformed (data would brick)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-bad-"));
    try {
      writeFileSync(join(dir, ".encryption-keys"), "{not json", { mode: 0o600 });
      process.env.DB_FILE = join(dir, "g.sqlite");
      const m = await fresh();
      expect(() => m.getEncryptionRing()).toThrow(/could not parse/);

      writeFileSync(join(dir, ".encryption-keys"), JSON.stringify([]), { mode: 0o600 });
      const m2 = await fresh();
      expect(() => m2.getEncryptionRing()).toThrow(/non-empty JSON array/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
