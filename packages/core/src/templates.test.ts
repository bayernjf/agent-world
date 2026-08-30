import { describe, expect, it } from "vitest";
import { compile } from "./compile.js";
import { getTemplate, instantiateTemplate, TEMPLATES } from "./templates.js";

describe("templates", () => {
  it("ships a product-detail and a blank template", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(ids).toContain("tpl-product");
    expect(ids).toContain("tpl-blank");
  });

  it("instantiates with fresh node and edge ids", () => {
    const tpl = getTemplate("tpl-product")!;
    const a = instantiateTemplate(tpl, { id: "g1", name: "A" });
    const b = instantiateTemplate(tpl, { id: "g2", name: "B" });

    expect(a.id).toBe("g1");
    expect(a.name).toBe("A");
    expect(new Set(a.nodes.map((n) => n.id)).size).toBe(a.nodes.length);
    // No id collides across two instances.
    const overlap = a.nodes.filter((n) => b.nodes.some((m) => m.id === n.id));
    expect(overlap).toHaveLength(0);

    // Edge endpoints still reference nodes that exist.
    const nodeIds = new Set(a.nodes.map((n) => n.id));
    for (const e of a.edges) {
      expect(nodeIds.has(e.from)).toBe(true);
      expect(nodeIds.has(e.to)).toBe(true);
    }
  });

  it("product-detail template compiles (rework edge drops to a DAG)", () => {
    const graph = instantiateTemplate(getTemplate("tpl-product")!);
    const result = compile(graph);
    expect(result.plan).not.toBeNull();
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("blank template is empty but valid", () => {
    const graph = instantiateTemplate(getTemplate("tpl-blank")!);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("every non-blank template compiles without errors", () => {
    for (const tpl of TEMPLATES) {
      if (tpl.id === "tpl-blank") continue;
      const graph = instantiateTemplate(tpl);
      const result = compile(graph);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors, `${tpl.id} should compile: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
      expect(result.plan, `${tpl.id} should produce an executable plan`).not.toBeNull();
    }
  });

  it("template fields (when declared) reference nodes that exist and have unique keys", () => {
    for (const tpl of TEMPLATES) {
      if (!tpl.fields) continue;
      const nodeIds = new Set(tpl.graph.nodes.map((n) => n.id));
      const keys = new Set<string>();
      for (const f of tpl.fields) {
        expect(keys.has(f.key), `${tpl.id}: duplicate field key ${f.key}`).toBe(false);
        keys.add(f.key);
        expect(f.applyTo.length, `${tpl.id}: field ${f.key} has no applyTo`).toBeGreaterThan(0);
        for (const target of f.applyTo) {
          expect(
            nodeIds.has(target.nodeId),
            `${tpl.id}: field ${f.key} targets missing node ${target.nodeId}`,
          ).toBe(true);
          expect(target.path, `${tpl.id}: field ${f.key} has empty path`).toBeTruthy();
        }
      }
    }
  });
});
