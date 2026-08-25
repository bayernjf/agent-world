import { describe, expect, it } from "vitest";
import { compile } from "./compile.js";
import type { Graph, GraphEdge, GraphNode, NodeKind } from "./graph.js";

const node = (id: string, kind: NodeKind, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  kind,
  name: id.toUpperCase(),
  x: 0,
  y: 0,
  ...extra,
});

const edge = (id: string, from: string, to: string, kind: GraphEdge["kind"] = "flow"): GraphEdge => ({
  id,
  from,
  to,
  kind,
});

/** intake -> forge -> critic -> depot, with a rework line from the gate back to forge. */
function baseline(): Graph {
  return {
    id: "g1",
    name: "line",
    nodes: [
      node("intake", "source"),
      node("forge", "agent"),
      node("critic", "gate", { gate: { maxAttempts: 3, criterion: "", onExhausted: "halt" } }),
      node("depot", "sink"),
    ],
    edges: [
      edge("e1", "intake", "forge"),
      edge("e2", "forge", "critic"),
      edge("e3", "critic", "depot"),
      edge("r1", "critic", "forge", "rework"),
    ],
  };
}

const errors = (g: Graph) =>
  compile(g).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("compile", () => {
  it("accepts a gate whose rework line runs back upstream", () => {
    const { plan, diagnostics } = compile(baseline());
    expect(diagnostics).toEqual([]);
    expect(plan?.order).toEqual(["intake", "forge", "critic", "depot"]);
    expect(plan?.loops).toHaveLength(1);
    expect(plan?.loops[0]?.body).toEqual(["forge", "critic"]);
    expect(plan?.loops[0]?.maxAttempts).toBe(3);
  });

  it("rejects a rework line pointing downstream of the gate", () => {
    const g = baseline();
    g.edges = [...g.edges.slice(0, 3), edge("r1", "critic", "depot", "rework")];
    expect(compile(g).plan).toBeNull();
    expect(errors(g)).toContain("A rework line must run back to a plant upstream of the gate");
  });

  it("rejects a cycle made of flow pipes", () => {
    const g = baseline();
    g.edges = [...g.edges, edge("c1", "depot", "intake")];
    expect(compile(g).plan).toBeNull();
    expect(errors(g)[0]).toContain("正向管道形成了环");
    expect(errors(g)[0]).toMatch(/DEPOT → INTAKE/);
  });

  it("rejects a rework line that does not start at a gate", () => {
    const g = baseline();
    g.edges = [...g.edges.slice(0, 3), edge("r1", "depot", "forge", "rework")];
    expect(compile(g).plan).toBeNull();
    expect(errors(g)).toContain("Only a gate can start a rework line");
  });

  it("warns when a gate has no rework line", () => {
    const g = baseline();
    g.edges = g.edges.filter((e) => e.kind !== "rework");
    const { plan, diagnostics } = compile(g);
    expect(plan).not.toBeNull();
    expect(diagnostics.some((d) => d.severity === "warning" && /rework/.test(d.message))).toBe(true);
  });

  it("requires an intake", () => {
    const g = baseline();
    g.nodes = g.nodes.filter((n) => n.kind !== "source");
    g.edges = g.edges.filter((e) => e.from !== "intake");
    expect(errors(g)).toContain("The line needs an intake");
  });

  it("rejects a self-feeding plant", () => {
    const g = baseline();
    g.edges = [...g.edges, edge("s1", "forge", "forge")];
    expect(errors(g)).toContain("A plant cannot feed itself");
  });
});
