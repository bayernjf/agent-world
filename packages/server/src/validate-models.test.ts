import { describe, expect, it } from "vitest";
import type { AppConfig, Graph } from "@agent-world/core";
import { validateModels } from "./validate-models.js";

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
    demo: { type: "fake", enabled: true, models: ["demo-chat"], modalities: { "demo-chat": "text" } },
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
  kind: "agent" as const,
  name: `agent-${id}`,
  x: 0,
  y: 0,
  agent: { model, prompt: "" },
});
const imageNode = (id: string, model: string) => ({
  id,
  kind: "imageGen" as const,
  name: `image-${id}`,
  x: 0,
  y: 0,
  imageGen: { model, n: 1 },
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

  it("errors when the owning provider is disabled", () => {
    const r = validateModels(withNodes(agentNode("a1", "disabled-1")), cfg);
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("error");
    expect(r[0]!.message).toMatch(/Provider.*disabled.*已停用/);
  });

  it("warns when the model modality doesn't match the node", () => {
    const r = validateModels(withNodes(agentNode("a1", "agnes-image")), cfg);
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("warning");
    expect(r[0]!.message).toMatch(/图片.*与该节点期望的.*文本/);
  });

  it("accepts the built-in demo provider (fake worker)", () => {
    expect(validateModels(withNodes(agentNode("a1", "demo-chat")), cfg)).toEqual([]);
  });

  it("rejects empty imageGen model the same way", () => {
    const r = validateModels(withNodes(imageNode("i1", "")), cfg);
    expect(r[0]!.message).toMatch(/图片.*模型/);
  });
});
