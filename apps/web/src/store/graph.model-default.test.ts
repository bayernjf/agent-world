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

describe("addNode default model selection", () => {
  it("picks a text model for agent nodes", async () => {
    const { useGraph, refreshDefaultModel } = await setup({
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
    const r = useGraph.getState().addNode("agent", 10, 10);
    expect(r.missingModality).toBeNull();
    const node = useGraph.getState().graph.nodes.find((n) => n.id === r.id);
    expect(node?.agent?.model).toBe("txt-1");
  });

  it("picks the first enabled image model for imageGen", async () => {
    const { useGraph, refreshDefaultModel } = await setup({
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
    expect(node?.imageGen?.model).toBe("img-1");
  });

  it("returns missingModality when no model matches; the node is still added with an empty model", async () => {
    const { useGraph, refreshDefaultModel } = await setup({
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
    // The model field is left empty so the Inspector can show "(未配置)" and
    // dispatch can refuse to run. The user fills it in once they configure
    // a provider.
    expect(node?.videoGen?.model).toBe("");
  });

  it("skips disabled providers when looking for a default", async () => {
    const { useGraph, refreshDefaultModel } = await setup({
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
    expect(node?.imageGen?.model).toBe("img-A");
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
