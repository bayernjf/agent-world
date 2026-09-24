import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    getSettings: () =>
      Promise.resolve({ providers: {}, defaultModel: undefined, defaultProvider: undefined }),
    saveGraph: () => Promise.resolve({ ok: true, version: 1 }),
  },
  GraphConflictError: class GraphConflictError extends Error {},
}));

async function seed(nodes: unknown[], edges: unknown[]) {
  const { useGraph } = await import("./graph");
  useGraph.getState().setGraph({
    id: "g-edges",
    name: "Edges",
    nodes,
    edges,
    version: 1,
  } as never);
  return useGraph;
}

const node = (id: string, x: number, y: number) => ({
  id,
  kind: "textGen",
  name: `TEXTGEN-${id.slice(-4)}`,
  x,
  y,
  textGen: { prompt: "写一段", model: "" },
});

describe("graph addEdge rejections", () => {
  it("refuses a self-loop and says so in the reason", async () => {
    const useGraph = await seed([node("t1", 0, 0)], []);

    const r = useGraph.getState().addEdge("t1", "t1", "flow");

    expect(r).toEqual({ ok: false, reason: "不能连接到自身" });
    expect(useGraph.getState().graph.edges).toHaveLength(0);
  });

  it("refuses a duplicate pipe even when the new edge has another kind", async () => {
    const useGraph = await seed(
      [node("t1", 0, 0), node("t2", 100, 0)],
      [{ id: "e1", from: "t1", to: "t2", kind: "flow" }],
    );

    const r = useGraph.getState().addEdge("t1", "t2", "error");

    expect(r).toEqual({ ok: false, reason: "这条管道已经存在" });
    expect(useGraph.getState().graph.edges).toHaveLength(1);
    expect(useGraph.getState().graph.edges[0]?.kind).toBe("flow");
  });

  it("accepts a new pipe and gives it a fresh id", async () => {
    const useGraph = await seed(
      [node("t1", 0, 0), node("t2", 100, 0)],
      [{ id: "e1", from: "t1", to: "t2", kind: "flow" }],
    );

    const r = useGraph.getState().addEdge("t2", "t1", "error");

    expect(r.ok).toBe(true);
    const edges = useGraph.getState().graph.edges;
    expect(edges).toHaveLength(2);
    expect(edges[1]).toMatchObject({ from: "t2", to: "t1", kind: "error" });
    expect(edges[1]?.id).not.toBe("e1");
  });
});

describe("graph duplicateNode", () => {
  it("copies the config, suffixes the name and snaps the offset onto the grid", async () => {
    const useGraph = await seed([node("t1", 100, 100)], []);

    const newId = useGraph.getState().duplicateNode("t1", 40, 60);

    expect(newId).toBeTruthy();
    const { graph, selectedId, selectedNodeIds } = useGraph.getState();
    expect(graph.nodes).toHaveLength(2);
    const copy = graph.nodes.find((n) => n.id === newId);
    expect(copy).toMatchObject({
      kind: "textGen",
      name: "TEXTGEN-t1 副本",
      x: 140,
      y: 160,
      textGen: { prompt: "写一段", model: "" },
    });
    expect(selectedId).toBe(newId);
    expect(selectedNodeIds).toEqual([newId]);
  });

  it("leaves the source node untouched", async () => {
    const useGraph = await seed([node("t1", 100, 100)], []);

    useGraph.getState().duplicateNode("t1", 40, 60);

    expect(useGraph.getState().graph.nodes[0]).toMatchObject({
      id: "t1",
      name: "TEXTGEN-t1",
      x: 100,
      y: 100,
    });
  });

  it("returns null for a node that is not in the graph", async () => {
    const useGraph = await seed([node("t1", 0, 0)], []);

    expect(useGraph.getState().duplicateNode("nope")).toBeNull();
    expect(useGraph.getState().graph.nodes).toHaveLength(1);
  });
});
