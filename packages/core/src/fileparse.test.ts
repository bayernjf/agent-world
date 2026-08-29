import { describe, expect, it } from "vitest";
import {
  ConvertConfig,
  FileParseConfig,
  GraphNode,
  HttpNodeConfig,
  OcrConfig,
  SearchConfig,
  TranslateConfig,
} from "./graph.js";

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

describe("TranslateConfig", () => {
  it("defaults to 简体中文 with faithful temperature", () => {
    const cfg = TranslateConfig.parse({});
    expect(cfg.target).toBe("简体中文");
    expect(cfg.temperature).toBe(0.2);
    expect(cfg.source).toBeUndefined();
    expect(cfg.model).toBeUndefined();
    expect(cfg.budgetUsd).toBeUndefined();
  });

  it("parses an explicit source, target, model and budget", () => {
    const cfg = TranslateConfig.parse({
      source: "fp1",
      target: "English",
      model: "m1",
      temperature: 0.5,
      budgetUsd: 0.01,
    });
    expect(cfg.source).toBe("fp1");
    expect(cfg.target).toBe("English");
    expect(cfg.model).toBe("m1");
    expect(cfg.temperature).toBe(0.5);
    expect(cfg.budgetUsd).toBe(0.01);
  });

  it("rejects empty target and out-of-range temperature", () => {
    expect(() => TranslateConfig.parse({ target: "" })).toThrow();
    expect(() => TranslateConfig.parse({ temperature: 3 })).toThrow();
    expect(() => TranslateConfig.parse({ temperature: -0.1 })).toThrow();
    expect(() => TranslateConfig.parse({ budgetUsd: -1 })).toThrow();
  });

  it("round-trips inside a GraphNode", () => {
    const node = GraphNode.parse({
      id: "tr1",
      kind: "translate",
      name: "TRANSLATE",
      x: 0,
      y: 0,
      translate: { target: "日本語" },
    });
    expect(node.kind).toBe("translate");
    expect(node.translate?.target).toBe("日本語");
  });
});

describe("OcrConfig", () => {
  it("defaults to english with CDN endpoints and no explicit source", () => {
    const cfg = OcrConfig.parse({});
    expect(cfg.lang).toBe("eng");
    expect(cfg.source).toBeUndefined();
    expect(cfg.langPath).toBeUndefined();
    expect(cfg.workerPath).toBeUndefined();
    expect(cfg.corePath).toBeUndefined();
  });

  it("parses lang, source and CDN overrides", () => {
    const cfg = OcrConfig.parse({
      source: "fp1",
      lang: "chi_sim+eng",
      langPath: "https://cdn.example.com/tessdata",
      workerPath: "https://cdn.example.com/worker.js",
      corePath: "https://cdn.example.com/core.wasm.js",
    });
    expect(cfg.source).toBe("fp1");
    expect(cfg.lang).toBe("chi_sim+eng");
    expect(cfg.langPath).toBe("https://cdn.example.com/tessdata");
    expect(cfg.workerPath).toBe("https://cdn.example.com/worker.js");
    expect(cfg.corePath).toBe("https://cdn.example.com/core.wasm.js");
  });

  it("rejects empty lang and non-URL paths", () => {
    expect(() => OcrConfig.parse({ lang: "" })).toThrow();
    expect(() => OcrConfig.parse({ langPath: "not-a-url" })).toThrow();
    expect(() => OcrConfig.parse({ workerPath: "not-a-url" })).toThrow();
    expect(() => OcrConfig.parse({ corePath: "not-a-url" })).toThrow();
  });

  it("round-trips inside a GraphNode", () => {
    const node = GraphNode.parse({
      id: "ocr1",
      kind: "ocr",
      name: "OCR",
      x: 0,
      y: 0,
      ocr: { lang: "chi_sim" },
    });
    expect(node.kind).toBe("ocr");
    expect(node.ocr?.lang).toBe("chi_sim");
  });
});

describe("ConvertConfig", () => {
  it("requires an explicit target format and defaults quality to 85", () => {
    const cfg = ConvertConfig.parse({ to: "jpeg" });
    expect(cfg.to).toBe("jpeg");
    expect(cfg.quality).toBe(85);
    expect(cfg.source).toBeUndefined();
  });

  it("parses an explicit source, target and quality", () => {
    const cfg = ConvertConfig.parse({ source: "dl1", to: "image" });
    expect(cfg.source).toBe("dl1");
    expect(cfg.to).toBe("image");
    const jpeg = ConvertConfig.parse({ to: "jpeg", quality: 95 });
    expect(jpeg.quality).toBe(95);
  });

  it("rejects missing or unknown targets and out-of-range quality", () => {
    expect(() => ConvertConfig.parse({})).toThrow();
    expect(() => ConvertConfig.parse({ to: "webp" })).toThrow();
    expect(() => ConvertConfig.parse({ to: "jpeg", quality: 0 })).toThrow();
    expect(() => ConvertConfig.parse({ to: "jpeg", quality: 101 })).toThrow();
  });

  it("round-trips inside a GraphNode", () => {
    const node = GraphNode.parse({
      id: "cv1",
      kind: "convert",
      name: "CONVERT",
      x: 0,
      y: 0,
      convert: { to: "png" },
    });
    expect(node.kind).toBe("convert");
    expect(node.convert?.to).toBe("png");
  });
});

describe("SearchConfig", () => {
  it("defaults to duckduckgo with 5 results and no static query", () => {
    const cfg = SearchConfig.parse({});
    expect(cfg.provider).toBe("duckduckgo");
    expect(cfg.maxResults).toBe(5);
    expect(cfg.query).toBe("");
  });

  it("parses an explicit query, provider and maxResults", () => {
    const cfg = SearchConfig.parse({
      query: "agent world",
      provider: "tavily",
      maxResults: 10,
    });
    expect(cfg.query).toBe("agent world");
    expect(cfg.provider).toBe("tavily");
    expect(cfg.maxResults).toBe(10);
  });

  it("rejects unknown providers and out-of-range maxResults", () => {
    expect(() => SearchConfig.parse({ provider: "bing" })).toThrow();
    expect(() => SearchConfig.parse({ maxResults: 0 })).toThrow();
    expect(() => SearchConfig.parse({ maxResults: 21 })).toThrow();
  });

  it("round-trips inside a GraphNode", () => {
    const node = GraphNode.parse({
      id: "se1",
      kind: "search",
      name: "SEARCH",
      x: 0,
      y: 0,
      search: { query: "hello", provider: "google" },
    });
    expect(node.kind).toBe("search");
    expect(node.search?.provider).toBe("google");
  });
});
