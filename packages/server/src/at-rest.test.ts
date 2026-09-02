import { describe, expect, it, beforeEach, vi } from "vitest";
import { decryptString, encryptString, getEncryptionKey, openGraphDoc, sealGraphDoc } from "./at-rest.js";
import type { Graph } from "@agent-world/core";

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
    delete process.env.AGENT_WORLD_ENCRYPTION_KEY;
    vi.resetModules();
  });

  it("round-trips through encrypt/decrypt", () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = "0".repeat(64);
    const stored = encryptString("sk-abc123");
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("sk-abc123");
    expect(decryptString(stored)).toBe("sk-abc123");
  });

  it("derives a 32-byte key from an arbitrary env string", () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = "super-secret-value";
    expect(getEncryptionKey().length).toBe(32);
  });

  it("treats legacy plaintext as-is (no prefix)", () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = "0".repeat(64);
    expect(decryptString("sk-plain-old")).toBe("sk-plain-old");
  });

  it("fails closed on a malformed or tampered value", () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = "0".repeat(64);
    expect(() => decryptString("enc:v1:not-a-valid-payload")).toThrow();
    const stored = encryptString("sk-x");
    const [iv, tag, data] = stored.slice("enc:v1:".length).split(":");
    // flip one byte in the ciphertext → auth tag mismatch
    const tampered = Buffer.from(data, "base64");
    tampered[0] ^= 0xff;
    expect(() => decryptString(`enc:v1:${iv}:${tag}:${tampered.toString("base64")}`)).toThrow();
  });

  it("encrypts twice with different IVs", () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = "0".repeat(64);
    const a = encryptString("same");
    const b = encryptString("same");
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe("same");
    expect(decryptString(b)).toBe("same");
  });

  it("seal/open round-trip a webhook secret without mutating the input", () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = "0".repeat(64);
    const g = withSecret("wh-secret");
    const sealed = sealGraphDoc(g);
    expect(g.triggers![0].webhookSecret).toBe("wh-secret"); // input untouched
    expect(sealed.triggers![0].webhookSecret).not.toContain("wh-secret");
    expect(sealed.triggers![0].webhookSecret.startsWith("enc:v1:")).toBe(true);
    expect(openGraphDoc(sealed).triggers![0].webhookSecret).toBe("wh-secret");
  });

  it("leaves graphs without webhook secrets unchanged", () => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = "0".repeat(64);
    const g = baseGraph();
    expect(sealGraphDoc(g)).toBe(g);
    expect(openGraphDoc(g)).toBe(g);
  });

  it("drops orphan edges whose endpoints are missing on open", () => {
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

  beforeEach(() => {
    process.env.AGENT_WORLD_ENCRYPTION_KEY = "0".repeat(64);
  });

  it("seals the provider apiKey on every media node kind and the generic node", () => {
    for (const kind of ["imageGen", "videoGen", "audioGen", "generic"]) {
      const g = nodeGraph({ id: "n", kind, name: "N", x: 0, y: 0, [kind]: { model: "m", apiKey: "sk-node-key" } });
      const sealed = sealGraphDoc(g);
      expect(JSON.stringify(sealed), kind).not.toContain("sk-node-key");
      expect(String(cfgOf(sealed, kind).apiKey).startsWith("enc:v1:"), kind).toBe(true);
      expect(cfgOf(openGraphDoc(sealed), kind).apiKey, kind).toBe("sk-node-key");
      // the caller's graph object is never mutated in place
      expect(cfgOf(g, kind).apiKey, kind).toBe("sk-node-key");
    }
  });

  it("seals the notify secret and webhook URL, whose path embeds the bot token", () => {
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

  it("seals connector auth tokens and auth headers nested under source.connector.http", () => {
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

  it("is idempotent — sealing a sealed doc does not double-wrap", () => {
    const g = nodeGraph({ id: "n", kind: "imageGen", name: "N", x: 0, y: 0, imageGen: { model: "m", apiKey: "sk-once" } });
    const once = sealGraphDoc(g);
    const twice = sealGraphDoc(once);
    expect(cfgOf(twice, "imageGen").apiKey).toBe(cfgOf(once, "imageGen").apiKey);
    expect(cfgOf(openGraphDoc(twice), "imageGen").apiKey).toBe("sk-once");
  });

  it("opens legacy plaintext node credentials unchanged", () => {
    const g = nodeGraph({ id: "n", kind: "audioGen", name: "N", x: 0, y: 0, audioGen: { model: "tts-1", apiKey: "sk-legacy-plain" } });
    expect(cfgOf(openGraphDoc(g), "audioGen").apiKey).toBe("sk-legacy-plain");
  });

  it("preserves key order so plaintext content hashes stay comparable", () => {
    const g = nodeGraph({
      id: "n", kind: "notify", name: "N", x: 0, y: 0,
      notify: { provider: "feishu", webhookUrl: "https://x/hook/T", message: "m" },
    });
    const opened = cfgOf(openGraphDoc(sealGraphDoc(g)), "notify");
    expect(Object.keys(opened)).toEqual(["provider", "webhookUrl", "message"]);
  });

  it("leaves a graph with no credentials anywhere as the same reference", () => {
    const g = nodeGraph({ id: "n", kind: "textGen", name: "N", x: 0, y: 0, textGen: { model: "m", prompt: "p", skills: [] } });
    expect(sealGraphDoc(g)).toBe(g);
    expect(openGraphDoc(g)).toBe(g);
  });
});
