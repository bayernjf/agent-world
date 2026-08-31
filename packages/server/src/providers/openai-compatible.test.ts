import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "../config.js";
import { buildUserContent, openAICompatibleWorker } from "./openai-compatible.js";

describe("buildUserContent (4.5)", () => {
  it("prefers multimodal content parts when supplied", () => {
    const out = buildUserContent("hello", [], [
      { type: "text", text: "caption" },
      { type: "image", image: "https://x/a.png" },
    ]) as Array<{ type: string; image_url?: { url: string } }>;
    expect(out).toEqual([
      { type: "text", text: "caption" },
      { type: "image_url", image_url: { url: "https://x/a.png" } },
    ]);
  });

  it("falls back to images shortcut when no content is given", () => {
    const out = buildUserContent("look", ["https://x/b.png"]) as Array<{ type: string }>;
    expect(out).toContainEqual({ type: "image_url", image_url: { url: "https://x/b.png" } });
    expect(out[0]).toEqual({ type: "text", text: "look" });
  });

  it("returns the plain string when neither content nor images exist", () => {
    expect(buildUserContent("just text")).toBe("just text");
    expect(buildUserContent("")).toBe("(no input)");
  });
});

describe("audio egress + key pairing (audit H5)", () => {
  const provider: ProviderConfig = {
    type: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-stored",
    models: ["m-tts"],
  };

  afterEach(() => vi.unstubAllGlobals());

  it("refuses an internal audio endpoint without calling fetch", async () => {
    const worker = openAICompatibleWorker(provider);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      worker.generateAudio!({
        node: { id: "n" } as never,
        config: { model: "m-tts", n: 1, baseUrl: "http://127.0.0.1:8080/v1", apiKey: "sk-node" } as never,
        input: "hi",
      }),
    ).rejects.toThrow(/SSRF 防护/);
    // The IP literal is refused before any request is dispatched.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends the stored provider key to a custom baseUrl", async () => {
    const worker = openAICompatibleWorker(provider);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Custom baseUrl without a node-level key is rejected before any request,
    // so the operator's stored key cannot be replayed to an attacker host.
    await expect(
      worker.generateAudio!({
        node: { id: "n" } as never,
        config: { model: "m-tts", n: 1, baseUrl: "https://attacker.example/v1" } as never,
        input: "hi",
      }),
    ).rejects.toThrow(/requires a node-level apiKey/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
