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

  it("applies field values at instantiation: explicit value wins, then default, and the template itself is not mutated", () => {
    const tpl = getTemplate("tpl-patrol-alert")!;
    const probeUrl = () =>
      (tpl.graph.nodes.find((n) => n.id === "probe")!.http as { url: string }).url;

    // No values and no explicit skip → defaultValue keeps out-of-box behaviour.
    const a = instantiateTemplate(tpl, { id: "ga" });
    const probeA = a.nodes.find((n) => n.name === "健康检查")!;
    expect((probeA.http as { url: string }).url).toBe("https://httpbin.org/status/200");

    // Explicit value replaces the whole value at the path.
    const b = instantiateTemplate(tpl, { id: "gb", fieldValues: { targetUrl: "https://example.com/health" } });
    const probeB = b.nodes.find((n) => n.name === "健康检查")!;
    expect((probeB.http as { url: string }).url).toBe("https://example.com/health");

    // Blank input falls back to the default (the web form sends "" for skipped inputs).
    const c = instantiateTemplate(tpl, { id: "gc", fieldValues: { targetUrl: "  " } });
    const probeC = c.nodes.find((n) => n.name === "健康检查")!;
    expect((probeC.http as { url: string }).url).toBe("https://httpbin.org/status/200");

    // The shared template definition is never mutated by instantiation.
    expect(probeUrl()).toBe("https://httpbin.org/status/200");
  });

  it("applies multiple fields to their own targets (research brief sources)", () => {
    const tpl = getTemplate("tpl-research-brief")!;
    const g = instantiateTemplate(tpl, {
      fieldValues: { srcAUrl: "https://a.example.com", srcBUrl: "https://b.example.com" },
    });
    const urls = g.nodes
      .filter((n) => n.kind === "http")
      .map((n) => (n.http as { url: string }).url)
      .sort();
    expect(urls).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("rewrites node-id references so configs point at the fresh ids", () => {
    const tpl = {
      id: "tpl-ref",
      name: "ref",
      description: "ref",
      category: "基础",
      graph: {
        id: "tpl-ref",
        name: "ref",
        nodes: [
          { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
          {
            id: "split",
            kind: "code",
            name: "SPLIT",
            x: 1,
            y: 0,
            code: {
              language: "javascript",
              code: 'const raw = Object.values(inputs["src"])[0]; console.log(raw);',
            },
          },
          {
            id: "writer",
            kind: "textGen",
            name: "WRITER",
            x: 2,
            y: 0,
            textGen: {
              model: "m",
              prompt: "引用上游 ${src} 的内容，再关注 ${split.output}。",
              skills: [],
            },
          },
        ],
        edges: [
          { id: "e1", from: "src", to: "split", kind: "flow" },
          { id: "e2", from: "split", to: "writer", kind: "flow" },
        ],
      },
    } as const;
    const g = instantiateTemplate(tpl);
    const byName = new Map(g.nodes.map((n) => [n.name, n]));
    const srcId = byName.get("SRC")!.id;
    const splitId = byName.get("SPLIT")!.id;
    // The fresh ids replaced the template ids.
    expect(srcId).not.toBe("src");
    expect(splitId).not.toBe("split");
    // Code script's inputs ref points at the fresh src id.
    const code = byName.get("SPLIT")!.code as { code: string };
    expect(code.code).toContain(`inputs["${srcId}"]`);
    // Prompt's ${...} refs point at the fresh ids.
    const prompt = byName.get("WRITER")!.textGen as { prompt: string };
    expect(prompt.prompt).toContain(`\${${srcId}`);
    expect(prompt.prompt).toContain(`\${${splitId}`);
    // The template definition is untouched.
    expect((pl("split")!.code as { code: string }).code).toContain('inputs["src"]');
    function pl(id: string) {
      return tpl.graph.nodes.find((n) => n.id === id);
    }
  });
});
