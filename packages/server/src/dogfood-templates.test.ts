import "./load-env.js"; // must precede config.ts, which reads AGNES_API_KEY at module eval
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compile,
  instantiateTemplate,
  TEMPLATES,
  type Graph,
  type GraphTemplate,
  type RunEvent,
} from "@agent-world/core";
import { execute } from "./engine.js";
import { routingWorker } from "./providers/index.js";

/**
 * 真实供应商狗粮跑——templates-runtime.test.ts（假 worker、零成本、17/35 真执行）
 * 之外的另一半：真调 agnes、真产出、真花钱。
 *
 * 默认跳过，CI 里没有它的位置。手动跑：
 *   DOGFOOD=1 pnpm --filter @agent-world/server exec vitest run src/dogfood-templates.test.ts
 * 每条产线的产物与逐节点摘要落在 /tmp/aw-dogfood/，人工评估完把结论（run id /
 * 日期 / 命中了什么）记进 docs/template-checklist.md。
 *
 * 断言只到「产线契约」这一层：跑到 done、扇出确实并排产、择优确实是从泳道里选、
 * 净化后不含被喂进去的命中词。文案好不好看是人的判断，不在这里假装自动化。
 */

type Observed = RunEvent & { [k: string]: unknown };

const OUT_DIR = join(tmpdir(), "aw-dogfood");
/** 一次跑完两线的上限。agnes-2.0-flash 上实测单条文本产线是分级别的成本。 */
const BUDGET_USD = 0.05;

/** 投料用真实卖家会贴的需求，不是 "test"。 */
const VARIANT_COPY_BRIEF =
  "需求：304 不锈钢保温杯，500ml，杯盖可当水杯，主打通勤和自驾。卖点是 12 小时保温、杯口防漏、" +
  "杯身能放进车载杯架。目标人群是每天开车上下班的 30-45 岁人。投放平台：小红书信息流。" +
  "希望突出「早上灌的热水晚上还烫嘴」，不要浮夸。";

const COMPLIANCE_BRIEF =
  "【待上架文案】这款除螨喷雾是目前市面上最好的除螨产品，100% 根治螨虫，业内第一，" +
  "纯植物配方绝对安全，孕妇小孩都可以放心用，效果永不过期，三天见效，无效全额退款。";

/** 与模板 extraBanned 对齐的绝对化用语——投料里每一条都踩。 */
const BANNED = ["最好的", "第一", "顶级", "绝对", "国家级", "100%", "根治", "永不过期"];

function byType(events: Observed[], type: RunEvent["type"]): Observed[] {
  return events.filter((e) => e.type === type);
}

function artifacts(events: Observed[]): Array<{ nodeId: string; variant?: string; kind: string; content: string }> {
  return byType(events, "artifact.produced")
    .map((e) => {
      const a = (e as { artifact?: { content?: string; kind?: string } }).artifact;
      return {
        nodeId: String(e.nodeId),
        variant: (e as { variant?: string }).variant,
        kind: a?.kind ?? "unknown",
        content: a?.content ?? "",
      };
    })
    .filter((a) => a.content.length > 0);
}

function describeRun(id: string, graph: Graph, events: Observed[]): string {
  const lines: string[] = [`\n===== ${id} =====`];
  for (const n of graph.nodes) lines.push(`  node ${n.id} (${n.kind})`);
  for (const e of events) {
    switch (e.type) {
      case "node.finished":
        lines.push(`  finished  ${e.nodeId} $${Number((e as { usage?: { costUsd?: number } }).usage?.costUsd ?? 0).toFixed(6)}`);
        break;
      case "node.failed":
        lines.push(`  FAILED    ${e.nodeId} ${String(e.error)}`);
        break;
      case "node.degraded":
        lines.push(`  degraded  ${e.nodeId} ${String(e.reason)}`);
        break;
      case "variants.spawned":
        lines.push(`  spawned   ${(e as { variantIds?: string[] }).variantIds?.join(", ")}`);
        break;
      case "variants.ranked": {
        const r = (e as { ranking?: Array<{ variant: string; score: number }> }).ranking ?? [];
        lines.push(
          `  ranked    ${r.map((x) => `${x.variant}=${x.score}`).join(" ")} → chosen ${(e as { chosen?: string[] }).chosen?.join(",")}`,
        );
        break;
      }
      case "gate.verdict":
        lines.push(`  gate      ${e.nodeId} passed=${String(e.passed)} score=${String((e as { score?: number }).score)} ${String(e.reason).slice(0, 200)}`);
        break;
      case "run.finished":
        lines.push(`  run       ${e.status}${e.reason ? ` — ${e.reason}` : ""}`);
        break;
      default:
        break;
    }
  }
  for (const a of artifacts(events)) {
    lines.push(`  artifact  ${a.nodeId}${a.variant ? `.${a.variant}` : ""} ${a.content.length} 字`);
  }
  return lines.join("\n");
}

async function runLine(tpl: GraphTemplate, input: string): Promise<Observed[]> {
  const graph = instantiateTemplate(tpl);
  const { plan, diagnostics } = compile(graph);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors, `${tpl.id} compile 有 error: ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
  expect(plan, `${tpl.id} 没有可执行计划`).not.toBeNull();

  mkdirSync(OUT_DIR, { recursive: true });
  const events: Observed[] = [];
  // One node can emit several artifacts.produced events (compliance emits a json
  // hit report *and* the sanitized text), so the readback name needs an ordinal
  // per (node, variant) — `<node>.txt` silently overwrote the first one.
  const seen = new Map<string, number>();
  for await (const raw of execute({
    runId: `dogfood-${tpl.id}`,
    graph,
    plan: plan!,
    worker: routingWorker(),
    budgetUsd: BUDGET_USD,
    input,
  })) {
    const e = raw as Observed;
    events.push(e);
    for (const a of artifacts([e])) {
      const lane = a.variant ? `.${a.variant}` : "";
      const key = `${tpl.id}--${a.nodeId}${lane}.${a.kind}`;
      const nth = (seen.get(key) ?? 0) + 1;
      seen.set(key, nth);
      // The ordinal is always present so a second artifact can't overwrite the
      // first, and single-artifact nodes still read predictably.
      writeFileSync(join(OUT_DIR, `${key}.${nth}.txt`), a.content, "utf8");
    }
  }
  const metered = byType(events, "power.metered").at(-1);
  console.log(`${describeRun(tpl.id, graph, events)}\n  total     $${Number((metered as { totalCostUsd?: number } | undefined)?.totalCostUsd ?? 0).toFixed(6)} → ${OUT_DIR}`);
  return events;
}

function template(id: string): GraphTemplate {
  const tpl = TEMPLATES.find((t) => t.id === id);
  expect(tpl, `${id} 不在注册表里`).toBeDefined();
  return tpl!;
}

describe("template dogfood · real provider (set DOGFOOD=1)", () => {
  const on = !!process.env.DOGFOOD;

  it.skipIf(!on)("variant-copy: three lanes, one of them chosen", async () => {
    const events = await runLine(template("tpl-variant-copy"), VARIANT_COPY_BRIEF);

    expect(byType(events, "node.failed")).toHaveLength(0);
    const finished = byType(events, "run.finished")[0];
    expect(finished?.status, `停在 ${JSON.stringify(finished?.reason ?? null)}`).toBe("done");

    const lanes = artifacts(events).filter((a) => a.variant);
    expect(lanes.length, "三条泳道都该各自成稿").toBeGreaterThanOrEqual(3);
    const ranked = byType(events, "variants.ranked")[0] as
      | { chosen?: string[]; ranking?: Array<{ variant: string; score: number }> }
      | undefined;
    expect(ranked?.ranking?.length, "择优没有产出排名").toBeGreaterThanOrEqual(3);
    // 入库的那条必须是某条泳道的原文，不能是 select 又新写了一段。
    const stored = artifacts(events).at(-1)!;
    expect(lanes.map((l) => l.content), "入库稿不在任何泳道里").toContain(stored.content);
    expect(stored.content.length).toBeLessThanOrEqual(400);
  }, 10 * 60_000);

  it.skipIf(!on)("compliance-precheck: fed absolutes, ships none of them", async () => {
    const events = await runLine(template("tpl-compliance-precheck"), COMPLIANCE_BRIEF);

    const failures = byType(events, "node.failed");
    const finished = byType(events, "run.finished")[0];
    const gate = byType(events, "gate.verdict").at(-1) as { passed?: boolean; reason?: string } | undefined;
    const precheck = artifacts(events)[0]?.content ?? "";
    console.log(`  预检净化稿前 200 字：${precheck.slice(0, 200)}`);
    console.log(`  质检判定：passed=${String(gate?.passed)} reason=${String(gate?.reason ?? "").slice(0, 200)}`);

    expect(failures, failures.map((f) => `${f.nodeId}: ${String(f.error)}`).join("; ")).toHaveLength(0);
    expect(finished?.status, `停在 ${JSON.stringify(finished?.reason ?? null)}`).toBe("done");
    const shipped = artifacts(events).at(-1)!.content;
    expect(BANNED.filter((w) => shipped.includes(w)), `上架稿仍含命中词：\n${shipped}`).toEqual([]);
    // 净化是这模板的全部价值：原文卖点得留着，不能改成一句空话。
    expect(shipped.length).toBeGreaterThan(40);
  }, 10 * 60_000);
});
