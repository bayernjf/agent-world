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
    expect(errors(g)).toContain("A rework line must run back to a plant upstream of the start node");
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
    expect(errors(g)).toContain("A rework line can only start from a gate or an agent node");
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

  // F1: fanout / select structural validation.
  const fanoutGraph = (): Graph => ({
    id: "g2",
    name: "variants",
    nodes: [
      node("intake", "source"),
      node("split", "fanout", { fanout: { count: 3, strategy: "prompt" } }),
      node("forge", "textGen", { textGen: { model: "m", prompt: "p" } }),
      node("pick", "select", { select: { mode: "llm_score", topK: 1 } }),
      node("depot", "sink"),
    ],
    edges: [
      edge("e1", "intake", "split"),
      edge("e2", "split", "forge"),
      edge("e3", "forge", "pick"),
      edge("e4", "pick", "depot"),
    ],
  });

  it("accepts a fanout that reconverges at a select", () => {
    const { plan, diagnostics } = compile(fanoutGraph());
    expect(diagnostics).toEqual([]);
    expect(plan?.order).toEqual(["intake", "split", "forge", "pick", "depot"]);
  });

  it("rejects a fanout whose lanes never reach a select", () => {
    const g = fanoutGraph();
    g.nodes = g.nodes.filter((n) => n.kind !== "select");
    g.edges = g.edges.filter((e) => e.to !== "pick");
    g.edges = [...g.edges, edge("e4", "forge", "depot")];
    expect(errors(g)).toContain("扇出节点 \"SPLIT\" 的每条支路都必须最终汇入一个择优节点");
  });

  it("rejects a select with no fanout upstream", () => {
    const g = fanoutGraph();
    g.nodes = g.nodes.filter((n) => n.kind !== "fanout");
    g.edges = g.edges.filter((e) => e.from !== "split");
    g.edges = [...g.edges, edge("e1", "intake", "forge")];
    expect(errors(g)).toContain("择优节点 \"PICK\" 缺少上游的扇出节点");
  });

  // L26: non-destructive trigger config warnings (never block load/run).
  const warnings = (g: Graph) =>
    compile(g).diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

  it("warns on a cron trigger missing its expression but still compiles", () => {
    const g = baseline();
    g.triggers = [{ id: "t1", type: "cron", enabled: true }];
    const { plan, diagnostics } = compile(g);
    expect(plan).not.toBeNull();
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
    expect(warnings(g).join("\n")).toContain("cron");
  });

  it("warns on a webhook trigger missing its shared secret", () => {
    const g = baseline();
    g.triggers = [{ id: "t2", type: "webhook", enabled: true }];
    expect(warnings(g).join("\n")).toContain("密钥");
  });

  it("warns on an event trigger missing its event source", () => {
    const g = baseline();
    g.triggers = [{ id: "t3", type: "event", enabled: true }];
    expect(warnings(g).join("\n")).toContain("事件来源");
  });

  it("warns on a batch trigger missing its batch source", () => {
    const g = baseline();
    g.triggers = [{ id: "t4", type: "batch", enabled: true }];
    expect(warnings(g).join("\n")).toContain("批量数据源");
  });

  it("accepts a fully configured cron trigger without warnings", () => {
    const g = baseline();
    g.triggers = [{ id: "t5", type: "cron", cron: "0 9 * * *", enabled: true }];
    const { diagnostics } = compile(g);
    expect(diagnostics).toEqual([]);
  });

  // State-machine-as-variables: branch routing compile-time guardrails.
  const stateGraph = (): Graph => ({
    id: "sm",
    name: "orders",
    variables: { orderState: "pending" },
    nodes: [
      node("intake", "source"),
      node("decide", "branch", {
        branch: {
          rules: [{ id: "paid", when: "${var.orderState} == 'paid'", target: "ship" }],
          defaultTarget: "hold",
        },
      }),
      node("ship", "sink"),
      node("hold", "sink"),
    ],
    edges: [
      edge("e1", "intake", "decide"),
      edge("e2", "decide", "ship"),
      edge("e3", "decide", "hold"),
    ],
  });

  it("accepts a branch state machine with declared state and wired targets", () => {
    const { plan, diagnostics } = compile(stateGraph());
    expect(plan).not.toBeNull();
    expect(diagnostics).toEqual([]);
  });

  it("flags a branch rule targeting a missing plant", () => {
    const g = stateGraph();
    const decide = g.nodes[1] as GraphNode & { branch: { rules: { target: string }[] } };
    decide.branch.rules[0]!.target = "ghost";
    expect(errors(g).join("\n")).toContain("不存在的节点");
  });

  it("flags an illegal transition: target exists but has no flow edge", () => {
    const g = stateGraph();
    g.nodes.push(node("orphan", "sink"));
    const decide = g.nodes[1] as GraphNode & { branch: { rules: { target: string }[] } };
    decide.branch.rules[0]!.target = "orphan";
    expect(errors(g).join("\n")).toContain("非法迁移");
  });

  it("flags a default target with no connecting flow edge", () => {
    const g = stateGraph();
    g.nodes.push(node("orphan", "sink"));
    const decide = g.nodes[1] as GraphNode & { branch: { defaultTarget: string } };
    decide.branch.defaultTarget = "orphan";
    expect(errors(g).join("\n")).toContain("非法迁移");
  });

  it("warns on a malformed branch condition that would never match", () => {
    const g = stateGraph();
    const decide = g.nodes[1] as GraphNode & { branch: { rules: { when: string }[] } };
    decide.branch.rules[0]!.when = "${var.orderState} == 'paid' garbage";
    expect(warnings(g).join("\n")).toContain("永不命中");
  });

  it("warns when a branch condition reads an undeclared state variable", () => {
    const g = stateGraph();
    delete g.variables;
    expect(warnings(g).join("\n")).toContain("未在图变量中声明");
  });

  it("stays silent on the state variable when it is declared", () => {
    const g = stateGraph();
    expect(warnings(g).some((m) => m.includes("未在图变量中声明"))).toBe(false);
  });
});
