import { describe, expect, it } from "vitest";
import { isSafeUri, sanitizeUrl } from "./sanitize-html";

describe("isSafeUri (audit L6/M8)", () => {
  it("accepts ordinary web and mail links", () => {
    expect(isSafeUri("https://example.com/a.png")).toBe(true);
    expect(isSafeUri("http://x.test")).toBe(true);
    expect(isSafeUri("mailto:a@b.com")).toBe(true);
  });

  it("accepts inlined/object images", () => {
    expect(isSafeUri("data:image/png;base64,AAAA")).toBe(true);
    expect(isSafeUri("blob:https://app/uuid")).toBe(true);
  });

  it("blocks script and other dangerous schemes", () => {
    expect(isSafeUri("javascript:alert(1)")).toBe(false);
    expect(isSafeUri(" javascript:alert(1)")).toBe(false);
    expect(isSafeUri("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeUri("data:text/html,<script>")).toBe(false);
  });

  it("treats empty/relative values as safe", () => {
    expect(isSafeUri("")).toBe(true);
    expect(isSafeUri(undefined)).toBe(true);
    expect(isSafeUri("/relative/path")).toBe(true);
  });
});

describe("sanitizeUrl (audit M8, shared by renderInline/inlineHtml)", () => {
  it("keeps http/https/mailto links", () => {
    expect(sanitizeUrl("https://x.com/a")).toBe("https://x.com/a");
    expect(sanitizeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("keeps http/data-image/blob for images but not data:text/html", () => {
    expect(sanitizeUrl("data:image/png;base64,AA", "image")).toBe("data:image/png;base64,AA");
    expect(sanitizeUrl("blob:https://x/u", "image")).toBe("blob:https://x/u");
    expect(sanitizeUrl("data:text/html,<script>", "image")).toBe("");
  });

  it("neutralizes script schemes (returns empty so href/src is dropped)", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeUrl("  JavaScript:alert(1) ")).toBe("");
    expect(sanitizeUrl("vbscript:msgbox(1)")).toBe("");
  });

  it("passes relative paths and anchors through and normalizes protocol-relative", () => {
    expect(sanitizeUrl("/local/a")).toBe("/local/a");
    expect(sanitizeUrl("#section")).toBe("#section");
    expect(sanitizeUrl("//cdn.example.com/a.js")).toBe("https://cdn.example.com/a.js");
  });

  it("rejects data: links even when images allow data:image", () => {
    expect(sanitizeUrl("data:text/html,x", "link")).toBe("");
  });
});
