import { describe, expect, it } from "vitest";
import { FileParseConfig, GraphNode, HttpNodeConfig } from "./graph.js";

describe("FileParseConfig", () => {
  it("defaults to 20 max images and no explicit source", () => {
    const cfg = FileParseConfig.parse({});
    expect(cfg.source).toBeUndefined();
    expect(cfg.maxImages).toBe(20);
  });

  it("parses an explicit source and maxImages cap", () => {
    const cfg = FileParseConfig.parse({ source: "http1", maxImages: 5 });
    expect(cfg.source).toBe("http1");
    expect(cfg.maxImages).toBe(5);
  });

  it("clamps invalid maxImages", () => {
    expect(() => FileParseConfig.parse({ maxImages: -1 })).toThrow();
    expect(() => FileParseConfig.parse({ maxImages: 101 })).toThrow();
    expect(() => FileParseConfig.parse({ maxImages: 2.5 })).toThrow();
  });

  it("round-trips inside a GraphNode", () => {
    const node = GraphNode.parse({
      id: "fp1",
      kind: "fileParse",
      name: "PARSE",
      x: 0,
      y: 0,
      fileParse: { source: "dl", maxImages: 3 },
    });
    expect(node.kind).toBe("fileParse");
    expect(node.fileParse?.maxImages).toBe(3);
  });
});

describe("HttpNodeConfig.outputMode", () => {
  it("accepts the new file mode and defaults to auto", () => {
    expect(HttpNodeConfig.parse({ url: "https://x/y.pdf", outputMode: "file" }).outputMode).toBe("file");
    expect(HttpNodeConfig.parse({ url: "https://x" }).outputMode).toBe("auto");
  });

  it("rejects unknown output modes", () => {
    expect(() => HttpNodeConfig.parse({ url: "https://x", outputMode: "blob" })).toThrow();
  });
});
