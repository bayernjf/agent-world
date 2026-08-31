import { describe, expect, it } from "vitest";
import {
  buildNodeContext,
  evaluateCondition,
  evaluateTemplate,
  getByPath,
  resolveExpression,
  transformJson,
} from "./variables.js";
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
    nodes: [{ id: "upstream", kind: "textGen", name: "UP", x: 0, y: 0 }],
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

  it("injects extra context (loop item)", () => {
    const artifacts = new Map<string, Artifact[]>();
    artifacts.set("upstream", [{ id: "t", kind: "text", content: "hello", mimeType: "text/plain" }]);
    const ctx = buildNodeContext("http", artifacts, graph, { item: { id: 7 } });
    expect(ctx.upstream).toBe("hello");
    expect(ctx.item).toEqual({ id: 7 });
  });

  it("injects graph variables under the var key", () => {
    const artifacts = new Map<string, Artifact[]>();
    artifacts.set("upstream", [{ id: "t", kind: "text", content: "hello", mimeType: "text/plain" }]);
    const ctx = buildNodeContext("http", artifacts, graph, undefined, {
      brand: "可口可乐",
      stats: { count: 3 },
    });
    expect(ctx["var"]).toEqual({ brand: "可口可乐", stats: { count: 3 } });
    expect(resolveExpression("var.brand", ctx)).toBe("可口可乐");
    expect(resolveExpression("var.stats.count", ctx)).toBe(3);
    expect(evaluateTemplate("品牌 ${var.brand} #${var.stats.count}", ctx)).toBe("品牌 可口可乐 #3");
  });
});

describe("transformJson", () => {
  it("interpolates strings and preserves structure", () => {
    const out = transformJson(
      { title: "编号 ${item.id}", tags: ["a", "${item.kind}"] },
      { item: { id: 3, kind: "phone" } },
    );
    expect(out).toEqual({ title: "编号 3", tags: ["a", "phone"] });
  });

  it("keeps the referenced type for pure placeholders", () => {
    const address = { city: "杭州", zip: 310000 };
    const out = transformJson(
      { addr: "${item.address}", count: "${item.n}" },
      { item: { address, n: 42 } },
    );
    expect(out).toEqual({ addr: address, count: 42 });
  });

  it("iterates a source array with item context", () => {
    const template = { label: "${item.name}", price: "${item.price}" };
    const rows = [{ name: "a", price: 1 }, { name: "b", price: 2 }];
    const out = rows.map((item) => transformJson(template, { item }));
    expect(out).toEqual([
      { label: "a", price: 1 },
      { label: "b", price: 2 },
    ]);
  });

  it("resolves missing values to empty strings", () => {
    expect(transformJson({ a: "${missing.x}" }, {})).toEqual({ a: "" });
  });
});

describe("getByPath", () => {
  it("walks nested objects and arrays", () => {
    const data = { results: [{ name: "x" }, { name: "y" }] };
    expect(getByPath(data, "results[1].name")).toBe("y");
    expect(getByPath(data, "results.0.name")).toBe("x");
    expect(getByPath(data, "nope")).toBeUndefined();
  });
});

describe("evaluateCondition", () => {
  const ctx = { score: 7, status: "done", ok: true, count: 0, name: "Ada" };

  it("compares interpolated numbers", () => {
    expect(evaluateCondition("${score} > 5", ctx)).toBe(true);
    expect(evaluateCondition("${score} >= 7 && ${ok} == true", ctx)).toBe(true);
    expect(evaluateCondition("${score} < 7", ctx)).toBe(false);
  });

  it("compares strings", () => {
    expect(evaluateCondition("${status} == 'done'", ctx)).toBe(true);
    expect(evaluateCondition('${status} == "pending"', ctx)).toBe(false);
    expect(evaluateCondition("${name} === 'Ada'", ctx)).toBe(true);
  });

  it("handles logic and parentheses", () => {
    expect(evaluateCondition("(${score} > 5) && (${count} == 0)", ctx)).toBe(true);
    expect(evaluateCondition("${ok} || ${count} > 0", ctx)).toBe(true);
    expect(evaluateCondition("!${ok}", ctx)).toBe(false);
    expect(evaluateCondition("${count} == 0 && ${status} != 'failed'", ctx)).toBe(true);
  });

  it("is falsy for missing or malformed expressions", () => {
    expect(evaluateCondition("${missing} == 1", ctx)).toBe(false);
    expect(evaluateCondition("!!", ctx)).toBe(false);
    expect(evaluateCondition("", ctx)).toBe(false);
  });

  it("supports arithmetic", () => {
    expect(evaluateCondition("${score} * 2 == 14", ctx)).toBe(true);
    expect(evaluateCondition("${score} + 1 > 7", ctx)).toBe(true);
  });
});
