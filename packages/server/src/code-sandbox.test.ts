import { describe, expect, it } from "vitest";
import { access } from "node:fs/promises";
import { resolveInterpreter, createCodeWorkdir, cleanupCodeWorkdir } from "./code-sandbox.js";

describe("resolveInterpreter", () => {
  it("resolves node to an absolute path", () => {
    const p = resolveInterpreter("javascript");
    expect(p).toContain("node");
    expect(p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)).toBe(true);
  });

  it("caches the resolved path across calls", () => {
    const a = resolveInterpreter("javascript");
    const b = resolveInterpreter("javascript");
    expect(a).toBe(b);
  });
});

describe("code workdir", () => {
  it("creates an isolated temp dir and cleans it up", async () => {
    const dir = await createCodeWorkdir("r1", "n1", 1);
    expect(dir).toContain("aw-code-");
    await access(dir); // exists
    await cleanupCodeWorkdir(dir);
    await expect(access(dir)).rejects.toThrow();
  });

  it("sanitizes run/node ids in the directory name", async () => {
    const dir = await createCodeWorkdir("r<1>", "n#sub:1", 2);
    expect(dir).toContain("aw-code-");
    expect(dir).not.toContain("<");
    expect(dir).not.toContain(">");
    expect(dir).not.toContain("#");
    expect(dir).not.toContain(":");
    await cleanupCodeWorkdir(dir);
  });
});
