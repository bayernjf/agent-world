import { describe, expect, it } from "vitest";
import { sanitizeError } from "./sanitize.js";

describe("sanitizeError (audit L5)", () => {
  it("keeps an ordinary, safe message unchanged", () => {
    expect(sanitizeError("webhook 触发器必须设置 secret")).toBe("webhook 触发器必须设置 secret");
  });

  it("strips stack-trace frames and keeps the message", () => {
    const err = new Error("boom");
    err.stack = `Error: boom\n    at foo (/Users/j/dev/x.ts:10:5)\n    at node:internal/process:42`;
    const out = sanitizeError(err);
    expect(out).toContain("boom");
    expect(out).not.toContain("at foo");
    expect(out).not.toContain("node:internal");
  });

  it("redacts POSIX internal absolute paths", () => {
    const out = sanitizeError("ENOENT: no such file /Users/jiangfeng/.config/aw/key.txt");
    expect(out).not.toContain("/Users/jiangfeng");
    expect(out).toContain("<internal-path>");
  });

  it("redacts Windows drive paths and file:// URLs", () => {
    expect(sanitizeError("fail at C:\\Users\\dev\\secret.txt")).not.toContain("C:\\Users");
    expect(sanitizeError("see file:///private/var/folders/x")).not.toContain("file:///");
  });

  it("still redacts secrets after path stripping", () => {
    const out = sanitizeError("upstream said Authorization: Bearer sk-abcdef123456 from /tmp/x");
    expect(out).not.toContain("sk-abcdef123456");
    expect(out).not.toContain("/tmp/x");
  });

  it("redacts API keys carried in URL query parameters (audit L6)", () => {
    expect(sanitizeError("GET https://serpapi.com/search?q=a&api_key=SECRET123")).not.toContain("SECRET123");
    expect(sanitizeError("https://googleapis.com/v1?key=ABCDE&cx=x")).not.toContain("ABCDE");
    // Non-secret neighbouring params survive.
    expect(sanitizeError("https://googleapis.com/v1?key=ABCDE&cx=x")).toContain("cx=x");
  });

  it("truncates very long messages", () => {
    expect(sanitizeError("x".repeat(900)).length).toBeLessThanOrEqual(501);
  });
});
