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
