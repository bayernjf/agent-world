import { describe, expect, it } from "vitest";
import { compile } from "./compile.js";
import {
  BLANK_TEMPLATE,
  getTemplate,
  instantiateTemplate,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
} from "./templates.js";

describe("templates", () => {
  it("ships business templates separately from the blank entry", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(ids).toContain("tpl-product");
    // Blank canvas is a creation entry, NOT a business template.
    expect(ids).not.toContain("tpl-blank");
    expect(BLANK_TEMPLATE.id).toBe("tpl-blank");
    expect(TEMPLATES).toHaveLength(27);
  });

  it("categories cover every template and every category renders", () => {
    for (const tpl of TEMPLATES) {
      expect(
        (TEMPLATE_CATEGORIES as readonly string[]).includes(tpl.category),
        `${tpl.id} has category "${tpl.category}" outside TEMPLATE_CATEGORIES`,
      ).toBe(true);
    }
    // A declared category with zero templates would render an empty section.
    for (const cat of TEMPLATE_CATEGORIES) {
      expect(
        TEMPLATES.some((t) => t.category === cat),
        `category "${cat}" has no template`,
      ).toBe(true);
    }
    // Consolidated singletons merged into their sibling categories.
    expect(getTemplate("tpl-code-review")!.category).toBe("开发集成");
    expect(getTemplate("tpl-doc-review")!.category).toBe("办公协同");
    // Blank stays ungrouped: pinned first, never a section of its own.
    expect(BLANK_TEMPLATE.category).toBe("基础");
    expect(TEMPLATE_CATEGORIES).not.toContain("基础");
  });

  it("every javascript code-node script is syntactically valid", () => {
    // Dogfood tpl-doc-ingest shipped a code script whose string literal
    // contained a real newline (unescaped \\n in the TS source); the child
    // interpreter died with a SyntaxError and took the run down. Compile every
    // shipped script (new Function parses without executing) so a broken
    // template can never reach the engine again.
    for (const tpl of [...TEMPLATES, BLANK_TEMPLATE]) {
      for (const node of tpl.graph.nodes) {
        const code = node.kind === "code" ? node.code : undefined;
        if (!code || code.language !== "javascript") continue;
        expect(
          () => new Function(code.code ?? ""),
          `${tpl.id} node "${node.id}" ships a syntactically invalid script`,
        ).not.toThrow();
      }
    }
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

  it("every template compiles without errors", () => {
    for (const tpl of TEMPLATES) {
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

  it("customer-service webhookUrl field lands on the notify node", () => {
    const tpl = getTemplate("tpl-customer-service")!;
    const g = instantiateTemplate(tpl, {
      fieldValues: { webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test" },
    });
    const notify = g.nodes.find((n) => n.name === "通知用户")!;
    expect((notify.notify as { webhookUrl?: string }).webhookUrl).toBe(
      "https://open.feishu.cn/open-apis/bot/v2/hook/test",
    );
  });

  it("ships the four capability templates exercising search+audio, loop+search, vcs and convert+ocr", () => {
    const expectKinds = (id: string, kinds: string[]) => {
      const tpl = getTemplate(id)!;
      expect(tpl, `template ${id} should exist`).toBeTruthy();
      const present = new Set(tpl.graph.nodes.map((n) => n.kind));
      for (const k of kinds) expect(present.has(k), `${id} should contain a ${k} node`).toBe(true);
    };
    expectKinds("tpl-news-podcast", ["search", "audioGen"]);
    expectKinds("tpl-research-loop", ["loop", "search"]);
    expectKinds("tpl-release-pr", ["human", "vcs"]);
    expectKinds("tpl-scan-ocr", ["convert", "ocr"]);
  });

  it("evidence-brief template chains code split, table sort and gate rework", () => {
    const tpl = getTemplate("tpl-evidence-brief")!;
    expect(tpl, "template tpl-evidence-brief should exist").toBeTruthy();
    const byName = new Map(tpl.graph.nodes.map((n) => [n.name, n]));
    expect(byName.get("拆条编号")?.kind).toBe("code");
    expect(byName.get("时间索引")?.kind).toBe("table");
    expect(byName.get("清单起草")?.kind).toBe("textGen");
    expect(byName.get("缺口分析")?.kind).toBe("textGen");
    expect(byName.get("质检")?.kind).toBe("gate");
    // Table sorts chronologically so the catalog inherits a dated order.
    const steps = (byName.get("时间索引")!.table as { steps: { op: string; column?: string }[] }).steps;
    expect(steps.some((s) => s.op === "sort" && s.column === "date")).toBe(true);
    // Rework reruns the catalog draft, not the deterministic upstream.
    expect(tpl.graph.edges.some((e) => e.kind === "rework" && e.from === "qc" && e.to === "catalog")).toBe(true);
    // The split script must use the engine stdin contract, never a bare `inputs`.
    const code = (byName.get("拆条编号")!.code as { code: string }).code;
    expect(code).toContain("fs.readFileSync(0");
    expect(code).not.toMatch(/[^."]inputs\./);
  });

  it("expense-review template chains rule checks, anomaly table and gate rework", () => {
    const tpl = getTemplate("tpl-expense-review")!;
    expect(tpl, "template tpl-expense-review should exist").toBeTruthy();
    const byName = new Map(tpl.graph.nodes.map((n) => [n.name, n]));
    expect(byName.get("规则校验")?.kind).toBe("code");
    expect(byName.get("异常清单")?.kind).toBe("table");
    expect(byName.get("初审报告")?.kind).toBe("textGen");
    expect(byName.get("质检")?.kind).toBe("gate");
    // Anomalies surface first: sort by issue count, descending.
    const steps = (byName.get("异常清单")!.table as { steps: { op: string; column?: string; direction?: string }[] }).steps;
    expect(steps.some((s) => s.op === "sort" && s.column === "issueCount" && s.direction === "desc")).toBe(true);
    // Rework reruns the report draft, not the deterministic rule checks.
    expect(tpl.graph.edges.some((e) => e.kind === "rework" && e.from === "qc" && e.to === "report")).toBe(true);
    // Rule checks are deterministic code: the three promised anomaly families
    // must all be implemented, and via the engine stdin contract.
    const code = (byName.get("规则校验")!.code as { code: string }).code;
    expect(code).toContain("fs.readFileSync(0");
    expect(code).not.toMatch(/[^."]inputs\./);
    expect(code).toContain("单笔超");
    expect(code).toContain("重复单号");
    expect(code).toContain("日期");
    // Table nodes error on empty rows; the script must guarantee at least one row.
    expect(code).toContain("if (!rows.length)");
  });

  it("loop template's items ref is rewritten to the fresh split-node id", () => {
    const tpl = getTemplate("tpl-research-loop")!;
    const g = instantiateTemplate(tpl);
    const split = g.nodes.find((n) => n.name === "拆题")!;
    const loop = g.nodes.find((n) => n.name === "逐课题循环")!;
    const items = (loop.loop as { items: string }).items;
    // The ${split} placeholder now points at the fresh id, not the template id.
    expect(items).toBe(`\${${split.id}}`);
    expect(items).not.toContain("${split}");
  });

  it("fallible nodes route errors to a fallback instead of hard-failing the run", () => {
    // doc-ingest: OCR on a text-only PDF must fall through to an empty-text node.
    const docIngest = getTemplate("tpl-doc-ingest")!;
    expect(
      docIngest.graph.edges.some((e) => e.kind === "error" && e.from === "ocr" && e.to === "ocrFallback"),
    ).toBe(true);
    // review-publish: missing webhook must not block the human review flow.
    const reviewPublish = getTemplate("tpl-review-publish")!;
    expect(
      reviewPublish.graph.edges.some((e) => e.kind === "error" && e.from === "notify" && e.to === "notifyFallback"),
    ).toBe(true);
    // scan-ocr: text-layer PDFs cannot be page-rendered; explain instead of failing.
    const scanOcr = getTemplate("tpl-scan-ocr")!;
    expect(
      scanOcr.graph.edges.some((e) => e.kind === "error" && e.from === "pages" && e.to === "convFallback"),
    ).toBe(true);
  });

  it("translation template uses the dedicated translate node with a target language", () => {
    const g = instantiateTemplate(getTemplate("tpl-translation")!);
    const translate = g.nodes.find((n) => n.kind === "translate");
    expect(translate, "translation should use a translate node").toBeTruthy();
    expect((translate!.translate as { target: string }).target).toBeTruthy();
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

  it("rewrites branch targets to fresh ids, including forward references", () => {
    // A branch node's `rules[].target` and `defaultTarget` are bare node ids.
    // Regression guard: they reference nodes that appear LATER in the nodes
    // array (alarm/record come after judge), so id rewriting must not depend
    // on array order (the old implementation only saw already-generated ids).
    const tpl = {
      id: "tpl-branch",
      name: "branch",
      description: "branch",
      category: "基础",
      graph: {
        id: "tpl-branch",
        name: "branch",
        nodes: [
          { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
          {
            id: "judge",
            kind: "branch",
            name: "JUDGE",
            x: 1,
            y: 0,
            branch: {
              rules: [{ id: "r1", when: "${src.ok} != true", target: "alarm" }],
              defaultTarget: "record",
            },
          },
          { id: "alarm", kind: "sink", name: "ALARM", x: 2, y: 0 },
          { id: "record", kind: "sink", name: "RECORD", x: 3, y: 0 },
        ],
        edges: [
          { id: "e1", from: "src", to: "judge", kind: "flow" },
          { id: "e2", from: "judge", to: "alarm", kind: "flow" },
          { id: "e3", from: "judge", to: "record", kind: "flow" },
        ],
      },
    } as const;
    const g = instantiateTemplate(tpl as never);
    const byName = new Map(g.nodes.map((n) => [n.name, n]));
    const judge = byName.get("JUDGE")!;
    const alarmId = byName.get("ALARM")!.id;
    const recordId = byName.get("RECORD")!.id;
    const branch = judge.branch as { rules: { target: string }[]; defaultTarget: string };
    // Both the rule target and the defaultTarget resolve to the fresh ids.
    expect(branch.rules[0].target).toBe(alarmId);
    expect(branch.defaultTarget).toBe(recordId);
    // Both targets exist as real outgoing flow edges.
    const out = g.edges.filter((e) => e.from === judge.id).map((e) => e.to);
    expect(out).toContain(alarmId);
    expect(out).toContain(recordId);
  });
});
