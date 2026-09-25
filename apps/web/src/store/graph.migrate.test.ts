import { describe, expect, it, vi } from "vitest";
import type { Graph } from "@agent-world/core";

function setup(opts: {
  providers: Record<string, unknown>;
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
      saveGraph: () => Promise.resolve({ ok: true, version: 1 }),
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

const imageNode = (model: string) => ({
  id: "i1",
  kind: "imageGen" as const,
  name: "image-i1",
  x: 0,
  y: 0,
  imageGen: { model, n: 1 },
});

// 曾经有一个"打开产线时自动改模型并存盘"的迁移。它现在是错的，而且错得危险：
// 「空」是"跟随当前默认"的槽位（规则 B），改写等于替用户把型号钉死；
// "已下架的钉名"应该报错让用户自己重选（规则 A），静默改绑下一个可用模型掩盖了
// 这件事；而自动存盘会把版本快照和 contentHash 一起搅乱（#53 零配置首跑 422 就是
// 它造成的）。这里的断言就是"什么都不改、什么都不存"。
describe("setGraph never touches model fields", () => {
  it("keeps a legacy placeholder model verbatim", async () => {
    const { useGraph, refreshDefaultModel } = await setup(agnesConfig);
    await refreshDefaultModel();
    useGraph.getState().setGraph(mkGraph(imageNode("agnes-image")));
    expect(useGraph.getState().graph.nodes[0]!.imageGen?.model).toBe("agnes-image");
  });

  it("keeps a retired model verbatim so dispatch can refuse the run", async () => {
    const { useGraph, refreshDefaultModel } = await setup(agnesConfig);
    await refreshDefaultModel();
    useGraph.getState().setGraph(mkGraph(imageNode("agnes-image-1.0-old")));
    expect(useGraph.getState().graph.nodes[0]!.imageGen?.model).toBe("agnes-image-1.0-old");
  });

  it("keeps an empty follow-default slot empty", async () => {
    const { useGraph, refreshDefaultModel } = await setup(agnesConfig);
    await refreshDefaultModel();
    useGraph.getState().setGraph(mkGraph(imageNode("")));
    expect(useGraph.getState().graph.nodes[0]!.imageGen?.model).toBe("");
  });

  it("schedules no save on load (no silent version churn)", async () => {
    const { useGraph } = await setup(agnesConfig);
    useGraph.getState().setGraph(mkGraph(imageNode("agnes-image"), imageNode("")));
    // scheduleSave 会立刻把 saveState 打到 "saving"；没被调用就还是 "idle"。
    expect(useGraph.getState().saveState).toBe("idle");
    await new Promise((r) => setTimeout(r, 10));
    expect(useGraph.getState().saveState).toBe("idle");
  });

  it("survives the settings race without wiping or saving", async () => {
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
      useGraph.getState().setGraph(mkGraph(imageNode("agnes-2.0-flash"), imageNode("")));
      expect(useGraph.getState().graph.nodes[0]!.imageGen?.model).toBe("agnes-2.0-flash");
      expect(useGraph.getState().graph.nodes[1]!.imageGen?.model).toBe("");
      expect(useGraph.getState().saveState).toBe("idle");
    } finally {
      resolveSettings?.(agnesConfig);
      await new Promise((r) => setTimeout(r, 0));
    }
    // 选项迟到之后同样不改写：这条曾经会"补跑一次迁移"，现在什么都不会发生。
    expect(useGraph.getState().graph.nodes[0]!.imageGen?.model).toBe("agnes-2.0-flash");
    expect(useGraph.getState().graph.nodes[1]!.imageGen?.model).toBe("");
    expect(useGraph.getState().saveState).toBe("idle");
  });
});

// defaultModelFor 现在只有一个用途：给空槽的界面文案回答"这个槽会跟到哪个模型"。
describe("defaultModelFor answers 'what would an empty slot follow'", () => {
  it("prefers the user's default when its modality fits", async () => {
    const { defaultModelFor, refreshDefaultModel } = await setup(agnesConfig);
    await refreshDefaultModel();
    expect(defaultModelFor("textGen")?.model).toBe("agnes-2.5-flash");
  });

  it("ignores a default of the wrong modality and picks per modality instead", async () => {
    // 用户的默认是一张图片模型：文本槽不能跟到它身上，各模态各挑各的第一个。
    const { defaultModelFor, refreshDefaultModel } = await setup({
      ...agnesConfig,
      defaultModel: "agnes-image-2.0-flash",
    });
    await refreshDefaultModel();
    expect(defaultModelFor("textGen")?.model).toBe("agnes-2.5-flash");
    expect(defaultModelFor("imageGen")?.model).toBe("agnes-image-2.0-flash");
    expect(defaultModelFor("videoGen")?.model).toBe("agnes-video-v2.0");
  });

  it("returns null when the modality has nothing to offer", async () => {
    const { defaultModelFor, refreshDefaultModel } = await setup({
      providers: {},
      defaultModel: "txt-1",
      defaultProvider: "p1",
    });
    await refreshDefaultModel();
    expect(defaultModelFor("audioGen")).toBeNull();
  });
});

describe("addNode seeds an empty slot", () => {
  it("creates the node with a follow-default slot, not a pinned model", async () => {
    const { useGraph, refreshDefaultModel } = await setup(agnesConfig);
    await refreshDefaultModel();
    useGraph.getState().setGraph(mkGraph());
    const res = useGraph.getState().addNode("textGen", 0, 0);
    const node = useGraph.getState().graph.nodes.find((n) => n.id === res.id);
    expect(node?.textGen?.model).toBe("");
    // 有可跟随的默认 → 不该报缺模型。
    expect(res.missingModality).toBeNull();
  });

  it("still reports the missing modality when nothing exists for it", async () => {
    const { useGraph, refreshDefaultModel } = await setup({
      providers: {},
      defaultModel: "txt-1",
      defaultProvider: "p1",
    });
    await refreshDefaultModel();
    useGraph.getState().setGraph(mkGraph());
    const res = useGraph.getState().addNode("audioGen", 0, 0);
    expect(res.missingModality).toBe("audio");
    expect(useGraph.getState().graph.nodes.find((n) => n.id === res.id)?.audioGen?.model).toBe("");
  });
});
