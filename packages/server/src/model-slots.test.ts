import { describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { type AppConfig } from "./config.js";
import { defaultModelForModality, resolveModelSlots } from "./model-slots.js";

const cfg: AppConfig = {
  providers: {
    hosted: {
      type: "openai-compatible",
      source: "builtin",
      enabled: true,
      baseUrl: "https://h.example/v1",
      apiKey: "k",
      models: ["h-text", "h-text-2", "h-image"],
      modalities: { "h-text": "text", "h-text-2": "text", "h-image": "image" },
    },
    off: {
      type: "openai-compatible",
      enabled: false,
      baseUrl: "https://o.example/v1",
      apiKey: "k",
      models: ["off-image"],
      modalities: { "off-image": "image" },
    },
    voice: {
      type: "openai-compatible",
      enabled: true,
      baseUrl: "https://v.example/v1",
      apiKey: "k",
      models: ["tts-a"],
      modalities: { "tts-a": "audio" },
    },
  },
  defaultModel: "h-text",
  defaultProvider: "hosted",
  modelOrder: ["hosted::h-text", "off::off-image", "hosted::h-image", "voice::tts-a", "hosted::h-text-2"],
};

const doc = (...nodes: Graph["nodes"]): Graph => ({ id: "g", name: "t", nodes, edges: [] });

const node = (kind: string, id: string, model: string) =>
  ({
    id,
    kind,
    name: `${kind}-${id}`,
    x: 0,
    y: 0,
    [kind === "textGen" ? "textGen" : kind]: kind === "textGen" ? { model, prompt: "" } : { model },
  }) as unknown as Graph["nodes"][number];

describe("defaultModelForModality", () => {
  it("text follows the configured default, even a stale one", () => {
    expect(defaultModelForModality(cfg, "text")).toBe("h-text");
    // 默认值本身已下架时也照实返回：正确的结果是 validateModels 指名报
    // 「模型已不可用」，而不是悄悄换成另一个模型跑起来。
    expect(defaultModelForModality({ ...cfg, defaultModel: "retired" }, "text")).toBe("retired");
  });

  it("media takes the first enabled model of that modality, in modelOrder", () => {
    expect(defaultModelForModality(cfg, "image")).toBe("h-image");
    expect(defaultModelForModality(cfg, "audio")).toBe("tts-a");
    // 没有视频模型可跟：留空，由 validateModels 诚实报"还未配置视频模型"。
    expect(defaultModelForModality(cfg, "video")).toBe("");
  });

  it("skips a model whose provider is disabled", () => {
    const withImageFirst: AppConfig = {
      ...cfg,
      modelOrder: ["off::off-image", "hosted::h-image"],
    };
    expect(defaultModelForModality(withImageFirst, "image")).toBe("h-image");
  });

  it("falls back to scanning providers when modelOrder is absent", () => {
    expect(defaultModelForModality({ ...cfg, modelOrder: undefined }, "audio")).toBe("tts-a");
  });
});

describe("resolveModelSlots", () => {
  it("fills an empty slot with the model to follow", () => {
    const out = resolveModelSlots(doc(node("textGen", "a", "")), cfg);
    expect(out.nodes[0]!.textGen?.model).toBe("h-text");
  });

  it("fills media slots by modality", () => {
    const out = resolveModelSlots(doc(node("imageGen", "i", ""), node("audioGen", "v", "")), cfg);
    expect(out.nodes[0]!.imageGen?.model).toBe("h-image");
    expect(out.nodes[1]!.audioGen?.model).toBe("tts-a");
  });

  it("respects a generic node's declared modality, defaulting to text", () => {
    const asImage = {
      id: "g1",
      kind: "generic",
      name: "g",
      x: 0,
      y: 0,
      generic: { model: "", modality: "image" },
    } as unknown as Graph["nodes"][number];
    expect(resolveModelSlots(doc(asImage), cfg).nodes[0]!.generic?.model).toBe("h-image");
    const noModality = { ...asImage, generic: { model: "" } } as unknown as Graph["nodes"][number];
    expect(resolveModelSlots(doc(noModality), cfg).nodes[0]!.generic?.model).toBe("h-text");
  });

  it("leaves a pinned name exactly as it is", () => {
    const graph = doc(node("textGen", "a", "legacy-model"));
    const out = resolveModelSlots(graph, cfg);
    expect(out.nodes[0]!.textGen?.model).toBe("legacy-model");
    // 无槽可填时必须原样返回同一个引用：存量产线的对象身份不该因为这次
    // 改造而变化（快照 contentHash 算的是持久化文档，这里不能顺手改它）。
    expect(out).toBe(graph);
  });

  it("leaves the slot empty when there is nothing to follow", () => {
    const noVideo: AppConfig = { ...cfg, defaultModel: "", providers: { ...cfg.providers } };
    const out = resolveModelSlots(doc(node("videoGen", "v", "")), noVideo);
    expect(out.nodes[0]!.videoGen?.model).toBe("");
  });

  it("never mutates the graph it was handed", () => {
    const graph = doc(node("textGen", "a", ""));
    resolveModelSlots(graph, cfg);
    expect(graph.nodes[0]!.textGen?.model).toBe("");
  });
});
