import { describe, expect, it, vi } from "vitest";

function setup(opts: {
  providers: Record<string, any>;
  defaultModel: string;
  defaultProvider: string;
}) {
  vi.resetModules();
  vi.doMock("../lib/api", () => ({
    api: {
      getSettings: () =>
        Promise.resolve({
          providers: opts.providers,
          defaultModel: opts.defaultModel,
          defaultProvider: opts.defaultProvider,
        }),
      saveGraph: () => Promise.resolve({ ok: true }),
    },
  }));
  // re-import the store so the new mock is picked up
  return import("./graph");
}

// 规则 B（docs/design-model-catalog.md）之后，新建节点不再被写进一个具体模型：
// 节点带的是空槽，派发时由服务端解析成"该模态的当前默认"。defaultModelFor 仍然
// 存在，但只剩两个用途——给界面回答"这个空槽会跟到谁"，以及探针判断"这个模态
// 到底有没有模型可跟"。下面断言的就是这两件事。
describe("addNode: the empty slot and what it would follow", () => {
  it("picks a text model for agent nodes", async () => {
    const { useGraph, defaultModelFor, refreshDefaultModel } = await setup({
      providers: {
        p1: {
          type: "openai-compatible",
          enabled: true,
          models: ["txt-1", "img-1"],
          modalities: { "txt-1": "text", "img-1": "image" },
        },
      },
      defaultModel: "txt-1",
      defaultProvider: "p1",
    });
    await refreshDefaultModel();
    const r = useGraph.getState().addNode("textGen", 10, 10);
    expect(r.missingModality).toBeNull();
    const node = useGraph.getState().graph.nodes.find((n) => n.id === r.id);
    // 节点里存的是空槽（派发时服务端解析），具体跟到哪个模型由 defaultModelFor 回答。
    expect(node?.textGen?.model).toBe("");
    expect(defaultModelFor("textGen")?.model).toBe("txt-1");
  });

  it("picks the first enabled image model for imageGen", async () => {
    const { useGraph, defaultModelFor, refreshDefaultModel } = await setup({
      providers: {
        p1: {
          type: "openai-compatible",
          enabled: true,
          models: ["txt-1", "img-1", "img-2"],
          modalities: { "txt-1": "text", "img-1": "image", "img-2": "image" },
        },
      },
      defaultModel: "txt-1",
      defaultProvider: "p1",
    });
    await refreshDefaultModel();
    const r = useGraph.getState().addNode("imageGen", 10, 10);
    expect(r.missingModality).toBeNull();
    const node = useGraph.getState().graph.nodes.find((n) => n.id === r.id);
    expect(node?.imageGen?.model).toBe("");
    expect(defaultModelFor("imageGen")?.model).toBe("img-1");
  });

  it("returns missingModality when no model matches; the node is still added with an empty model", async () => {
    const { useGraph, defaultModelFor, refreshDefaultModel } = await setup({
      providers: {
        p1: {
          type: "openai-compatible",
          enabled: true,
          models: ["txt-1"],
          modalities: { "txt-1": "text" },
        },
      },
      defaultModel: "txt-1",
      defaultProvider: "p1",
    });
    await refreshDefaultModel();
    const r = useGraph.getState().addNode("videoGen", 10, 10);
    expect(r.missingModality).toBe("video");
    const node = useGraph.getState().graph.nodes.find((n) => n.id === r.id);
    expect(node).toBeDefined();
    // 该模态没有任何可跟随的模型：槽位保持空，missingModality 让调用方给出
    // "先去模型设置里添加"的提示，派发侧也会拒绝这条 run。
    expect(node?.videoGen?.model).toBe("");
  });

  it("skips disabled providers when looking for a default", async () => {
    const { useGraph, defaultModelFor, refreshDefaultModel } = await setup({
      providers: {
        on: {
          type: "openai-compatible",
          enabled: true,
          models: ["img-A"],
          modalities: { "img-A": "image" },
        },
        off: {
          type: "openai-compatible",
          enabled: false,
          models: ["img-B"],
          modalities: { "img-B": "image" },
        },
      },
      defaultModel: "txt-1",
      defaultProvider: "on",
    });
    await refreshDefaultModel();
    const r = useGraph.getState().addNode("imageGen", 10, 10);
    expect(r.missingModality).toBeNull();
    const node = useGraph.getState().graph.nodes.find((n) => n.id === r.id);
    expect(node?.imageGen?.model).toBe("");
    expect(defaultModelFor("imageGen")?.model).toBe("img-A");
  });

  it("source/sink/gate need no model", async () => {
    const { useGraph } = await setup({
      providers: {},
      defaultModel: "txt-1",
      defaultProvider: "p1",
    });
    // These kinds return missingModality=null (no model required) regardless of config.
    expect(useGraph.getState().addNode("source", 0, 0).missingModality).toBeNull();
    expect(useGraph.getState().addNode("gate", 0, 0).missingModality).toBeNull();
    expect(useGraph.getState().addNode("sink", 0, 0).missingModality).toBeNull();
  });
});

  it("prefers a real provider over a legacy demo provider when both match the modality", async () => {
    const { useGraph, defaultModelFor, refreshDefaultModel } = await setup({
      providers: {
        // A legacy config may still carry the removed demo provider.
        demo: { type: "fake", enabled: true, models: ["demo-image"], modalities: { "demo-image": "image" } },
        real: {
          type: "openai-compatible",
          enabled: true,
          models: ["real-image-1", "real-image-2"],
          modalities: { "real-image-1": "image", "real-image-2": "image" },
        },
      },
      // User's default is a text model on the real provider so the
      // imageGen fallback path runs.
      defaultModel: "real-text",
      defaultProvider: "real",
    });
    await refreshDefaultModel();
    const r = useGraph.getState().addNode("imageGen", 10, 10);
    expect(r.missingModality).toBeNull();
    const node = useGraph.getState().graph.nodes.find((n) => n.id === r.id);
    // Real provider wins over the legacy demo fallback.
    expect(node?.imageGen?.model).toBe("");
    expect(defaultModelFor("imageGen")?.model).toBe("real-image-1");
  });
