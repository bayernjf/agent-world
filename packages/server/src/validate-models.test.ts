import { describe, expect, it } from "vitest";
import type { AppConfig, Graph } from "@agent-world/core";
import { validateModels } from "./validate-models.js";
import { providerForModel } from "./config.js";

const cfg: AppConfig = {
  providers: {
    agnes: {
      type: "openai-compatible",
      enabled: true,
      baseUrl: "https://example.com/v1",
      apiKey: "k",
      models: ["agnes-2.0-flash", "agnes-image"],
      modalities: { "agnes-2.0-flash": "text", "agnes-image": "image" },
    },
    disabled: {
      type: "openai-compatible",
      enabled: false,
      models: ["disabled-1"],
      modalities: { "disabled-1": "text" },
    },
    sf: {
      type: "openai-compatible",
      enabled: true,
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKey: "k",
      models: ["sf-tts"],
      modalities: { "sf-tts": "audio" },
    },
  },
  defaultModel: "agnes-2.0-flash",
  defaultProvider: "agnes",
};

const graph: Graph = {
  id: "g",
  name: "test",
  nodes: [],
  edges: [],
};

function withNodes(...nodes: Graph["nodes"]): Graph {
  return { ...graph, nodes };
}

const agentNode = (id: string, model: string) => ({
  id,
  kind: "textGen" as const,
  name: `agent-${id}`,
  x: 0,
  y: 0,
  textGen: { model, prompt: "" },
});
const imageNode = (id: string, model: string) => ({
  id,
  kind: "imageGen" as const,
  name: `image-${id}`,
  x: 0,
  y: 0,
  imageGen: { model, n: 1 },
});
const audioNode = (id: string, model: string) => ({
  id,
  kind: "audioGen" as const,
  name: `audio-${id}`,
  x: 0,
  y: 0,
  audioGen: { model, prompt: "" },
});
const sourceNode = (id: string) => ({
  id,
  kind: "source" as const,
  name: `source-${id}`,
  x: 0,
  y: 0,
});

describe("validateModels", () => {
  it("returns no diagnostics for an empty graph", () => {
    expect(validateModels(graph, cfg)).toEqual([]);
  });

  it("ignores kinds that don't need a model", () => {
    expect(validateModels(withNodes(sourceNode("s1")), cfg)).toEqual([]);
  });

  it("passes when the agent has a real, enabled, modality-matching model", () => {
    expect(validateModels(withNodes(agentNode("a1", "agnes-2.0-flash")), cfg)).toEqual([]);
  });

  it("errors when the agent's model is empty", () => {
    const r = validateModels(withNodes(agentNode("a1", "")), cfg);
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("error");
    expect(r[0]!.message).toMatch(/还未配置.*文本.*模型/);
    expect(r[0]!.nodeId).toBe("a1");
  });

  it("errors when the model isn't registered in any provider", () => {
    const r = validateModels(withNodes(agentNode("a1", "ghost-model")), cfg);
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("error");
    expect(r[0]!.message).toMatch(/未在.*模型设置.*中注册/);
  });

  // 下架内置模型 = 把它从 provider 的 models 清单里删掉。此前内置层按
  // `source === "builtin"` 整体豁免注册检查，所以这个动作在派发时毫无反应：
  // 钉着旧名字的产线照样放行，错误只剩上游一句看不懂的拒绝。上面那条
  // ghost-model 用例挡不住这个回归——它的 fixture 根本没有 source 字段。
  it("errors when a built-in model is retired from the catalog", () => {
    const hosted: AppConfig = {
      ...cfg,
      providers: {
        ...cfg.providers,
        agnes: { ...cfg.providers.agnes!, source: "builtin" },
      },
      defaultProvider: "agnes",
      defaultModel: "agnes-2.0-flash",
    };
    // 目录里还在 → 通过；删掉名字（下架）→ 必须报 error。
    expect(validateModels(withNodes(agentNode("a1", "agnes-2.0-flash")), hosted)).toEqual([]);
    const retired: AppConfig = {
      ...hosted,
      providers: {
        ...hosted.providers,
        agnes: { ...hosted.providers.agnes!, models: [], modalities: {} },
      },
    };
    const r = validateModels(withNodes(agentNode("a1", "agnes-2.0-flash")), retired);
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("error");
    expect(r[0]!.message).toMatch(/已不可用/);
    expect(r[0]!.nodeId).toBe("a1");
    // 旧判据复现（不是臆造）：同一个输入在修复前会怎么走。
    // providerForModel 对未认领的模型回落到 defaultProvider，所以
    // isBuiltin 为真、isRegistered 为假 —— `!isBuiltin && !isRegistered`
    // 因此不成立，豁免生效、一条 error 都不产生。
    const old = providerForModel(retired, "agnes-2.0-flash");
    expect(old.provider.source).toBe("builtin");
    expect(old.provider.models.includes("agnes-2.0-flash")).toBe(false);
    expect(old.matched).toBe(false);
  });

  it("errors when the owning provider is disabled", () => {
    const r = validateModels(withNodes(agentNode("a1", "disabled-1")), cfg);
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("error");
    expect(r[0]!.message).toMatch(/Provider.*disabled.*已停用/);
  });

  it("warns when a textGen model modality doesn't match the node", () => {
    const r = validateModels(withNodes(agentNode("a1", "agnes-image")), cfg);
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("warning");
    expect(r[0]!.message).toMatch(/图片.*与该节点期望的.*文本/);
  });

  it("errors when an imageGen node is given a text model (would soft-skip silently)", () => {
    const r = validateModels(withNodes(imageNode("i1", "agnes-2.0-flash")), cfg);
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("error");
    expect(r[0]!.message).toMatch(/文本.*无法产出图片/);
    expect(r[0]!.nodeId).toBe("i1");
  });

  it("rejects empty imageGen model the same way", () => {
    const r = validateModels(withNodes(imageNode("i1", "")), cfg);
    expect(r[0]!.message).toMatch(/图片.*模型/);
  });

  it("passes when audioGen uses a registered audio-modality model", () => {
    expect(validateModels(withNodes(audioNode("v1", "sf-tts")), cfg)).toEqual([]);
  });

  it("errors when an audioGen node is given a text model (TTS would 404/soft-skip)", () => {
    const r = validateModels(withNodes(audioNode("v1", "agnes-2.0-flash")), cfg);
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("error");
    expect(r[0]!.message).toMatch(/文本.*无法产出音频/);
    expect(r[0]!.nodeId).toBe("v1");
  });

  it("rejects empty audioGen model the same way", () => {
    const r = validateModels(withNodes(audioNode("v1", "")), cfg);
    expect(r[0]!.severity).toBe("error");
    expect(r[0]!.message).toMatch(/音频.*模型/);
  });
});
