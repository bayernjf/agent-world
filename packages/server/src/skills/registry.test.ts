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
      expect(s.permissions).toBeDefined();
    }
  });

  it("ships at least one built-in card for every skill kind", () => {
    const byKind = new Map<string, string[]>();
    for (const s of listBuiltinSkills()) {
      byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s.id]);
    }
    for (const kind of ["tool", "prompt-module", "output-contract", "judge"]) {
      expect(byKind.get(kind), `no built-in card of kind ${kind}`).toBeTruthy();
    }
  });

  it("gives non-tool cards a usable payload and no callable tool", () => {
    const skills = listBuiltinSkills();
    const find = (id: string) => skills.find((s) => s.id === id)!;
    expect(find("zh_style_guide").config.prompt).toBeTypeOf("string");
    expect(find("cite_sources").config.prompt).toBeTypeOf("string");
    expect(find("report_json").config.schema).toMatchObject({ type: "object" });
    expect(find("judge_fact_check").config.criterion).toBeTypeOf("string");
    // Non-tool cards must not leak into the model's tool list.
    expect(
      resolveTools([
        { id: "zh_style_guide", enabled: true },
        { id: "report_json", enabled: true },
        { id: "judge_fact_check", enabled: true },
      ]),
    ).toEqual([]);
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
