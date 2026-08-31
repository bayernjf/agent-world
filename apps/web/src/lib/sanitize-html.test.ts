import { describe, expect, it } from "vitest";
import { isSafeUri } from "./sanitize-html";

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
