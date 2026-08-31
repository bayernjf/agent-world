import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { routingWorker } from "./index.js";

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
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routingWorker modality delegation", () => {
  it("exposes generateVideo/generateAudio and routes them to the owning provider", async () => {
    const worker = routingWorker(config);
    // The routing worker used to forward only text/judge/image, which made the
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
