import { describe, expect, it } from "vitest";
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
 *     that stays in-process. `REQUIRES_EXTERNAL_IO` must equal the derived
 *     exclusion set, so an entry whose reason has expired fails the same way a
 *     missing one does — the list cannot rot in either direction.
 *
 * In-process kinds: textGen / imageGen / videoGen / audioGen / gate (fake
 * worker), code (JavaScript only), table / map / loop / branch / parallel /
 * fanout / select (engine), source / sink (wiring).
 */

/** Node kinds whose handler reaches the network, a file, or a paid API. */
const OFF_LIMITS_KINDS = new Set([
  "http",
  "fileParse",
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

/** Why a template cannot run in-process, or null when it can. A preset
 *  connector counts as external: there is no product store behind it in tests. */
function needsOutsideWorld(tpl: GraphTemplate): string | null {
  for (const n of tpl.graph.nodes) {
    if (OFF_LIMITS_KINDS.has(n.kind)) return `节点 kind ${n.kind}`;
    const connector = (n as { source?: { connector?: { type?: string } } }).source?.connector?.type;
    if (connector) return `source 预设 ${connector} 连接器`;
  }
  return null;
}

/** Registry of non-executed templates, kept honest by the reconciliation test. */
const REQUIRES_EXTERNAL_IO: Record<string, string> = {
  "tpl-product": "source 预设 product 连接器",
  "tpl-xiaohongshu": "source 预设 product 连接器",
  "tpl-translation": "节点 kind translate",
  "tpl-ops-weekly": "节点 kind http",
  "tpl-patrol-alert": "节点 kind http",
  "tpl-research-brief": "节点 kind http",
  "tpl-competitor-watch": "节点 kind http",
  "tpl-doc-ingest": "节点 kind fileParse",
  "tpl-review-publish": "节点 kind notify",
  "tpl-news-podcast": "节点 kind search",
  "tpl-research-loop": "节点 kind search",
  "tpl-release-pr": "节点 kind vcs",
  "tpl-scan-ocr": "节点 kind ocr",
  "tpl-customer-service": "节点 kind notify",
  "tpl-code-review": "节点 kind http",
  "tpl-data-report": "节点 kind http",
  "tpl-contract-review": "节点 kind fileParse",
  "tpl-travel-plan": "节点 kind http",
  "tpl-privacy-review": "节点 kind fileParse",
  "tpl-invoice-ocr": "节点 kind ocr",
  "tpl-batch-contract-review": "source 预设 file 连接器",
  "tpl-due-diligence": "节点 kind fileParse",
};

const EXECUTABLE = TEMPLATES.filter((t) => !needsOutsideWorld(t));

/** A human gate parks the run mid-flight; approving it here would test the
 *  resume path rather than the template, so those stay out of tier 2. */
const HUMAN_IN_PATH = new Set(
  EXECUTABLE.filter((t) => t.graph.nodes.some((n) => n.kind === "human")).map((t) => t.id),
);

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
  }) as unknown as AsyncIterable<ObservedEvent>;

  for await (const e of stream) events.push(e);
  return { graph, events };
}

describe("templates · executed against the fake worker", () => {
  const toRun = EXECUTABLE.filter((t) => !HUMAN_IN_PATH.has(t.id));

  it("keeps a real share of the registry under execution", () => {
    // Anti-collapse guard: tier 2 must not quietly shrink to a token few.
    expect(toRun.length).toBeGreaterThanOrEqual(Math.floor(TEMPLATES.length / 3));
  });

  for (const tpl of toRun) {
    it(`${tpl.id} runs to done with artifacts and no failed node`, async () => {
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
      expect(runDone!.status).toBe("done");

      // Asserted against the instantiated ids: instantiateTemplate suffixes
      // every node id, so the template's own ids never appear in the stream.
      const finishedIds = new Set(
        events.filter((e) => e.type === "node.finished").map((e) => e.nodeId),
      );
      for (const n of graph.nodes) {
        expect(finishedIds.has(n.id), `${tpl.id} 节点 ${n.id}(${n.kind}) 从未完成`).toBe(true);
      }

      expect(events.some((e) => e.type === "artifact.produced"), `${tpl.id} 没有任何产物`).toBe(
        true,
      );
    }, 60_000);
  }
});
