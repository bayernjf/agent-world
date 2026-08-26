import { describe, expect, it } from "vitest";
import { parseProductDocument } from "./product.js";

describe("parseProductDocument", () => {
  it("parses a valid product-json fence into blocks", () => {
    const output = [
      "intro text that should be ignored",
      "```product-json",
      JSON.stringify({
        platform: "taobao",
        title: "测试商品",
        blocks: [
          { type: "hero", title: "主标题", subtitle: "卖点" },
          { type: "bullets", items: ["a", "b"] },
          { type: "cta", text: "立即购买" },
        ],
      }),
      "```",
    ].join("\n");
    const doc = parseProductDocument(output);
    expect(doc).not.toBeNull();
    expect(doc!.platform).toBe("taobao");
    expect(doc!.blocks).toHaveLength(3);
    expect(doc!.blocks[1]!.type).toBe("bullets");
  });

  it("returns null for plain markdown output", () => {
    expect(parseProductDocument("# title\n\nsome text")).toBeNull();
  });

  it("returns null when the fenced json is invalid", () => {
    const output = "```product-json\n{not valid json}\n```";
    expect(parseProductDocument(output)).toBeNull();
  });
});
