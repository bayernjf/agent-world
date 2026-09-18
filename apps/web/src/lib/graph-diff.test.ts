import { describe, expect, it } from "vitest";
import type { Graph } from "@agent-world/core";
import { diffGraphs, diffText, formatDiffValue } from "./graph-diff";

function makeGraph(overrides: Partial<Graph> = {}): Graph {
  return {
    id: "g1",
    name: "测试产线",
    nodes: [],
    edges: [],
    ...overrides,
  };
}

const nodeA = () => ({
  id: "a",
  kind: "textGen" as const,
  name: "初稿",
  x: 100,
  y: 200,
  textGen: { model: "agnes-2.0-flash", prompt: "你好" },
});

describe("diffGraphs", () => {
  it("reports identical for equal graphs", () => {
    const g = makeGraph({ nodes: [nodeA()] });
    const d = diffGraphs(g, makeGraph({ nodes: [nodeA()] }));
    expect(d.identical).toBe(true);
    expect(d.nodesChanged).toHaveLength(0);
  });

  it("detects added and removed nodes", () => {
    const base = makeGraph({ nodes: [nodeA()] });
    const target = makeGraph({
      nodes: [
        nodeA(),
        { id: "b", kind: "textGen" as const, name: "润色", x: 0, y: 0 },
      ],
    });
    const d = diffGraphs(base, target);
    expect(d.identical).toBe(false);
    expect(d.nodesAdded.map((n) => n.id)).toEqual(["b"]);
    const d2 = diffGraphs(target, base);
    expect(d2.nodesRemoved.map((n) => n.id)).toEqual(["b"]);
  });

  it("detects leaf config changes on existing nodes", () => {
    const base = makeGraph({ nodes: [nodeA()] });
    const changed = nodeA();
    changed.textGen = { model: "agnes-2.5-flash", prompt: "你好" };
    const d = diffGraphs(base, makeGraph({ nodes: [changed] }));
    expect(d.nodesChanged).toHaveLength(1);
    const paths = d.nodesChanged[0]!.changes.map((c) => c.path);
    expect(paths).toContain("textGen.model");
    const modelChange = d.nodesChanged[0]!.changes.find((c) => c.path === "textGen.model");
    expect(modelChange?.before).toBe("agnes-2.0-flash");
    expect(modelChange?.after).toBe("agnes-2.5-flash");
  });

  it("detects position changes", () => {
    const moved = nodeA();
    moved.x = 300;
    const d = diffGraphs(makeGraph({ nodes: [nodeA()] }), makeGraph({ nodes: [moved] }));
    const paths = d.nodesChanged[0]!.changes.map((c) => c.path);
    expect(paths).toContain("x");
  });

  it("detects added and removed edges", () => {
    const b = nodeA();
    const c = { id: "c", kind: "textGen" as const, name: "C", x: 0, y: 0 };
    const base = makeGraph({
      nodes: [b, c],
      edges: [{ id: "e1", from: "a", to: "c", kind: "flow" as const }],
    });
    const target = makeGraph({
      nodes: [b, c],
      edges: [
        { id: "e1", from: "a", to: "c", kind: "flow" as const },
        { id: "e2", from: "c", to: "a", kind: "flow" as const },
      ],
    });
    const d = diffGraphs(base, target);
    expect(d.edgesAdded).toHaveLength(1);
    expect(d.edgesAdded[0]).toMatchObject({ from: "c", to: "a" });
    const d2 = diffGraphs(target, base);
    expect(d2.edgesRemoved).toHaveLength(1);
  });

  it("flags trigger and variable changes", () => {
    const base = makeGraph({
      triggers: [{ id: "t1", type: "cron" as const, cron: "0 * * * *", enabled: true }],
      variables: { foo: 1 },
    });
    const target = makeGraph({
      triggers: [{ id: "t1", type: "cron" as const, cron: "0 */2 * * *", enabled: true }],
      variables: { foo: 2 },
    });
    const d = diffGraphs(base, target);
    expect(d.triggersChanged).toBe(true);
    expect(d.variablesChanged).toBe(true);
    expect(d.identical).toBe(false);
  });
});

describe("formatDiffValue", () => {
  it("renders missing values distinctly", () => {
    expect(formatDiffValue(undefined)).toBe("∅");
    expect(formatDiffValue(null)).toBe("null");
    expect(formatDiffValue(42)).toBe("42");
    expect(formatDiffValue("abc")).toBe("abc");
  });

  it("truncates long strings", () => {
    expect(formatDiffValue("x".repeat(100))).toHaveLength(80);
  });
});

describe("diffText", () => {
  it("returns only equal segments for identical text", () => {
    const segs = diffText("保持不变的提示词", "保持不变的提示词");
    expect(segs.every((s) => s.type === "equal")).toBe(true);
    expect(segs.map((s) => s.text).join("")).toBe("保持不变的提示词");
  });

  it("diffs Chinese by character on insertion", () => {
    expect(diffText("写一篇草稿", "写一篇好草稿")).toEqual([
      { type: "equal", text: "写一篇" },
      { type: "added", text: "好" },
      { type: "equal", text: "草稿" },
    ]);
  });

  it("diffs Chinese by character on deletion", () => {
    const segs = diffText("写一篇好草稿", "写一篇草稿");
    expect(segs).toContainEqual({ type: "removed", text: "好" });
    expect(segs.some((s) => s.type === "added")).toBe(false);
  });

  it("diffs English by whole word instead of chopping letters", () => {
    const segs = diffText("hello world", "hello word");
    expect(segs).toContainEqual({ type: "removed", text: "world" });
    expect(segs).toContainEqual({ type: "added", text: "word" });
    expect(segs.some((s) => s.type === "removed" && s.text === "rl")).toBe(false);
  });

  it("handles empty sides", () => {
    expect(diffText("", "")).toEqual([]);
    expect(diffText("", "新增")).toEqual([{ type: "added", text: "新增" }]);
    expect(diffText("删除", "")).toEqual([{ type: "removed", text: "删除" }]);
  });

  it("falls back to whole replace for oversized inputs", () => {
    const before = "字".repeat(5000);
    const after = `${before}尾`;
    const segs = diffText(before, after);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ type: "removed", text: before });
    expect(segs[1]).toEqual({ type: "added", text: after });
  });
});
