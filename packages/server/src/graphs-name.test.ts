import { describe, expect, it } from "vitest";
import { findGraphIdByName } from "./graphs-name.js";

const list = [
  { id: "a", name: "小红书种草笔记" },
  { id: "b", name: "淘宝商品详情" },
  { id: "c", name: "  客服知识库  " },
  { id: "d", name: "Marketing Funnel" },
];

describe("findGraphIdByName", () => {
  it("rejects empty / whitespace names", () => {
    expect(findGraphIdByName(list, "")).toBeNull();
    expect(findGraphIdByName(list, "   ")).toBeNull();
  });

  it("matches exact names", () => {
    expect(findGraphIdByName(list, "小红书种草笔记")).toBe("a");
  });

  it("is case-insensitive for ASCII names", () => {
    expect(findGraphIdByName(list, "MARKETING funnel")).toBe("d");
  });

  it("trims whitespace on both sides", () => {
    expect(findGraphIdByName(list, "  客服知识库")).toBe("c");
    expect(findGraphIdByName(list, "客服知识库  ")).toBe("c");
  });

  it("returns null when no collision", () => {
    expect(findGraphIdByName(list, "全新产线")).toBeNull();
  });

  it("excludes the row being renamed (excludeId)", () => {
    // Renaming a→a (same name) must not be a self-collision.
    expect(findGraphIdByName(list, "小红书种草笔记", "a")).toBeNull();
    // But b→小红书种草笔记 still collides with a.
    expect(findGraphIdByName(list, "小红书种草笔记", "b")).toBe("a");
  });
});
