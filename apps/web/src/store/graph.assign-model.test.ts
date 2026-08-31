import { describe, expect, it, vi } from "vitest";

function setup(opts?: {
  providers?: Record<string, any>;
  defaultModel?: string;
  defaultProvider?: string;
}) {
  vi.resetModules();
  vi.doMock("../lib/api", () => ({
    api: {
      getSettings: () =>
        Promise.resolve({
          providers: opts?.providers ?? {},
          defaultModel: opts?.defaultModel ?? "txt-1",
          defaultProvider: opts?.defaultProvider ?? "p1",
        }),
      saveGraph: () => Promise.resolve({ ok: true }),
    },
  }));
  return import("./graph");
}

function textNode(id: string, model: string, extra?: Record<string, unknown>) {
  return {
    id,
    kind: "textGen",
    name: id,
    x: 0,
    y: 0,
    textGen: { model, prompt: "p", temperature: 0.7, ...extra },
  };
}

describe("assignModel", () => {
  it("rewrites only the model field and only for the given ids", async () => {
    const { useGraph } = await setup();
    const g = useGraph.getState();
    useGraph.setState({
      graph: {
        ...g.graph,
        nodes: [
          textNode("a", "old-model", { skills: ["s1"] }),
          textNode("b", "old-model"),
          textNode("c", "keep-model"),
        ] as any,
      },
    });

    const changed = useGraph.getState().assignModel(["a", "b"], "new-model");
    expect(changed).toBe(2);
    const nodes = useGraph.getState().graph.nodes as any[];
    expect(nodes[0].textGen.model).toBe("new-model");
    // Other sub-config fields are untouched.
    expect(nodes[0].textGen.skills).toEqual(["s1"]);
    expect(nodes[0].textGen.prompt).toBe("p");
    expect(nodes[1].textGen.model).toBe("new-model");
    // Unselected node unchanged.
    expect(nodes[2].textGen.model).toBe("keep-model");
  });

  it("returns 0 and keeps the graph when nothing actually changes", async () => {
    const { useGraph } = await setup();
    const g = useGraph.getState();
    useGraph.setState({
      graph: { ...g.graph, nodes: [textNode("a", "same-model")] as any },
    });
    const before = useGraph.getState().graph;
    expect(useGraph.getState().assignModel(["a"], "same-model")).toBe(0);
    expect(useGraph.getState().graph).toBe(before);
    expect(useGraph.getState().assignModel([], "x")).toBe(0);
    expect(useGraph.getState().assignModel(["a"], "  ")).toBe(0);
  });

  it("writes imageGen/videoGen/audioGen sub-configs and skips non-AI kinds", async () => {
    const { useGraph } = await setup();
    const g = useGraph.getState();
    useGraph.setState({
      graph: {
        ...g.graph,
        nodes: [
          { id: "img", kind: "imageGen", name: "img", x: 0, y: 0, imageGen: { model: "i-old", prompt: "p", n: 2 } },
          { id: "vid", kind: "videoGen", name: "vid", x: 0, y: 0, videoGen: { model: "v-old", prompt: "p", n: 1 } },
          { id: "aud", kind: "audioGen", name: "aud", x: 0, y: 0, audioGen: { model: "a-old", prompt: "p", n: 1 } },
          { id: "code", kind: "code", name: "code", x: 0, y: 0, code: { language: "javascript", code: "" } },
        ] as any,
      },
    });

    const changed = useGraph.getState().assignModel(
      ["img", "vid", "aud", "code"],
      "new-model",
    );
    expect(changed).toBe(3);
    const nodes = useGraph.getState().graph.nodes as any[];
    expect(nodes[0].imageGen.model).toBe("new-model");
    expect(nodes[0].imageGen.n).toBe(2);
    expect(nodes[1].videoGen.model).toBe("new-model");
    expect(nodes[2].audioGen.model).toBe("new-model");
    // Non-AI node untouched (no model field to write).
    expect(nodes[3].code.language).toBe("javascript");
  });

  it("is undoable as a single step", async () => {
    const { useGraph } = await setup();
    const g = useGraph.getState();
    useGraph.setState({
      graph: { ...g.graph, nodes: [textNode("a", "old-model")] as any },
    });
    useGraph.getState().assignModel(["a"], "new-model");
    expect((useGraph.getState().graph.nodes[0] as any).textGen.model).toBe("new-model");
    useGraph.getState().undo();
    expect((useGraph.getState().graph.nodes[0] as any).textGen.model).toBe("old-model");
  });
});
