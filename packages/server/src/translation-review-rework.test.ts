import { getTemplate, instantiateTemplate, compile, type Usage } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import type { AgentChunk, Worker } from "./worker.js";

const USAGE: Usage = { tokensIn: 10, tokensOut: 5, costUsd: 0.001 };

async function drain(gen: AsyncGenerator<unknown, void, unknown>) {
  const out: unknown[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

// Regression for the translation pipeline halting in production: on a gate
// rework back to the translate node, the review node lost the English source
// (its only flow predecessor was translate), mistook the Chinese draft for the
// "source", and asked "where is the initial translation?", which the QC gate
// judged as VALIDATION halt. The template now adds an intake->review edge so the
// reviewer always sees BOTH the source and the draft — including after rework,
// because re-translation resets only translate and its descendants, while the
// intake node keeps its artifact.
describe("translation pipeline review context across gate rework", () => {
  it("feeds the reviewer both the original source and the draft on every attempt", async () => {
    const g = instantiateTemplate(getTemplate("tpl-translation")!);
    const EN_SOURCE = "EN_SOURCE Weekly digital marketing report: paid social ROI reached 2.8x in Q3.";

    const reviewInputs: Array<{ attempt: number; input: string }> = [];
    let judgeCalls = 0;

    const worker: Worker = {
      // One runTextGen serves both the dedicated translate node (kind
      // "translate") and the textGen review node; dispatch on node.kind.
      async *runTextGen({ node, input, attempt }): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        yield { type: "text-delta", text: "x" };
        if (node.kind === "translate") {
          // Fresh Chinese draft each translation attempt.
          return { output: `ZH_DRAFT#${attempt} 每周数字营销报告`, usage: USAGE };
        }
        // kind === "textGen" -> the review (校对) node.
        reviewInputs.push({ attempt, input: input ?? "" });
        return { output: `ZH_FINAL#${attempt} 修订定稿译文`, usage: USAGE };
      },
      // First QC verdict rejects (triggers one rework back to translate),
      // second verdict passes.
      async judge() {
        judgeCalls += 1;
        return judgeCalls === 1
          ? { passed: false, reason: "译文有漏译，退回重译" }
          : { passed: true, reason: "ok" };
      },
    } as Worker;

    const events = (await drain(
      execute({
        runId: "r",
        graph: g,
        plan: compile(g)!.plan!,
        worker,
        budgetUsd: null,
        now: () => 0,
        input: EN_SOURCE,
      }),
    )) as any[];

    // One rework happened: the reviewer ran on the first pass and again after
    // re-translation.
    expect(reviewInputs.length).toBe(2);
    for (const seen of reviewInputs) {
      // The reviewer must always have BOTH the English source and the Chinese
      // draft. Before the fix the source never reached review at all.
      expect(seen.input, `review attempt ${seen.attempt} missing source`).toContain("EN_SOURCE");
      expect(seen.input, `review attempt ${seen.attempt} missing draft`).toContain("ZH_DRAFT");
    }
    // Core regression: the SECOND (post-rework) review still carries the
    // original English source AND the freshly re-translated draft (#2), instead
    // of only the Chinese text that triggered the "where is the source?" rebuttal.
    expect(reviewInputs[1]!.input).toContain("EN_SOURCE");
    expect(reviewInputs[1]!.input).toContain("ZH_DRAFT#2");

    // The run converges to done (no VALIDATION halt).
    const finished = events.find((e) => (e as any).type === "run.finished") as any;
    expect(finished?.status).toBe("done");
  });
});
