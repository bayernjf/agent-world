import { compile, replay, type GraphNode, type TextGenConfig, type Usage } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute, reconstructState, resume } from "./engine.js";
import { fakeWorker, type AgentChunk, type Worker } from "./worker.js";
import { sanitizeError } from "./sanitize.js";
import { ProviderError } from "./providers/openai-compatible.js";

const USAGE: Usage = { tokensIn: 10, tokensOut: 5, costUsd: 0.001 };

function linearGraph(): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
      {
        id: "forge",
        kind: "textGen",
        name: "FORGE",
        x: 1,
        y: 0,
        textGen: {
          model: "test",
          prompt: "",
          skills: [],
          temperature: 0.7,
          timeoutMs: 60000,
          retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
        },
      },
      {
        id: "critic",
        kind: "gate",
        name: "CRITIC",
        x: 2,
        y: 0,
        gate: { maxAttempts: 3, criterion: "must be good", onExhausted: "halt" },
      },
      { id: "depot", kind: "sink", name: "DEPOT", x: 3, y: 0 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "forge", kind: "flow" },
      { id: "e2", from: "forge", to: "critic", kind: "flow" },
      { id: "e3", from: "critic", to: "depot", kind: "flow" },
      { id: "r1", from: "critic", to: "forge", kind: "rework" },
    ],
  };
}

async function drain(gen: AsyncGenerator<unknown, void, unknown>) {
  const out: unknown[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("retry on technical failure", () => {
  it("retries a transient provider error without bumping attempt and then succeeds", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    let calls = 0;
    const worker: Worker = {
      async *runTextGen(): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        calls++;
        if (calls < 3) {
          throw new ProviderError("RATE_LIMIT", "429 slow down", 429);
        }
        yield { type: "text-delta", text: "OK" };
        return { output: "OK", usage: USAGE };
      },
      async judge() {
        return { passed: true, reason: "good" };
      },
    };

    const events = (await drain(
      execute({
        runId: "r",
        graph,
        plan: plan!,
        worker,
        budgetUsd: null,
        now: () => 0,
        sleep: async () => {},
      }),
    )) as any[];

    // forge only ever runs once at the identity level — retry is the same attempt.
    const finished = events.filter((e) => e.type === "node.finished" && e.nodeId === "forge");
    expect(finished).toHaveLength(1);
    expect(finished[0]!.attempt).toBe(1);
    expect(calls).toBe(3);
    expect(replay(events).status).toBe("done");
  });

  it("emits node.failed with errorCode after retries are exhausted", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    let calls = 0;
    const worker: Worker = {
      async *runTextGen(): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        calls++;
        throw new ProviderError("AUTH", "bad key", 401);
      },
      async judge() {
        return { passed: true, reason: "good" };
      },
    };

    const events = (await drain(
      execute({
        runId: "r",
        graph,
        plan: plan!,
        worker,
        budgetUsd: null,
        now: () => 0,
      }),
    )) as any[];

    const failed = events.find((e) => e.type === "node.failed")!;
    expect(failed.errorCode).toBe("AUTH");
    // AUTH is not retryable — only one call, no retries.
    expect(calls).toBe(1);
    expect(replay(events).status).toBe("failed");
  });
});

describe("rework feedback", () => {
  it("appends the gate rejection reason to the reworked node input", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const seenInputs: string[] = [];
    let verdict = 0;
    const worker: Worker = {
      async *runTextGen({ input }): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        seenInputs.push(input);
        yield { type: "text-delta", text: "draft" };
        return { output: `draft#${seenInputs.length}`, usage: USAGE };
      },
      async judge() {
        verdict++;
        if (verdict === 1) return { passed: false, reason: "MISSING-THE-SECRET" };
        return { passed: true, reason: "good" };
      },
    };

    const events = (await drain(
      execute({ runId: "r", graph, plan: plan!, worker, budgetUsd: null, now: () => 0 }),
    )) as any[];

    // First input is raw material; second (rework) input carries the rejection reason.
    expect(seenInputs[0]).not.toContain("MISSING-THE-SECRET");
    expect(seenInputs[1]).toContain("[质检站退回原因]");
    expect(seenInputs[1]).toContain("MISSING-THE-SECRET");
    // Reason is consumed, not appended again on a normal run.
    expect(replay(events).status).toBe("done");
  });
});

describe("dispatch input", () => {
  it("uses provided input as the source output", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const inputs: string[] = [];
    const worker: Worker = {
      async *runTextGen({ input }): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        inputs.push(input);
        return { output: "x", usage: USAGE };
      },
      async judge() {
        return { passed: true, reason: "ok" };
      },
    };
    await drain(
      execute({
        runId: "r",
        graph,
        plan: plan!,
        worker,
        input: "WRITE-ABOUT-WIDGETS",
        budgetUsd: null,
        now: () => 0,
      }),
    );
    expect(inputs[0]).toContain("WRITE-ABOUT-WIDGETS");
  });
});

describe("halt and resume", () => {
  it("reconstructs state from a halted log and continue finishes the line", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;

    // Run 1: critic always rejects -> halt.
    const haltWorker: Worker = {
      async *runTextGen(): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        return { output: "bad", usage: USAGE };
      },
      async judge() {
        return { passed: false, reason: "not good enough" };
      },
    };
    const past = (await drain(
      execute({ runId: "r", graph, plan: plan!, worker: haltWorker, budgetUsd: null, now: () => 0 }),
    )) as any[];
    expect(replay(past).status).toBe("halted");

    const state = reconstructState(past);
    expect(state.haltedNodeId).toBe("critic");

    // Resume with an approving judge.
    let resumeJudgeInput: string | undefined;
    const resumeWorker: Worker = {
      async *runTextGen({ input }): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        return { output: `polished:${input.length}`, usage: USAGE };
      },
      async judge({ output }) {
        resumeJudgeInput = output;
        return { passed: true, reason: "approved by human" };
      },
    };

    const cont = (await drain(
      resume({
        runId: "r",
        graph,
        plan: plan!,
        worker: resumeWorker,
        budgetUsd: null,
        pastEvents: past,
        action: "continue",
        now: () => 0,
      }),
    )) as any[];

    const approval = cont.find((e) => e.type === "gate.verdict" && e.passed);
    expect(approval?.reason).toBe("Approved by human operator");
    const all = [...past, ...cont];
    expect(replay(all).status).toBe("done");
    // shipyard did not exist in our linear graph; depot is the end. Verify depot finished.
    const depotFinished = all.some((e) => e.type === "node.finished" && e.nodeId === "depot");
    expect(depotFinished).toBe(true);
    void resumeJudgeInput;
  });

  it("scrap action ends the run as failed", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const past = (await drain(
      execute({
        runId: "r",
        graph,
        plan: plan!,
        worker: {
          async *runTextGen() {
            return { output: "bad", usage: USAGE };
          },
          async judge() {
            return { passed: false, reason: "no" };
          },
        },
        budgetUsd: null,
        now: () => 0,
      }),
    )) as any[];

    const cont = (await drain(
      resume({
        runId: "r",
        graph,
        plan: plan!,
        worker: null as unknown as Worker,
        budgetUsd: null,
        pastEvents: past,
        action: "scrap",
        now: () => 0,
      }),
    )) as any[];

    const finished = cont.find((e) => e.type === "run.finished")!;
    expect(finished.status).toBe("failed");
  });
});

describe("prohibited words enforcement", () => {
  it("fails the gate deterministically when copy contains a prohibited term", async () => {
    const graph = linearGraph();
    const intake = graph.nodes.find((n) => n.id === "intake")!;
    intake.source = { prohibited: "绝对" };

    // Isolate the deterministic check: the model judge always passes, but the
    // writer deliberately emits the forbidden word so the gate must reject it.
    const worker: Worker = {
      async *runTextGen({ node, input }): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        yield { type: "text-delta", text: "x" };
        const out = node.id === "forge" ? "这款产品绝对好用，闭眼入" : (input ?? "");
        return { output: out, usage: USAGE };
      },
      async judge() {
        return { passed: true, reason: "model ok" };
      },
      async generateImage() {
        return { data: Buffer.from(""), mimeType: "image/png", usage: USAGE };
      },
    };

    const events = (await drain(
      execute({
        runId: "r",
        graph,
        plan: compile(graph)!.plan!,
        worker,
        budgetUsd: null,
        now: () => 0,
      }),
    )) as any[];

    const verdict = events.find((e) => e.type === "gate.verdict") as any;
    expect(verdict).toBeDefined();
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain("命中禁用词");
    expect(verdict.reason).toContain("绝对");
  });

  it("injects upstream prohibited terms into the agent system prompt at generation time", async () => {
    const graph = linearGraph();
    const intake = graph.nodes.find((n) => n.id === "intake")!;
    intake.source = { prohibited: "第一、绝对" };

    const seenPrompts: string[] = [];
    const worker: Worker = {
      async *runTextGen({ node, config }): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        if (node.kind === "textGen") seenPrompts.push(config.prompt);
        yield { type: "text-delta", text: "x" };
        return { output: "这款产品很好用", usage: USAGE };
      },
      async judge() {
        return { passed: true, reason: "ok" };
      },
    };

    await drain(
      execute({
        runId: "r",
        graph,
        plan: compile(graph)!.plan!,
        worker,
        budgetUsd: null,
        now: () => 0,
      }),
    );

    expect(seenPrompts.length).toBeGreaterThan(0);
    for (const p of seenPrompts) {
      expect(p).toContain("硬性约束");
      expect(p).toContain("第一");
      expect(p).toContain("绝对");
    }
  });
});

describe("gate minScore linkage", () => {
  it("fails the gate when judge score is below minScore even if model passes", async () => {
    const graph = linearGraph();
    const critic = graph.nodes.find((n) => n.id === "critic")!;
    critic.gate = { ...critic.gate!, minScore: 8 };

    const worker: Worker = {
      async *runTextGen({ input }): AsyncGenerator<AgentChunk, { output: string; usage: Usage }> {
        yield { type: "text-delta", text: "x" };
        return { output: input ?? "", usage: USAGE };
      },
      async judge() {
        // Model is happy, but quality is low — the score must drive the verdict.
        return { passed: true, reason: "looks ok", score: 2 };
      },
      async generateImage() {
        return { data: Buffer.from(""), mimeType: "image/png", usage: USAGE };
      },
    };

    const events = (await drain(
      execute({
        runId: "r",
        graph,
        plan: compile(graph)!.plan!,
        worker,
        budgetUsd: null,
        now: () => 0,
      }),
    )) as any[];

    const verdict = events.find((e) => e.type === "gate.verdict") as any;
    expect(verdict).toBeDefined();
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain("低于门槛");
    expect(verdict.score).toBe(2);
  });
});

describe("node-level budget", () => {
  it("fails a node when its per-node budget is exceeded", async () => {
    const graph = linearGraph();
    const forge = graph.nodes.find((n) => n.id === "forge")!;
    forge.textGen = { ...forge.textGen!, budgetUsd: 0.0001 };
    const { plan } = compile(graph)!;

    const events = (await drain(
      execute({ runId: "r", graph, plan, worker: fakeWorker({ chunkDelayMs: 0 }), budgetUsd: null, now: () => 0 }),
    )) as any[];

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "forge");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("BUDGET");
    const finished = events.find((e) => e.type === "run.finished")!;
    expect(finished.status).toBe("failed");
  });
});

describe("sanitizeError", () => {
  it("redacts secrets and truncates long messages", () => {
    const clean = sanitizeError(
      "header authorization: Bearer sk-abcdef1234567890 and api_key=ark-9876543210 body",
    );
    expect(clean).not.toContain("sk-abcdef1234567890");
    expect(clean).not.toContain("ark-9876543210");
    expect(clean).toContain("****");
  });

  it("truncates to 500 chars", () => {
    const clean = sanitizeError("x".repeat(1000));
    expect(clean.length).toBeLessThanOrEqual(501);
  });

  it("handles non-string errors", () => {
    expect(() => sanitizeError(new Error("boom"))).not.toThrow();
    expect(() => sanitizeError({ nested: "obj" })).not.toThrow();
  });
});
