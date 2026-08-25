import { describe, expect, it } from "vitest";
import {
  executeBuiltinTool,
  listBuiltinSkills,
  resolveTools,
} from "./registry.js";

describe("skill registry", () => {
  it("lists built-in skills with permissions", () => {
    const skills = listBuiltinSkills();
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("web_fetch");
    expect(ids).toContain("json_extract");
    expect(ids).toContain("current_time");
    for (const s of skills) {
      expect(s.kind).toBe("tool");
      expect(s.permissions).toBeDefined();
    }
  });

  it("resolves only enabled mounted skills to tool definitions", () => {
    const tools = resolveTools([
      { id: "json_extract", enabled: true },
      { id: "web_fetch", enabled: false },
      { id: "nonexistent", enabled: true },
    ]);
    expect(tools.map((t) => t.name)).toEqual(["json_extract"]);
    expect(tools[0]!.parameters).toBeDefined();
  });

  it("extracts values from JSON by path", async () => {
    const result = await executeBuiltinTool("json_extract", {
      json: '{"data":{"items":[{"name":"widget"},{"name":"gadget"}]}}',
      path: "data.items[1].name",
    });
    expect(result).toBe("gadget");
  });

  it("returns the whole object when path is empty", async () => {
    const result = await executeBuiltinTool("json_extract", {
      json: '{"a":1}',
    });
    expect(result).toEqual({ a: 1 });
  });

  it("rejects non-https URLs in web_fetch", async () => {
    await expect(
      executeBuiltinTool("web_fetch", { url: "http://example.com" }),
    ).rejects.toThrow(/https/);
  });

  it("returns an ISO timestamp from current_time", async () => {
    const result = await executeBuiltinTool("current_time", {});
    expect(typeof result).toBe("string");
    expect(new Date(result as string).toISOString()).toBe(result);
  });

  it("throws on unknown tool", async () => {
    await expect(executeBuiltinTool("nope", {})).rejects.toThrow(/unknown/);
  });
});
