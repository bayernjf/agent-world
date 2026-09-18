import { describe, expect, it } from "vitest";
import { prohibitedHitsWithContext } from "./prohibited.js";

describe("prohibitedHitsWithContext", () => {
  it("returns no hits when no term is present", () => {
    const r = prohibitedHitsWithContext("这是一段干净的文案", ["最", "第一"]);
    expect(r.total).toBe(0);
    expect(r.hits).toEqual([]);
  });

  it("returns no hits for empty text or no terms", () => {
    expect(prohibitedHitsWithContext("", ["最"]).total).toBe(0);
    expect(prohibitedHitsWithContext("最好", []).total).toBe(0);
  });

  it("counts every occurrence and quotes each distinct enclosing clause", () => {
    const text = "这是全网最好的产品。用过的人都说最好。可以闭眼入。";
    const r = prohibitedHitsWithContext(text, ["最"]);
    expect(r.total).toBe(2);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].term).toBe("最");
    expect(r.hits[0].count).toBe(2);
    expect(r.hits[0].snippets).toHaveLength(2);
    const joined = r.hits[0].snippets.join("|");
    expect(joined).toContain("这是全网最好的产品");
    expect(joined).toContain("用过的人都说最好");
  });

  it("reports multiple distinct terms with individual counts", () => {
    const text = "全网第一，绝对好用，绝对超值";
    const r = prohibitedHitsWithContext(text, ["第一", "绝对"]);
    expect(r.total).toBe(3);
    const counts = Object.fromEntries(r.hits.map((h) => [h.term, h.count]));
    expect(counts).toEqual({ 第一: 1, 绝对: 2 });
  });

  it("caps the number of snippets while keeping the true count", () => {
    const text = Array.from({ length: 10 }, (_, i) => `第${i}句最好。`).join("");
    const r = prohibitedHitsWithContext(text, ["最"], { perTerm: 2, totalSnippets: 6 });
    expect(r.total).toBe(10);
    expect(r.hits[0].snippets).toHaveLength(2);
  });

  it("de-duplicates identical enclosing clauses", () => {
    const text = "最好最好。";
    const r = prohibitedHitsWithContext(text, ["最"]);
    // Both hits live in the same clause → one unique snippet, but count stays 2.
    expect(r.total).toBe(2);
    expect(r.hits[0].snippets).toHaveLength(1);
  });

  it("falls back to a compact window for a clause with no punctuation", () => {
    const text = "x".repeat(50) + "最好" + "y".repeat(50);
    const r = prohibitedHitsWithContext(text, ["最"]);
    expect(r.total).toBe(1);
    const snippet = r.hits[0].snippets[0];
    expect(snippet.length).toBeLessThanOrEqual(64);
    expect(snippet).toContain("…");
    expect(snippet).toContain("最好");
  });
});
