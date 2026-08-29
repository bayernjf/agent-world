import { describe, expect, it } from "vitest";
import { evaluateTemplate, resolveExpression, buildNodeContext } from "./variables.js";
import type { Graph } from "./graph.js";
import type { Artifact } from "./artifact.js";

describe("variable interpolation", () => {
  it("evaluates simple placeholders", () => {
    const ctx = { a: "apple", b: 2 };
    expect(evaluateTemplate("hello ${a}", ctx)).toBe("hello apple");
    expect(evaluateTemplate("${a} and ${b}", ctx)).toBe("apple and 2");
  });

  it("returns empty string for missing values", () => {
    expect(evaluateTemplate("${missing}", {})).toBe("");
  });

  it("resolves nested paths", () => {
    const ctx = { user: { name: "Ada", tags: ["a", "b"] } };
    expect(resolveExpression("user.name", ctx)).toBe("Ada");
    expect(resolveExpression("user.tags[0]", ctx)).toBe("a");
    expect(resolveExpression("user.unknown", ctx)).toBeUndefined();
  });

  it("coerces non-string values to strings", () => {
    expect(evaluateTemplate("${b}", { b: true })).toBe("true");
  });
});

describe("buildNodeContext", () => {
  const graph: Graph = {
    id: "g",
    name: "g",
    nodes: [{ id: "upstream", kind: "agent", name: "UP", x: 0, y: 0 }],
    edges: [{ id: "e1", from: "upstream", to: "http", kind: "flow" }],
  };

  it("uses text artifact content", () => {
    const artifacts = new Map<string, Artifact[]>();
    artifacts.set("upstream", [{ id: "t", kind: "text", content: "hello", mimeType: "text/plain" }]);
    const ctx = buildNodeContext("http", artifacts, graph);
    expect(ctx.upstream).toBe("hello");
  });

  it("parses json artifact into object", () => {
    const artifacts = new Map<string, Artifact[]>();
    artifacts.set("upstream", [
      { id: "j", kind: "json", content: '{"price": 42}', mimeType: "application/json" },
    ]);
    const ctx = buildNodeContext("http", artifacts, graph);
    expect(ctx.upstream).toEqual({ price: 42 });
    expect(resolveExpression("upstream.price", ctx)).toBe(42);
  });
});
