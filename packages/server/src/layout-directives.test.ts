import { describe, expect, it } from "vitest";
import { withLayoutDirectives } from "./engine.js";

describe("withLayoutDirectives", () => {
  it("returns the base prompt unchanged when there are no directives", () => {
    const base = "你是排版编辑。";
    expect(withLayoutDirectives(base, undefined)).toBe(base);
    expect(withLayoutDirectives(base, "")).toBe(base);
    expect(withLayoutDirectives(base, "   ")).toBe(base);
  });

  it("appends trimmed directives after a separator", () => {
    const out = withLayoutDirectives("base", "主图 3:4 居中");
    expect(out).toContain("base");
    expect(out).toContain("排版附加要求（必须遵守）：");
    expect(out).toContain("主图 3:4 居中");
    // whitespace around the directive is trimmed
    expect(withLayoutDirectives("base", "  主图 3:4 居中  ")).toBe(out);
  });
});
