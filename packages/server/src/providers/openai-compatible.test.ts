import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "../config.js";
import { GuardedFetchError } from "../ssrf.js";
import { buildUserContent, mapGuardedError, openAICompatibleWorker } from "./openai-compatible.js";

describe("mapGuardedError", () => {
  it("keeps deterministic guard refusals non-retryable-ish PROVIDER_ERROR with the original message", () => {
    const err = mapGuardedError(new GuardedFetchError("internal-target", "SSRF 防护拒绝内网地址"));
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(err.message).toContain("SSRF");
  });

  it("maps transient transport faults to PROVIDER_ERROR so the node-level retry policy can absorb them", () => {
    // Dogfood tpl-translation: a proxy hiccup surfaced as a bare "fetch
    // failed" mapped to UNKNOWN, which never retries and failed the whole
    // run with an unactionable message.
    for (const message of ["fetch failed", "connect ECONNREFUSED 127.0.0.1:7897", "read ECONNRESET", "getaddrinfo ENOTFOUND api.example.com"]) {
      const err = mapGuardedError(new Error(message));
      expect(err.code, message).toBe("PROVIDER_ERROR");
      expect(err.message, message).toContain(message);
    }
  });

  it("keeps truly unknown errors on UNKNOWN", () => {
    const err = mapGuardedError(new Error("something else entirely"));
    expect(err.code).toBe("UNKNOWN");
  });
});

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

describe("videoAdapter (agnes-style video API)", () => {
  const base = {
    type: "openai-compatible" as const,
    baseUrl: "https://gw.example/v1",
    apiKey: "sk-test",
    models: ["v1"],
    endpoints: { video: "/videos" },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends mode, maps aspect to width/height, and omits duration", async () => {
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const worker = openAICompatibleWorker({
      ...base,
      videoAdapter: {
        createBody: { mode: "ti2vid" },
        omitDuration: true,
        aspectToSize: { "16:9": { width: 1280, height: 720 } },
      },
    });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        // Sync response path (no polling): data[0].url drives the result.
        return new Response(JSON.stringify({ data: [{ url: "https://cdn.example/v.mp4" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const results = await worker.generateVideo!({
      node: { id: "n" } as never,
      config: { model: "v1", duration: 5, aspect: "16:9", n: 1 } as never,
      input: "a cat walking",
    });
    expect(results[0].mimeType).toBe("video/mp4");
    const init = calls.find((c) => c.url.endsWith("/videos"))!.init!;
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "v1", mode: "ti2vid", prompt: "a cat walking", width: 1280, height: 720 });
    expect(body.duration).toBeUndefined();
    expect(body.aspect_ratio).toBeUndefined();
  });

  it("reads the generated URL from metadata.url when resultUrlPath is set", async () => {
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const worker = openAICompatibleWorker({
      ...base,
      videoAdapter: { createBody: { mode: "ti2vid" }, resultUrlPath: "metadata.url" },
    });
    const calls: Array<string> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push(String(url));
        const u = String(url);
        if (u.endsWith("/videos")) {
          return new Response(JSON.stringify({ id: "task_1", status: "queued" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u.endsWith("/videos/task_1")) {
          return new Response(JSON.stringify({ id: "task_1", status: "completed", metadata: { url: "https://cdn.example/v.mp4" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u === "https://cdn.example/v.mp4") {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
        }
        throw new Error("unexpected fetch: " + u);
      }),
    );
    const results = await worker.generateVideo!({
      node: { id: "n" } as never,
      config: { model: "v1", n: 1 } as never,
      input: "a cat walking",
    });
    expect(results[0].mimeType).toBe("video/mp4");
    expect(calls).toContain("https://cdn.example/v.mp4");
  });

  it("reads the top-level url when resultUrlPath points at it (agnes shape)", async () => {
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const worker = openAICompatibleWorker({
      ...base,
      videoAdapter: { createBody: { mode: "ti2vid" }, resultUrlPath: "url" },
    });
    const calls: Array<string> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push(String(url));
        const u = String(url);
        if (u.endsWith("/videos")) {
          return new Response(JSON.stringify({ id: "task_1", status: "queued" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u.endsWith("/videos/task_1")) {
          return new Response(JSON.stringify({ id: "task_1", status: "completed", url: "https://cdn.example/v2.mp4" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u === "https://cdn.example/v2.mp4") {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
        }
        throw new Error("unexpected fetch: " + u);
      }),
    );
    const results = await worker.generateVideo!({
      node: { id: "n" } as never,
      config: { model: "v1", n: 1 } as never,
      input: "a cat walking",
    });
    expect(results[0].mimeType).toBe("video/mp4");
    expect(calls).toContain("https://cdn.example/v2.mp4");
  });

  it("falls back to metadata.url when the configured result path is absent", async () => {
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const worker = openAICompatibleWorker({
      ...base,
      videoAdapter: { createBody: { mode: "ti2vid" }, resultUrlPath: "url" },
    });
    const calls: Array<string> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push(String(url));
        const u = String(url);
        if (u.endsWith("/videos")) {
          return new Response(JSON.stringify({ id: "task_1", status: "queued" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u.endsWith("/videos/task_1")) {
          return new Response(JSON.stringify({ id: "task_1", status: "completed", metadata: { url: "https://cdn.example/v3.mp4" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u === "https://cdn.example/v3.mp4") {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
        }
        throw new Error("unexpected fetch: " + u);
      }),
    );
    const results = await worker.generateVideo!({
      node: { id: "n" } as never,
      config: { model: "v1", n: 1 } as never,
      input: "a cat walking",
    });
    expect(results[0].mimeType).toBe("video/mp4");
    expect(calls).toContain("https://cdn.example/v3.mp4");
  });

  it("keeps the default OpenAI-compatible shape when no adapter is configured", async () => {
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    const worker = openAICompatibleWorker(base);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ data: [{ url: "https://cdn.example/v.mp4" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await worker.generateVideo!({
      node: { id: "n" } as never,
      config: { model: "v1", duration: 5, aspect: "16:9", n: 1 } as never,
      input: "a cat walking",
    });
    const init = calls.find((c) => c.url.endsWith("/videos"))!.init!;
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "v1", prompt: "a cat walking", duration: 5, aspect_ratio: "16:9" });
    expect(body.mode).toBeUndefined();
  });
});
