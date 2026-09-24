import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compile,
  instantiateTemplate,
  TEMPLATES,
  type Graph,
  type GraphTemplate,
} from "@agent-world/core";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

/**
 * Runtime-level template smoke — the gate that was missing.
 *
 * Before this a template was only ever checked by `compile()`, which accepts
 * graphs the engine then refuses to run. Two such cases surfaced while writing
 * it: a `fanout` with no downstream `select` compiles clean and fails VALIDATION
 * the first time a user opens the line, and a preset `product` connector answers
 * CONNECTOR unless the server has store support.
 *
 * Two tiers, no provider key and no spend:
 *  1. Invariants the engine enforces at run time and `compile()` does not, over
 *     every template.
 *  2. Real execution against the deterministic fake worker, over every template
 *     that stays in-process. Upload lines are fed genuine docx fixtures (a human
 *     picks those files at dispatch, and `parseDocument` only accepts
 *     PDF/Office formats); approval lines are held to their halt contract — gate
 *     reached and still open, everything upstream finished, nothing downstream
 *     started. `REQUIRES_EXTERNAL_IO` must equal the derived exclusion set, so a
 *     reason that has expired fails the same way a missing registration does.
 *
 * In-process kinds: textGen / imageGen / videoGen / audioGen / gate (fake
 * worker), code (JavaScript only), table / map / loop / branch / parallel /
 * fanout / select (engine), source / sink / fileParse (wiring + fixtures).
 * `ocr` stays out: it shells out to tesseract, which this environment lacks.
 */

/** Node kinds whose handler reaches the network, a paid API, or a binary this
 *  test environment does not have. `fileParse` is deliberately absent: the
 *  document it needs is fixture-suppliable (see DOC_FIXTURE below). */
const OFF_LIMITS_KINDS = new Set([
  "http",
  "ocr",
  "convert",
  "search",
  "vcs",
  "notify",
  "translate",
  "subprocess",
  "database",
  "email",
]);

/** Why a template cannot run in-process, or null when it can. A non-file
 *  connector counts as external (a product connector needs the store backend);
 *  a file connector does not, because the fixture satisfies it. */
function needsOutsideWorld(tpl: GraphTemplate): string | null {
  for (const n of tpl.graph.nodes) {
    if (OFF_LIMITS_KINDS.has(n.kind)) return `节点 kind ${n.kind}`;
    const type = (n as { source?: { connector?: { type?: string } } }).source?.connector?.type;
    if (type && type !== "file") return `source 预设 ${type} 连接器`;
  }
  return null;
}

/** Registry of non-executed templates, kept honest by the reconciliation test. */
const REQUIRES_EXTERNAL_IO: Record<string, string> = {
  "tpl-product": "source 预设 product 连接器（需服务端商品库）",
  "tpl-xiaohongshu": "source 预设 product 连接器（需服务端商品库）",
  "tpl-translation": "节点 kind translate",
  "tpl-ops-weekly": "节点 kind http",
  "tpl-patrol-alert": "节点 kind http",
  "tpl-research-brief": "节点 kind http",
  "tpl-competitor-watch": "节点 kind http",
  "tpl-doc-ingest": "节点 kind http + ocr",
  "tpl-review-publish": "节点 kind notify",
  "tpl-news-podcast": "节点 kind search",
  "tpl-research-loop": "节点 kind search",
  "tpl-release-pr": "节点 kind vcs",
  "tpl-scan-ocr": "节点 kind http + ocr + convert",
  "tpl-customer-service": "节点 kind notify",
  "tpl-code-review": "节点 kind http",
  "tpl-data-report": "节点 kind http",
  "tpl-travel-plan": "节点 kind http",
  "tpl-invoice-ocr": "节点 kind ocr（本机无 tesseract 二进制）",
};

const EXECUTABLE = TEMPLATES.filter((t) => !needsOutsideWorld(t));

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** `parseDocument` accepts only PDF/DOCX/PPTX/XLSX (magic bytes + mime hint),
 *  so the stand-in has to be a real docx, not a text file. */
function docx(paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`;
  return zipSync({ "word/document.xml": strToU8(xml) });
}

let fixtureDir = "";
/** Two documents: the batch-review and due-diligence lines parse every uploaded
 *  file, so handing them one would leave the multi-doc path untested. */
let fixtures: string[] = [];

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "aw-tpl-smoke-"));
  const contract = join(fixtureDir, "service-contract.docx");
  const declaration = join(fixtureDir, "asset-declaration.docx");
  writeFileSync(
    contract,
    docx([
      "服务合同  甲方：示例科技有限公司  乙方：远洋网络服务有限公司",
      "第一条 服务范围：乙方为甲方提供产线编排平台的部署与运维服务。",
      "第二条 服务期 12 个月，年度服务费 12 万元人民币，逾期按日 0.05% 计违约金。",
      "第三条 数据安全：乙方不得将甲方数据用于训练或对外披露，合同终止后 30 日内删除。",
      "第四条 争议解决：提交甲方所在地仲裁委员会仲裁，本合同自双方盖章之日起生效。",
    ]),
  );
  writeFileSync(
    declaration,
    docx([
      "资产申报表  申报主体：示例科技有限公司  申报基准日：2026-06-30",
      "货币资金 320 万元；应收账款 150 万元（账龄一年内）；固定资产 88 万元。",
      "对外担保：无为关联方提供担保。重大诉讼：无。",
      "声明：以上信息真实完整，如有隐瞒愿承担相应责任。",
    ]),
  );
  fixtures = [contract, declaration];
});

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

/** Templates that consume uploaded documents: either an explicit fileParse node
 *  or a source wired to the file connector. */
function needsDocFixture(tpl: GraphTemplate): boolean {
  return tpl.graph.nodes.some(
    (n) =>
      n.kind === "fileParse" ||
      (n as { source?: { connector?: { type?: string } } }).source?.connector?.type === "file",
  );
}

/** Ids reachable downstream of `fromIds`, used to scope the human-halt check. */
function descendantsOf(graph: Graph, fromIds: string[]): Set<string> {
  const out = new Set<string>();
  const stack = [...fromIds];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges.filter((x) => x.from === cur)) {
      if (out.has(e.to)) continue;
      out.add(e.to);
      stack.push(e.to);
    }
  }
  return out;
}

// ─── tier 1: invariants the engine enforces and compile() does not ───────────

describe("templates · runtime invariants", () => {
  const downstream = (graph: Graph, id: string) =>
    graph.edges.filter((e) => e.from === id).map((e) => e.to);

  const reaches = (graph: Graph, from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...downstream(graph, cur));
    }
    return false;
  };

  it("the exclusion list and the derived set are the same set", () => {
    const derived = new Map<string, string>();
    for (const t of TEMPLATES) {
      const why = needsOutsideWorld(t);
      if (why) derived.set(t.id, why);
    }
    const listed = new Set(Object.keys(REQUIRES_EXTERNAL_IO));

    const problems: string[] = [];
    const missing = [...derived.keys()].filter((id) => !listed.has(id));
    const stale = [...listed].filter((id) => !derived.has(id));

    if (missing.length) {
      problems.push(
        `需要外部世界却没登记: ${missing.map((id) => `${id}(${derived.get(id)})`).join(", ")}`,
      );
    }
    if (stale.length) {
      problems.push(`排除表过期，这些已可执行，请删条目并让它进 tier 2: ${stale.join(", ")}`);
    }

    expect(problems).toEqual([]);
  });

  it("every fanout has a select downstream and every select a fanout upstream", () => {
    // nodes/fanout.ts and nodes/select.ts fail their node with VALIDATION when
    // the other half is absent, and compile() reports nothing about it.
    for (const tpl of TEMPLATES) {
      const g = tpl.graph;
      for (const n of g.nodes) {
        if (n.kind === "fanout") {
          const paired = g.nodes.some((m) => m.kind === "select" && reaches(g, n.id, m.id));
          expect(paired, `${tpl.id}: fanout ${n.id} 没有下游 select，运行期必失败`).toBe(true);
        }
        if (n.kind === "select") {
          const paired = g.nodes.some((m) => m.kind === "fanout" && reaches(g, m.id, n.id));
          expect(paired, `${tpl.id}: select ${n.id} 没有上游 fanout，运行期必失败`).toBe(true);
        }
      }
    }
  });

  it("strategy=prompt supplies one non-blank prompt per lane", () => {
    // buildVariantParams drops a missing prompt, and applyVariantConfig
    // replaces the lane prompt rather than appending, so a short list leaves
    // some lanes with no instruction at all while the run still "succeeds".
    for (const tpl of TEMPLATES) {
      for (const n of tpl.graph.nodes) {
        const cfg = n.fanout as
          | { count?: number; strategy?: string; prompts?: string[] }
          | undefined;
        if (!cfg || cfg.strategy !== "prompt") continue;
        expect(cfg.prompts, `${tpl.id}/${n.id}: prompt 策略需要 prompts`).toBeTruthy();
        expect(cfg.prompts, `${tpl.id}/${n.id}: prompts 条数须等于 count`).toHaveLength(cfg.count);
        for (const [i, p] of (cfg.prompts ?? []).entries()) {
          expect(
            p?.trim().length,
            `${tpl.id}/${n.id}: 第 ${i + 1} 条变体 prompt 为空`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});

// ─── tier 2: actual execution against the fake worker ────────────────────────

interface ObservedEvent {
  type: string;
  nodeId?: string;
  status?: string;
  error?: string;
  errorCode?: string;
}

async function runTemplate(tpl: GraphTemplate): Promise<{ graph: Graph; events: ObservedEvent[] }> {
  const graph = instantiateTemplate(tpl) as Graph;

  // Upload lines ship with an empty file source on purpose — a human picks the
  // documents at dispatch. Substituting the upload is what lets their whole
  // parse → write → gate chain run here without a browser.
  if (needsDocFixture(tpl)) {
    for (const n of graph.nodes) {
      const src = (n as { source?: { connector?: unknown; files?: unknown[] } }).source;
      if (!src) continue;
      delete src.connector;
      src.files = fixtures.map((p, i) => ({
        uri: `file://${p}`,
        label: `文档${i + 1}`,
        mimeType: DOCX_MIME,
        sizeBytes: readFileSync(p).byteLength,
      }));
    }
  }

  const { plan, diagnostics } = compile(graph);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(
    errors,
    `${tpl.id} compile 有 error: ${errors.map((e) => e.message).join("; ")}`,
  ).toHaveLength(0);
  expect(plan, `${tpl.id} 没有可执行计划`).not.toBeNull();

  const events: ObservedEvent[] = [];
  const stream = execute({
    runId: `smoke-${tpl.id}`,
    graph,
    plan: plan!,
    worker: fakeWorker({ chunkDelayMs: 0 }),
    budgetUsd: null,
    input: "冒烟输入：一段足够长的原料文本，供下游节点取用。",
    now: () => 0,
    sleep: async () => {},
    // Stands in for the artifact store: fileParse asks readArtifact to turn a
    // file uri into the `data:<mime>;base64,…` form it then parses.
    readArtifact: async (uri: string) =>
      uri.startsWith("file://")
        ? `data:${DOCX_MIME};base64,${readFileSync(uri.slice(7)).toString("base64")}`
        : null,
  }) as unknown as AsyncIterable<ObservedEvent>;

  for await (const e of stream) events.push(e);
  return { graph, events };
}

describe("templates · executed against the fake worker", () => {
  it("keeps a real share of the registry under execution", () => {
    // Anti-collapse guard: this must not quietly shrink back to a token few.
    expect(EXECUTABLE.length).toBeGreaterThanOrEqual(15);
  });

  for (const tpl of EXECUTABLE) {
    const humanTemplateIds = tpl.graph.nodes.filter((n) => n.kind === "human").map((n) => n.id);
    const halts = humanTemplateIds.length > 0;

    it(
      `${tpl.id} ${halts ? "halts at its human gate with everything upstream finished" : "runs to done with artifacts and no failed node"}`,
      async () => {
        const { graph, events } = await runTemplate(tpl);

        const failures = events.filter((e) => e.type === "node.failed");
        expect(
          failures,
          `${tpl.id} 节点失败: ${failures.map((f) => `[${f.errorCode}] ${f.error}`).join(" | ")}`,
        ).toHaveLength(0);

        const runDone = events.find((e) => e.type === "run.finished");
        expect(
          runDone,
          `${tpl.id} 没有 run.finished；末尾事件: ${events
            .slice(-6)
            .map((e) => e.type)
            .join(" → ")}`,
        ).toBeTruthy();
        expect(runDone!.status).toBe(halts ? "halted" : "done");

        // Asserted against instantiated ids: instantiateTemplate suffixes every
        // node id, so the template's own ids never appear in the event stream.
        const startedIds = new Set(
          events.filter((e) => e.type === "node.started").map((e) => e.nodeId),
        );
        const finishedIds = new Set(
          events.filter((e) => e.type === "node.finished").map((e) => e.nodeId),
        );

        if (halts) {
          // The approval gate is where the run stops on purpose: it must be
          // reached and stay open, nothing past it may have run, and everything
          // before it must have completed. Matched by kind because
          // instantiateTemplate rewrites ids but never the kind.
          const parked = graph.nodes.filter((n) => n.kind === "human");
          expect(parked.length, `${tpl.id} 实例化后 human 节点数变了`).toBe(humanTemplateIds.length);
          for (const h of parked) {
            expect(startedIds.has(h.id), `${tpl.id} human 节点 ${h.id} 未被到达`).toBe(true);
            expect(finishedIds.has(h.id), `${tpl.id} human 节点 ${h.id} 不该自行通过`).toBe(false);
          }
          const pastGate = descendantsOf(
            graph,
            parked.map((h) => h.id),
          );
          const gateIds = new Set(parked.map((h) => h.id));
          for (const n of graph.nodes) {
            if (gateIds.has(n.id)) continue;
            if (pastGate.has(n.id)) {
              expect(
                startedIds.has(n.id),
                `${tpl.id} 审批之后的 ${n.id}(${n.kind}) 不该已经启动`,
              ).toBe(false);
            } else {
              expect(
                finishedIds.has(n.id),
                `${tpl.id} 审批之前的 ${n.id}(${n.kind}) 未完成`,
              ).toBe(true);
            }
          }
        } else {
          for (const n of graph.nodes) {
            expect(finishedIds.has(n.id), `${tpl.id} 节点 ${n.id}(${n.kind}) 从未完成`).toBe(true);
          }
        }

        expect(events.some((e) => e.type === "artifact.produced"), `${tpl.id} 没有任何产物`).toBe(
          true,
        );
      },
      60_000,
    );
  }
});
