import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { routingWorker } from "./index.js";
import { ProviderError } from "./openai-compatible.js";

const config: AppConfig = {
  providers: {
    gateway: {
      type: "openai-compatible",
      baseUrl: "https://gw.example.com/v1",
      apiKey: "sk-test",
      models: ["m-video", "m-tts"],
    },
  },
  defaultModel: "m-video",
  defaultProvider: "gateway",
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Video/audio generation leaves through the guarded egress; gw.example.com
  // is a reserved hostname that cannot resolve in CI, so bypass the SSRF check
  // for this routing/delegation test.
  vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("routingWorker modality delegation", () => {
  it("exposes generateVideo/generateAudio and routes them to the owning provider", async () => {
    const worker = routingWorker(config);
    // The routing worker used to forward only text/judge, which made the
    // engine silently skip every videoGen / audioGen node in production.
    expect(typeof worker.generateVideo).toBe("function");
    expect(typeof worker.generateAudio).toBe("function");

    // Video: sync-style response with a b64 payload.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("v").toString("base64") }] }), {
        status: 200,
      }),
    );
    const videos = await worker.generateVideo!({
      node: { id: "n1", kind: "videoGen", name: "V" } as never,
      config: { model: "m-video", n: 1 } as never,
      input: "a clip",
    });
    expect(videos).toHaveLength(1);
    const videoUrl = String(fetchMock.mock.calls[0]![0]);
    expect(videoUrl.startsWith("https://gw.example.com/v1/")).toBe(true);

    // Audio: synchronous binary response.
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const audios = await worker.generateAudio!({
      node: { id: "n2", kind: "audioGen", name: "A" } as never,
      config: { model: "m-tts", n: 1 } as never,
      input: "hello",
    });
    expect(audios).toHaveLength(1);
    const audioUrl = String(fetchMock.mock.calls[1]![0]);
    expect(audioUrl.startsWith("https://gw.example.com/v1/")).toBe(true);
  });
});

// ---- failover --------------------------------------------------------------

const failoverConfig = (chain?: boolean): AppConfig => ({
  providers: {
    primary: {
      type: "openai-compatible",
      baseUrl: "https://primary.example/v1",
      apiKey: "sk-p",
      models: ["logical"],
    },
    backup: {
      type: "openai-compatible",
      baseUrl: "https://backup.example/v1",
      apiKey: "sk-b",
      models: ["backup-model"],
    },
  },
  defaultModel: "logical",
  defaultProvider: "primary",
  failover: {
    enabled: true,
    ...(chain ? { chains: { logical: [{ provider: "backup", model: "backup-model" }] } } : {}),
  },
});

const sse = (content: string, status = 200) =>
  new Response(
    `data: ${JSON.stringify({
      choices: [{ delta: { content } }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    })}\n\n`,
    { status, headers: { "Content-Type": "text/event-stream" } },
  );

const textArgs = () => ({
  node: { id: "n1", kind: "textGen", name: "N" } as never,
  attempt: 1,
  input: "in",
  config: { model: "logical" } as never,
});

async function collect(gen: AsyncGenerator) {
  const chunks: unknown[] = [];
  let r = await gen.next();
  while (!r.done) {
    chunks.push(r.value);
    r = await gen.next();
  }
  return { chunks, result: r.value };
}

const calledHosts = () => fetchMock.mock.calls.map((c) => String(c[0]));
const requestModelAt = (i: number) =>
  JSON.parse(String((fetchMock.mock.calls[i]![1] as { body: string }).body)).model as string;

describe("routingWorker failover", () => {
  it("retries on the backup provider when the primary upstream is dead", async () => {
    fetchMock.mockImplementation((url) =>
      String(url).includes("primary.example")
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(sse("hi")),
    );
    const { chunks, result } = await collect(routingWorker(failoverConfig(true)).runTextGen(textArgs()));

    expect(calledHosts()).toHaveLength(2);
    expect(calledHosts()[0]).toContain("primary.example");
    expect(calledHosts()[1]).toContain("backup.example");
    expect(requestModelAt(1)).toBe("backup-model");
    expect(chunks).toEqual([{ type: "text-delta", text: "hi" }]);
    expect((result as { output: string }).output).toBe("hi");
  });

  it("falls back to the built-in backup slot's first text model with no explicit chain", async () => {
    fetchMock.mockImplementation((url) =>
      String(url).includes("primary.example")
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(sse("hi")),
    );
    await collect(routingWorker(failoverConfig(false)).runTextGen(textArgs()));
    expect(calledHosts()[1]).toContain("backup.example");
    expect(requestModelAt(1)).toBe("backup-model");
  });

  it("does not fail over on a 429 rate limit", async () => {
    fetchMock.mockResolvedValue(new Response("slow down", { status: 429 }));
    await expect(collect(routingWorker(failoverConfig(true)).runTextGen(textArgs()))).rejects.toMatchObject({
      code: "RATE_LIMIT",
    });
    expect(calledHosts()).toHaveLength(1);
  });

  it("does not fail over on an auth error", async () => {
    fetchMock.mockResolvedValue(new Response("bad key", { status: 401 }));
    await expect(collect(routingWorker(failoverConfig(true)).runTextGen(textArgs()))).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(calledHosts()).toHaveLength(1);
  });

  it("does not fail over after the first chunk already streamed", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`,
          ),
        );
        controller.error(new TypeError("fetch failed"));
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    await expect(collect(routingWorker(failoverConfig(true)).runTextGen(textArgs()))).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(calledHosts()).toHaveLength(1);
  });

  it("throws the last error when the backup target is disabled", async () => {
    const cfg = failoverConfig(true);
    cfg.providers.backup!.enabled = false;
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(collect(routingWorker(cfg).runTextGen(textArgs()))).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    expect(calledHosts()).toHaveLength(1);
  });

  it("fails the gate judge over to the backup provider", async () => {
    const verdict = JSON.stringify({ passed: true, reason: "ok", score: 9 });
    fetchMock.mockImplementation((url) =>
      String(url).includes("primary.example")
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(sse(verdict)),
    );
    const worker = routingWorker(failoverConfig(true));
    const result = await worker.judge({
      node: { id: "g1", kind: "gate", name: "G", textGen: { model: "logical" } } as never,
      attempt: 1,
      input: "",
      output: "stuff",
      criterion: "be good",
    });
    expect(result.passed).toBe(true);
    expect(calledHosts()[1]).toContain("backup.example");
  });
});
