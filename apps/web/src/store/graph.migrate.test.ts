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
        kind: "textGen",
        name: "agent-a1",
        x: 0,
        y: 0,
        textGen: { model: "", prompt: "", skills: [], temperature: 0.7, timeoutMs: 120000, inputPolicy: { mode: "all" }, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 } },
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
    expect(agent?.textGen?.model).toBe("agnes-2.5-flash");
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

  it("keeps a valid built-in model when model options have not loaded yet (demo zero-config race)", async () => {
    // Settings request stays pending: the module-level refresh is in flight, so
    // modelOptionsReady is false and the option list is empty. setGraph must not
    // wipe a non-empty model it cannot yet prove unknown. Regression for the
    // demo's first-run 422 "graph has unconfigured model(s)".
    let resolveSettings: ((cfg: unknown) => void) | null = null;
    const settingsPromise = new Promise((res) => {
      resolveSettings = res as (cfg: unknown) => void;
    });
    vi.resetModules();
    vi.doMock("../lib/api", () => ({
      api: {
        getSettings: () => settingsPromise,
        saveGraph: () => Promise.resolve({ ok: true, version: 1 }),
      },
    }));
    const { useGraph } = await import("./graph");
    try {
      const g = mkGraph({
        id: "d1",
        kind: "textGen",
        name: "draft",
        x: 0,
        y: 0,
        textGen: { model: "agnes-2.0-flash", prompt: "p", skills: [], temperature: 0.7, timeoutMs: 60000 },
      });
      useGraph.getState().setGraph(g);
      const node = useGraph.getState().graph.nodes[0]!;
      expect(node.textGen?.model).toBe("agnes-2.0-flash");
    } finally {
      resolveSettings?.(agnesConfig);
      await new Promise((r) => setTimeout(r, 0));
    }
  });

  it("keeps a built-in model when settings fetch rejects unauthenticated (login-screen 401 race)", async () => {
    // The module-level refresh fires on the login screen while unauthenticated:
    // getSettings() rejects (401). Old code still set modelOptionsReady=true with
    // an empty list, so the first post-login graph load judged a valid built-in
    // model unknown and wiped it (demo zero-config 422). Now a rejected fetch
    // leaves ready=false and the list empty, so a non-empty model is preserved.
    vi.resetModules();
    vi.doMock("../lib/api", () => ({
      api: {
        getSettings: () => Promise.reject(new Error("401 Unauthorized")),
        saveGraph: () => Promise.resolve({ ok: true, version: 1 }),
      },
    }));
    const { useGraph } = await import("./graph");
    const g = mkGraph({
      id: "d1",
      kind: "textGen",
      name: "draft",
      x: 0,
      y: 0,
      textGen: { model: "agnes-2.0-flash", prompt: "p", skills: [], temperature: 0.7, timeoutMs: 60000 },
    });
    useGraph.getState().setGraph(g);
    const node = useGraph.getState().graph.nodes[0]!;
    expect(node.textGen?.model).toBe("agnes-2.0-flash");
  });

  it("defers placeholder migration until options load, then corrects it", async () => {
    // Same cold start: a legacy placeholder is left untouched while options are
    // unavailable; once settings resolve, the deferred migration replaces it.
    let resolveSettings: ((cfg: unknown) => void) | null = null;
    const settingsPromise = new Promise((res) => {
      resolveSettings = res as (cfg: unknown) => void;
    });
    vi.resetModules();
    vi.doMock("../lib/api", () => ({
      api: {
        getSettings: () => settingsPromise,
        saveGraph: () => Promise.resolve({ ok: true, version: 1 }),
      },
    }));
    const { useGraph } = await import("./graph");
    const g = mkGraph({
      id: "i1",
      kind: "imageGen",
      name: "image-i1",
      x: 0,
      y: 0,
      imageGen: { model: "agnes-image", n: 1 },
    });
    useGraph.getState().setGraph(g);
    // Not ready yet → placeholder preserved (not wiped to "").
    expect(useGraph.getState().graph.nodes[0]!.imageGen?.model).toBe("agnes-image");
    resolveSettings?.(agnesConfig);
    await new Promise((r) => setTimeout(r, 0));
    // Options arrived → the deferred migration in refreshDefaultModel runs.
    expect(useGraph.getState().graph.nodes[0]!.imageGen?.model).toBe("agnes-image-2.0-flash");
  });
});
