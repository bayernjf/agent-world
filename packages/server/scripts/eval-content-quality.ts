/**
 * Content-pipeline quality evaluation (D9-1 route B: judge-based e2e regression).
 *
 * The offline eval suites in zeus score deterministic orchestration with
 * scripted agents; they cannot judge whether a real model's content output is
 * any good. This tool closes that gap by sending representative content
 * samples to the hub's general text model (the `text` alias, served from the
 * Coding Plan data plane — no PAYG spend) and scoring each against a fixed
 * rubric at temperature 0 with a JSON-only contract.
 *
 * Design contracts:
 * - Warn-severity by default: a below-bar score is reported but never fails a
 *   build. `--strict` turns a below-bar score into a non-zero exit (for an
 *   operator who wants a real gate once scores are calibrated).
 * - Fail-soft: hub unconfigured, alias unresolved, transport/timeout or
 *   unparseable output records `verdict: "unavailable"` with a reason and the
 *   run still exits 0 (unless --strict, where an unavailable judge also fails,
 *   because a strict gate cannot prove quality without a score).
 * - Built-in samples give the run reproducible inputs without needing a live
 *   agent-world run or its session auth; `--artifact <file>` scores a real
 *   run's produced text instead (one file per call, plain text or JSON with a
 *   top-level `content` string).
 *
 * Usage:
 *   MODEL_HUB_URL=http://127.0.0.1:8791 \
 *   MODEL_HUB_TOKEN=mh_... \
 *   pnpm --filter @agent-world/server exec tsx scripts/eval-content-quality.ts [--artifact=path.txt] [--strict] [--json]
 *
 * MODEL_HUB_CACHE_PATH is optional and defaults to a file under the OS temp
 * dir so no projection cache is written into the repo.
 */
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelKit } from "@model-hub/model-kit";

const MIN_SCORE = 0.7;
const JUDGE_ALIAS = "text";
// Scoring calls go to a reasoning model and routinely take ~20s while it
// thinks across four rubric dimensions; observed jitter can push a healthy
// call past 60s, so give each judgement 90s. A timeout still degrades
// fail-soft rather than crashing the run.
const TIMEOUT_MS = 90_000;

/** Fixed rubric so two runs of the same content prompt identically. */
const RUBRIC = [
  "Score the quality of a Chinese e-commerce content draft on a 0-1 scale against four equally weighted dimensions:",
  "1. Evidence grounding: concrete product/source facts, not generic boilerplate or unsupported claims.",
  "2. Structure: a clear, complete content structure (opening, body, call to action where relevant).",
  "3. Compliance: no banned/hype expressions, no fabricated specifics (prices, certifications, promises).",
  "4. Language: fluent, on-topic Chinese with no filler or broken sentences.",
  'Reply with one JSON object and nothing else: {"score": <number 0-1>, "reason": "<short Chinese justification>"}.',
].join("\n");

interface Sample {
  id: string;
  note: string;
  content: string;
  /** Expected direction, used only to report whether the judge discriminates;
   *  never sent to the model. */
  expect: "high" | "low";
}

const BUILT_IN_SAMPLES: Sample[] = [
  {
    id: "sample/grounded-product-copy",
    note: "structured, fact-bearing product copy — expected high",
    expect: "high",
    content: [
      "【产品亮点】这款保温杯采用 316 不锈钢内胆，容量 500ml，支持 12 小时保温。",
      "【适用场景】通勤、户外与办公场景均适用，杯身直径适配常见车载杯架。",
      "【使用提示】首次使用前请用温水清洗，避免装入碳酸饮料。",
      "【行动建议】点击商品详情页查看规格与售后政策，按需选择颜色。",
    ].join("\n"),
  },
  {
    id: "sample/generic-boilerplate",
    note: "vague boilerplate with no facts — expected low",
    expect: "low",
    content:
      "这个东西非常好，质量很棒，大家都说不错，用起来很方便，强烈推荐购买，错过就没有了，赶快下单吧，真的很好，非常不错。",
  },
];

type Verdict =
  | { ok: true; score: number; reason: string }
  | { ok: false; reason: string };

function parseVerdict(raw: string): Verdict {
  if (!raw) return { ok: false, reason: "empty judge output" };
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, reason: "no JSON object in judge output" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "judge output was not valid JSON" };
  }
  const score = (parsed as Record<string, unknown>).score;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
    return { ok: false, reason: "judge score missing or outside 0..1" };
  }
  const reason = (parsed as Record<string, unknown>).reason;
  return { ok: true, score, reason: typeof reason === "string" ? reason : "" };
}

function loadSamples(): Sample[] {
  const artifact = process.argv.find((a) => a.startsWith("--artifact="))?.slice("--artifact=".length);
  if (!artifact) return BUILT_IN_SAMPLES;
  if (!existsSync(artifact)) throw new Error(`artifact not found: ${artifact}`);
  const raw = readFileSync(artifact, "utf8");
  let content = raw;
  try {
    const parsed = JSON.parse(raw) as { content?: unknown };
    if (typeof parsed.content === "string") content = parsed.content;
  } catch {
    // plain-text artifact: use the file body as-is
  }
  return [{ id: `artifact/${artifact.split("/").pop()}`, note: "real run artifact", expect: "high", content }];
}

async function main(): Promise<number> {
  const strict = process.argv.includes("--strict");
  const jsonOut = process.argv.includes("--json");
  const hubUrl = process.env.MODEL_HUB_URL?.trim();
  const token = process.env.MODEL_HUB_TOKEN?.trim();
  const samples = loadSamples();

  if (!hubUrl || !token) {
    const result = {
      ok: false,
      reason: "MODEL_HUB_URL/MODEL_HUB_TOKEN missing — judge unavailable, all samples fail-soft",
      samples: samples.map((s) => ({ id: s.id, verdict: "unavailable" })),
    };
    if (jsonOut) console.log(JSON.stringify(result, null, 2));
    else console.warn(`eval-content-quality: ${result.reason}`);
    return strict ? 1 : 0;
  }

  const kit = await new ModelKit({
    hubUrl,
    token,
    // Default to the OS temp dir so repeated eval runs never leave a cache
    // inside the repo (the data/ dir is not git-ignored wholesale); callers
    // can still pin MODEL_HUB_CACHE_PATH to share one projection.
    cachePath: process.env.MODEL_HUB_CACHE_PATH ?? join(tmpdir(), "aw-content-eval-cache.json"),
  }).init();

  const findings: Array<{ id: string; expect: string; pass: boolean; detail: string }> = [];
  let unavailable = 0;
  for (const sample of samples) {
    let verdict: Verdict;
    try {
      const result = await kit.chat(
        JUDGE_ALIAS,
        [
          { role: "system", content: RUBRIC },
          { role: "user", content: `待评分文案：\n${sample.content}` },
        ],
        { temperature: 0, maxTokens: 400, signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      verdict = parseVerdict(result.content);
    } catch (error) {
      verdict = { ok: false, reason: `judge call failed: ${error instanceof Error ? error.message : String(error)}` };
    }

    if (!verdict.ok) {
      unavailable += 1;
      findings.push({ id: sample.id, expect: sample.expect, pass: false, detail: `unavailable: ${verdict.reason}` });
      continue;
    }
    const pass = verdict.score >= MIN_SCORE;
    findings.push({ id: sample.id, expect: sample.expect, pass, detail: `score ${verdict.score.toFixed(2)} vs min ${MIN_SCORE}: ${verdict.reason}` });
  }

  // Discrimination check on the built-in pair: the grounded sample must
  // outscore the boilerplate, otherwise the rubric/model has no usable
  // signal. Only meaningful when both got a real score.
  const byId = new Map(findings.map((f) => [f.id, f]));
  let discrimination: "n/a" | "ok" | "failed" = "n/a";
  const usingBuiltIns = !process.argv.some((a) => a.startsWith("--artifact="));
  if (usingBuiltIns) {
    const high = byId.get("sample/grounded-product-copy");
    const low = byId.get("sample/generic-boilerplate");
    if (high && low && !high.detail.startsWith("unavailable") && !low.detail.startsWith("unavailable")) {
      const scoreOf = (detail: string): number => Number(detail.match(/score (\d\.\d+)/)?.[1] ?? "NaN");
      const highScore = scoreOf(high.detail);
      const lowScore = scoreOf(low.detail);
      discrimination = Number.isFinite(highScore) && Number.isFinite(lowScore) && highScore > lowScore ? "ok" : "failed";
    }
  }

  const belowBar = findings.filter((f) => !f.pass && !f.detail.startsWith("unavailable")).length;
  const summary = {
    judgeAlias: JUDGE_ALIAS,
    minScore: MIN_SCORE,
    total: samples.length,
    unavailable,
    belowBar,
    discrimination,
    samples: findings,
  };
  if (jsonOut) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`content-quality eval: ${samples.length - unavailable}/${samples.length} scored, ${belowBar} below ${MIN_SCORE}, ${unavailable} unavailable, discrimination ${discrimination}`);
    for (const f of findings) console.log(`  ${f.pass ? "PASS" : "WARN"}  ${f.id}  [expect ${f.expect}]  ${f.detail}`);
  }
  // Strict gating semantics differ by mode:
  // - built-in samples exist to prove discrimination, and the boilerplate one
  //   is *supposed* to score low, so only a broken judge (unavailable) or a
  //   failed ordering (discrimination=failed) fails the run;
  // - --artifact mode is a real quality gate, so any below-bar or unavailable
  //   verdict fails.
  if (!strict) return 0;
  if (unavailable > 0 || discrimination === "failed") return 1;
  if (usingBuiltIns) return 0;
  return belowBar > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(`eval-content-quality aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
