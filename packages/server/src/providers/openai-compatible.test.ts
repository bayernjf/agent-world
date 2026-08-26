import { describe, expect, it } from "vitest";
import { buildUserContent } from "./openai-compatible.js";

describe("buildUserContent (4.5)", () => {
  it("prefers multimodal content parts when supplied", () => {
    const out = buildUserContent("hello", [], [
      { type: "text", text: "caption" },
      { type: "image", image: "https://x/a.png" },
    ]) as Array<{ type: string; image_url?: { url: string } }>;
    expect(out).toEqual([
      { type: "text", text: "caption" },
      { type: "image_url", image_url: { url: "https://x/a.png" } },
    ]);
  });

  it("falls back to images shortcut when no content is given", () => {
    const out = buildUserContent("look", ["https://x/b.png"]) as Array<{ type: string }>;
    expect(out).toContainEqual({ type: "image_url", image_url: { url: "https://x/b.png" } });
    expect(out[0]).toEqual({ type: "text", text: "look" });
  });

  it("returns the plain string when neither content nor images exist", () => {
    expect(buildUserContent("just text")).toBe("just text");
    expect(buildUserContent("")).toBe("(no input)");
  });
});
