import { describe, expect, it, vi } from "vitest";
import type { Graph } from "@agent-world/core";

function setup(opts: { providers: Record<string, any>; defaultModel: string; defaultProvider: string }) {
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
  return import("./graph");
}

const agnesConfig = {
  providers: {
    agnes: {
      type: "openai-compatible",
      enabled: true,
      models: ["agnes-2.5-flash", "agnes-image-2.0-flash", "agnes-video-v2.0"],
      modalities: {
        "agnes-2.5-flash": "text",
        "agnes-image-2.0-flash": "image",
        "agnes-video-v2.0": "video",
      },
    },
  },
  defaultModel: "agnes-2.5-flash",
  defaultProvider: "agnes",
};

const mkGraph = (...nodes: Graph["nodes"]): Graph => ({
  id: "g",
  name: "test",
  nodes,
  edges: [],
});

describe("migrateGraphModels on setGraph", () => {
  it("re-picks a placeholder model for an imageGen node", async () => {
    const { useGraph, refreshDefaultModel } = await setup(agnesConfig);
    await refreshDefaultModel();
    const g = mkGraph({
      id: "i1",
      kind: "imageGen",
      name: "image-i1",
      x: 0,
      y: 0,
      imageGen: { model: "agnes-image", n: 1 }, // legacy placeholder
    });
    useGraph.getState().setGraph(g);
    const node = useGraph.getState().graph.nodes[0]!;
    expect(node.imageGen?.model).toBe("agnes-image-2.0-flash");
  });

  it("leaves a node's real model untouched", async () => {
    const { useGraph, refreshDefaultModel } = await setup(agnesConfig);
    await refreshDefaultModel();
    const g = mkGraph({
      id: "i1",
      kind: "imageGen",
      name: "image-i1",
      x: 0,
      y: 0,
      imageGen: { model: "agnes-image-2.0-flash", n: 1 },
    });
    useGraph.getState().setGraph(g);
    const node = useGraph.getState().graph.nodes[0]!;
    expect(node.imageGen?.model).toBe("agnes-image-2.0-flash");
  });

  it("clears an unknown model when no real alternative exists", async () => {
    const { useGraph, refreshDefaultModel } = await setup({
      providers: {},
      defaultModel: "txt-1",
      defaultProvider: "p1",
    });
    await refreshDefaultModel();
    const g = mkGraph({
      id: "v1",
      kind: "videoGen",
      name: "video-v1",
      x: 0,
      y: 0,
      videoGen: { model: "video-gen", n: 1 }, // legacy placeholder, no provider
    });
    useGraph.getState().setGraph(g);
    const node = useGraph.getState().graph.nodes[0]!;
    // No video model configured -> setGraph migration leaves it empty so
    // dispatch validation can refuse the run.
    expect(node.videoGen?.model).toBe("");
  });

  it("handles mixed node kinds in one graph", async () => {
    const { useGraph, refreshDefaultModel } = await setup(agnesConfig);
    await refreshDefaultModel();
    const g = mkGraph(
      {
        id: "a1",
        kind: "agent",
        name: "agent-a1",
        x: 0,
        y: 0,
        agent: { model: "", prompt: "", skills: [], temperature: 0.7, timeoutMs: 120000, inputPolicy: { mode: "all" }, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 } },
      },
      {
        id: "i1",
        kind: "imageGen",
        name: "image-i1",
        x: 0,
        y: 0,
        imageGen: { model: "agnes-image", n: 1 },
      },
      {
        id: "v1",
        kind: "videoGen",
        name: "video-v1",
        x: 0,
        y: 0,
        videoGen: { model: "video-gen", n: 1 },
      },
    );
    useGraph.getState().setGraph(g);
    const [agent, image, video] = useGraph.getState().graph.nodes;
    expect(agent?.agent?.model).toBe("agnes-2.5-flash");
    expect(image?.imageGen?.model).toBe("agnes-image-2.0-flash");
    expect(video?.videoGen?.model).toBe("agnes-video-v2.0");
  });

  it("ignores kinds that don't carry a model (source / gate / sink)", async () => {
    const { useGraph, refreshDefaultModel } = await setup(agnesConfig);
    await refreshDefaultModel();
    const g = mkGraph(
      { id: "s1", kind: "source", name: "source-s1", x: 0, y: 0 },
      { id: "g1", kind: "gate", name: "gate-g1", x: 0, y: 0, gate: { maxAttempts: 3, criterion: "", onExhausted: "halt" } },
      { id: "k1", kind: "sink", name: "sink-k1", x: 0, y: 0 },
    );
    useGraph.getState().setGraph(g);
    const [src, gate, sink] = useGraph.getState().graph.nodes;
    expect(src?.kind).toBe("source");
    expect(gate?.gate?.maxAttempts).toBe(3);
    expect(sink?.kind).toBe("sink");
  });
});
