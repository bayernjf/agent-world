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

  it("parses image position/size fields and imageCards layout", () => {
    const output = [
      "```product-json",
      JSON.stringify({
        platform: "taobao",
        blocks: [
          { type: "image", src: "u1", caption: "c", align: "right", aspect: "3:4", rounded: true, width: "60%" },
          { type: "imageCards", layout: "grid", columns: 2, items: [{ src: "u2", title: "t", caption: "c2", span: 2 }] },
        ],
      }),
      "```",
    ].join("\n");
    const doc = parseProductDocument(output);
    expect(doc).not.toBeNull();
    const [img, cards] = doc!.blocks;
    expect(img.type).toBe("image");
    if (img.type === "image") {
      expect(img.align).toBe("right");
      expect(img.aspect).toBe("3:4");
      expect(img.rounded).toBe(true);
      expect(img.width).toBe("60%");
    }
    expect(cards.type).toBe("imageCards");
    if (cards.type === "imageCards") {
      expect(cards.layout).toBe("grid");
      expect(cards.columns).toBe(2);
      expect(cards.items[0]!.span).toBe(2);
    }
  });

  it("still parses blocks without the optional position fields", () => {
    const output = [
      "```product-json",
      JSON.stringify({ platform: "xiaohongshu", blocks: [{ type: "image", src: "u" }] }),
      "```",
    ].join("\n");
    const doc = parseProductDocument(output);
    expect(doc).not.toBeNull();
    expect(doc!.blocks[0]!.type).toBe("image");
  });
});
