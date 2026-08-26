import { describe, expect, it } from "vitest";
import { artifactLabel, extractArtifacts } from "./artifact.js";

describe("extractArtifacts", () => {
  it("extracts markdown images", () => {
    const text = "Here is a photo ![cat](https://example.com/cat.png) of a cat.";
    const arts = extractArtifacts(text, "n1");
    expect(arts).toHaveLength(1);
    expect(arts[0]!.kind).toBe("image");
    expect(arts[0]!.uri).toBe("https://example.com/cat.png");
    expect(arts[0]!.label).toBe("cat");
  });

  it("extracts bare image URLs", () => {
    const text = "check https://cdn.example.com/photo.jpg";
    const arts = extractArtifacts(text, "n1");
    expect(arts).toHaveLength(1);
    expect(arts[0]!.kind).toBe("image");
    expect(arts[0]!.uri).toBe("https://cdn.example.com/photo.jpg");
  });

  it("extracts video and audio URLs", () => {
    const text = "video https://example.com/v.mp4 audio https://example.com/a.mp3";
    const arts = extractArtifacts(text, "n1");
    expect(arts.map((a) => a.kind)).toEqual(["video", "audio"]);
  });

  it("does not duplicate markdown image URLs", () => {
    const text = "![x](https://example.com/x.png) and also https://example.com/x.png";
    const arts = extractArtifacts(text, "n1");
    expect(arts).toHaveLength(1);
  });

  it("extracts fenced JSON blocks", () => {
    const text = 'result:\n```json\n{"key":"value","n":42}\n```';
    const arts = extractArtifacts(text, "n1");
    const json = arts.find((a) => a.kind === "json");
    expect(json).toBeTruthy();
    expect(JSON.parse(json!.content!)).toEqual({ key: "value", n: 42 });
  });

  it("ignores invalid JSON fences", () => {
    const text = "```\nnot json\n```";
    const arts = extractArtifacts(text, "n1");
    expect(arts.filter((a) => a.kind === "json")).toHaveLength(0);
  });

  it("returns empty for plain text", () => {
    expect(extractArtifacts("just some words", "n1")).toHaveLength(0);
  });
});

describe("artifactLabel", () => {
  it("uses label when present", () => {
    expect(artifactLabel({ id: "x", kind: "image", label: "封面" })).toBe("封面");
  });
  it("falls back to kind names", () => {
    expect(artifactLabel({ id: "x", kind: "image" })).toBe("图片");
    expect(artifactLabel({ id: "x", kind: "video" })).toBe("视频");
  });
  it("truncates text content", () => {
    expect(artifactLabel({ id: "x", kind: "text", content: "abcdefghij".repeat(10) })).toContain("…");
  });
});
