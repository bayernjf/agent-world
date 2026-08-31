import { describe, expect, it } from "vitest";
import { Graph } from "./graph.js";
import { compile } from "./compile.js";

/** intake -> forge -> depot, a minimal valid line. */
const baseGraph = () => ({
  id: "g1",
  name: "line",
  nodes: [
    { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
    { id: "forge", kind: "textGen", name: "FORGE", x: 1, y: 0 },
    { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
  ],
  edges: [
    { id: "e1", from: "intake", to: "forge", kind: "flow" },
    { id: "e2", from: "forge", to: "depot", kind: "flow" },
  ],
});

describe("graph triggers (4A.1)", () => {
  it("parses a graph with webhook + cron triggers", () => {
    const graph = Graph.parse({
      ...baseGraph(),
      triggers: [
        { id: "t1", type: "webhook", webhookSecret: "s3cr3t", enabled: true },
        { id: "t2", type: "cron", cron: "0 9 * * *" },
        { id: "t3", type: "event", eventSource: { kind: "graph", id: "other" } },
        { id: "t4", type: "batch", batch: { source: "rows", rows: [{ q: "a" }] } },
      ],
    });
    expect(graph.triggers).toHaveLength(4);
    expect(graph.triggers?.[0]!.type).toBe("webhook");
    expect(graph.triggers?.[0]!.enabled).toBe(true);
  });

  it("compiles a graph that carries triggers", () => {
    const result = compile({
      ...baseGraph(),
      triggers: [{ id: "t1", type: "cron", cron: "0 9 * * *" }],
    });
    expect(result.plan).not.toBeNull();
  });

  it("parses a graph with no triggers (backward compatible)", () => {
    const graph = Graph.parse(baseGraph());
    expect(graph.triggers).toBeUndefined();
    expect(compile(baseGraph()).plan).not.toBeNull();
  });

  it("rejects node ids that could escape the artifact store (audit C2)", () => {
    // Node ids are interpolated into artifact keys joined onto a storage base
    // directory — traversal or separator-shaped ids must fail at parse time.
    const evilIds = ["../../evil", "a/b", "..", "a\\b", "x/y/../../z", ".hidden", "а-bc"]; // last: cyrillic а
    for (const id of evilIds) {
      expect(() =>
        Graph.parse({
          ...baseGraph(),
          nodes: [
            { id, kind: "source", name: "INTAKE", x: 0, y: 0 },
            { id: "depot", kind: "sink", name: "DEPOT", x: 1, y: 0 },
          ],
          edges: [],
        }),
      ).toThrow();
    }
    // The shapes every generator actually produces stay valid.
    for (const id of ["n12-ab3f", "intake", "A.b_c-d", "x".repeat(64)]) {
      const g = Graph.parse({ ...baseGraph(), nodes: [{ id, kind: "source", name: "S", x: 0, y: 0 }], edges: [] });
      expect(g.nodes[0]!.id).toBe(id);
    }
    // 65 chars is over the limit.
    expect(() =>
      Graph.parse({
        ...baseGraph(),
        nodes: [{ id: "x".repeat(65), kind: "source", name: "S", x: 0, y: 0 }],
        edges: [],
      }),
    ).toThrow();
  });
});

describe("source connector (4B.1)", () => {
  const connectorGraph = (connector: unknown) => ({
    ...baseGraph(),
    nodes: [
      { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0, source: { connector } },
      { id: "forge", kind: "textGen", name: "FORGE", x: 1, y: 0 },
      { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
    ],
  });

  it("parses file / http / form connectors", () => {
    const file = Graph.parse(connectorGraph({ type: "file", file: { path: "./data/*.txt", asImages: false } }));
    expect(file.nodes[0]!.source?.connector?.type).toBe("file");

    const http = Graph.parse(
      connectorGraph({ type: "http", http: { url: "https://api.example.com/x", method: "GET", extract: ["items.0"] } }),
    );
    expect(http.nodes[0]!.source?.connector?.http?.url).toBe("https://api.example.com/x");

    const form = Graph.parse(
      connectorGraph({ type: "form", form: { fields: [{ name: "name", label: "商品名", required: true }] } }),
    );
    expect(form.nodes[0]!.source?.connector?.form?.fields[0]!.required).toBe(true);
  });

  it("rejects a malformed http url", () => {
    expect(() =>
      Graph.parse(connectorGraph({ type: "http", http: { url: "not-a-url" } })),
    ).toThrow();
  });

  it("parses a source with no connector (backward compatible)", () => {
    const graph = Graph.parse(baseGraph());
    expect(graph.nodes[0]!.source?.connector).toBeUndefined();
  });
});
