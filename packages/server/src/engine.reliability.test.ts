import { compile, replay, type Graph, type Usage } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute, reconstructState, resume } from "./engine.js";
import { ProviderError } from "./providers/openai-compatible.js";
import { sanitizeError } from "./sanitize.js";
import type { AgentChunk, Worker } from "./worker.js";

const USAGE: Usage = { tokensIn: 10, tokensOut: 5, costUsd: 0.001 };

/**
 * Minimal linear graph: intake → forge(agent) → critic(gate) → depot.
 * Retry policy is tight so tests stay fast.
 */
function linearGraph(retryOverrides?: { maxRetries: number; baseDelayMs: number; maxDelayMs: number }): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
      {
        id: "forge",
        kind: "agent",
        name: "FORGE",
        x: 1,
        y: 0,
        agent: {
          model: "test",
          prompt: "",
          skills: [],
          temperature: 0.7,
          timeoutMs: 60_000,
          retry: retryOverrides ?? { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 4 },
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
  return out as any[];
}

function workerThat(
  fn: () => AsyncGenerator<AgentChunk, { output: string; usage: Usage }>,
  judge: Worker["judge"] = async () => ({ passed: true, reason: "ok" }),
): Worker {
  return { runAgent: fn, judge };
}

// ─── Retry exhaustion for each retryable error code ──────────────────────────

describe("retry exhausts and surfaces sanitized failure", () => {
  for (const code of ["TIMEOUT", "RATE_LIMIT", "PROVIDER_ERROR"] as const) {
    it(`retries ${code} up to maxRetries then emits node.failed`, async () => {
      const graph = linearGraph({ maxRetries: 2, baseDelayMs: 1, maxDelayMs: 4 });
      const { plan } = compile(graph)!;
      let calls = 0;
      const worker = workerThat(async function* () {
        calls++;
        throw new ProviderError(code, `${code} boom`, 500);
      });

      const events = await drain(
        execute({ runId: "r", graph, plan: plan!, worker, budgetUsd: null, now: () => 0, sleep: async () => {} }),
      );

      // 1 initial + 2 retries = 3 calls
      expect(calls).toBe(3);
      const failed = events.find((e) => e.type === "node.failed")!;
      expect(failed).toBeTruthy();
      expect(failed.errorCode).toBe(code);
      expect(failed.attempt).toBe(1);
      expect(replay(events).status).toBe("failed");
    });
  }

  it("does not retry UNKNOWN errors", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    let calls = 0;
    const worker = workerThat(async function* () {
      calls++;
      throw new Error("something weird");
    });

    const events = await drain(
      execute({ runId: "r", graph, plan: plan!, worker, budgetUsd: null, now: () => 0, sleep: async () => {} }),
    );

    expect(calls).toBe(1);
    const failed = events.find((e) => e.type === "node.failed")!;
    expect(failed.errorCode).toBe("UNKNOWN");
  });

  it("does not retry AUTH errors", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    let calls = 0;
    const worker = workerThat(async function* () {
      calls++;
      throw new ProviderError("AUTH", "bad key", 401);
    });

    const events = await drain(
      execute({ runId: "r", graph, plan: plan!, worker, budgetUsd: null, now: () => 0, sleep: async () => {} }),
    );

    expect(calls).toBe(1);
    expect(events.find((e) => e.type === "node.failed")!.errorCode).toBe("AUTH");
  });
});

// ─── Exponential backoff ─────────────────────────────────────────────────────

describe("retry backoff", () => {
  it("sleeps with exponential backoff between retries", async () => {
    const graph = linearGraph({ maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10_000 });
    const { plan } = compile(graph)!;
    const sleepCalls: number[] = [];
    let calls = 0;
    const worker = workerThat(async function* () {
      calls++;
      if (calls <= 3) throw new ProviderError("RATE_LIMIT", "429", 429);
      yield { type: "text-delta", text: "ok" };
      return { output: "ok", usage: USAGE };
    });

    await drain(
      execute({
        runId: "r",
        graph,
        plan: plan!,
        worker,
        budgetUsd: null,
        now: () => 0,
        sleep: async (ms) => { sleepCalls.push(ms); },
      }),
    );

    // 3 retries → 3 sleeps (succeeds on 4th call, so 3 failures)
    expect(calls).toBe(4);
    expect(sleepCalls).toHaveLength(3);
    // base=100: 100*2^0=100, 100*2^1=200
    expect(sleepCalls[0]).toBe(100);
    expect(sleepCalls[1]).toBe(200);
    expect(sleepCalls[2]).toBe(400);
  });

  it("caps backoff at maxDelayMs", async () => {
    const graph = linearGraph({ maxRetries: 4, baseDelayMs: 100, maxDelayMs: 150 });
    const { plan } = compile(graph)!;
    const sleepCalls: number[] = [];
    const worker = workerThat(async function* () {
      throw new ProviderError("PROVIDER_ERROR", "500", 500);
    });

    await drain(
      execute({
        runId: "r",
        graph,
        plan: plan!,
        worker,
        budgetUsd: null,
        now: () => 0,
        sleep: async (ms) => { sleepCalls.push(ms); },
      }),
    );

    // 100, min(150, 200)=150, min(150, 400)=150, min(150, 800)=150
    expect(sleepCalls).toEqual([100, 150, 150, 150]);
  });
});

// ─── End-to-end error sanitization in engine events ──────────────────────────

describe("error sanitization in node.failed", () => {
  it("redacts API keys from provider error messages surfaced to the event stream", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const worker = workerThat(async function* () {
      throw new ProviderError(
        "AUTH",
        "request failed: authorization: Bearer sk-abcdef1234567890secret, api_key=ark-9876543210fedcba",
        401,
      );
    });

    const events = await drain(
      execute({ runId: "r", graph, plan: plan!, worker, budgetUsd: null, now: () => 0, sleep: async () => {} }),
    );

    const failed = events.find((e) => e.type === "node.failed")!;
    expect(failed.error).not.toContain("sk-abcdef1234567890secret");
    expect(failed.error).not.toContain("ark-9876543210fedcba");
    expect(failed.error).toContain("****");
  });

  it("truncates very long error messages in the event stream", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const longMsg = "x".repeat(2000);
    const worker = workerThat(async function* () {
      throw new ProviderError("PROVIDER_ERROR", longMsg, 500);
    });

    const events = await drain(
      execute({ runId: "r", graph, plan: plan!, worker, budgetUsd: null, now: () => 0, sleep: async () => {} }),
    );

    const failed = events.find((e) => e.type === "node.failed")!;
    expect(failed.error.length).toBeLessThanOrEqual(501);
  });
});

// ─── sanitizeError additional patterns ───────────────────────────────────────

describe("sanitizeError additional patterns", () => {
  it("redacts Bearer tokens", () => {
    const out = sanitizeError("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9.secret");
    expect(out).toContain("****");
  });

  it("redacts JSON-style apiKey fields", () => {
    const out = sanitizeError('config={"apiKey":"sk-supersecretvalue123"}');
    expect(out).not.toContain("sk-supersecretvalue123");
  });

  it("redacts authorization header style", () => {
    const out = sanitizeError("header authorization=Bearer tok_abc123def456");
    expect(out).not.toContain("tok_abc123def456");
  });

  it("preserves non-secret error text", () => {
    const out = sanitizeError("connection reset by peer");
    expect(out).toBe("connection reset by peer");
  });
});

// ─── Halt-resume: continue emits human-approved gate verdict ─────────────────

describe("resume continue", () => {
  it("marks the halted gate as human-approved and proceeds to depot", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;

    // Run until halt: judge always rejects.
    const haltWorker: Worker = {
      async *runAgent() { return { output: "draft", usage: USAGE }; },
      async judge() { return { passed: false, reason: "nope" }; },
    };
    const past = await drain(
      execute({ runId: "r", graph, plan: plan!, worker: haltWorker, budgetUsd: null, now: () => 0 }),
    );
    expect(replay(past).status).toBe("halted");

    // Resume with continue.
    const resumeWorker: Worker = {
      async *runAgent({ input }) { return { output: `final:${input.length}`, usage: USAGE }; },
      async judge() { return { passed: true, reason: "should not be called on resume" }; },
    };

    const cont = await drain(
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
    );

    // The gate verdict in resume carries human-operator approval.
    const verdict = cont.find((e) => e.type === "gate.verdict");
    expect(verdict).toBeTruthy();
    expect(verdict.passed).toBe(true);
    expect(verdict.reason).toBe("Approved by human operator");

    // Depot was reached.
    const all = [...past, ...cont];
    expect(replay(all).status).toBe("done");
    expect(all.some((e) => e.type === "node.finished" && e.nodeId === "depot")).toBe(true);
  });

  it("continues seq numbering from the last event in the past log", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const haltWorker: Worker = {
      async *runAgent() { return { output: "bad", usage: USAGE }; },
      async judge() { return { passed: false, reason: "no" }; },
    };
    const past = await drain(
      execute({ runId: "r", graph, plan: plan!, worker: haltWorker, budgetUsd: null, now: () => 0 }),
    );
    const lastSeq = past[past.length - 1]!.seq;

    const cont = await drain(
      resume({
        runId: "r",
        graph,
        plan: plan!,
        worker: {
          async *runAgent({ input }) { return { output: `ok:${input.length}`, usage: USAGE }; },
          async judge() { return { passed: true, reason: "ok" }; },
        },
        budgetUsd: null,
        pastEvents: past,
        action: "continue",
        now: () => 0,
      }),
    );

    expect(cont[0]!.seq).toBe(lastSeq + 1);
    // Consecutive.
    for (let i = 1; i < cont.length; i++) {
      expect(cont[i]!.seq).toBe(cont[i - 1]!.seq + 1);
    }
  });

  it("reconstructState picks up haltedNodeId from gate.exhausted", async () => {
    const graph = linearGraph();
    const { plan } = compile(graph)!;
    const past = await drain(
      execute({
        runId: "r",
        graph,
        plan: plan!,
        worker: {
          async *runAgent() { return { output: "bad", usage: USAGE }; },
          async judge() { return { passed: false, reason: "no" }; },
        },
        budgetUsd: null,
        now: () => 0,
      }),
    );
    const state = reconstructState(past);
    expect(state.haltedNodeId).toBe("critic");
    expect(state.artifacts.get("forge")).toBe("bad");
    expect(state.totalCostUsd).toBeGreaterThan(0);
  });
});

// ─── Retry does not bump attempt identity ────────────────────────────────────

describe("attempt identity during retry", () => {
  it("keeps the same attempt number across technical retries", async () => {
    const graph = linearGraph({ maxRetries: 3, baseDelayMs: 1, maxDelayMs: 4 });
    const { plan } = compile(graph)!;
    let calls = 0;
    const worker = workerThat(async function* () {
      calls++;
      if (calls <= 2) throw new ProviderError("TIMEOUT", "timeout", 408);
      yield { type: "text-delta", text: "done" };
      return { output: "done", usage: USAGE };
    });

    const events = await drain(
      execute({ runId: "r", graph, plan: plan!, worker, budgetUsd: null, now: () => 0, sleep: async () => {} }),
    );

    const started = events.filter((e) => e.type === "node.started" && e.nodeId === "forge");
    const finished = events.filter((e) => e.type === "node.finished" && e.nodeId === "forge");
    // Exactly one started and one finished at attempt 1 — retries are invisible
    // at the event level.
    expect(started).toHaveLength(1);
    expect(finished).toHaveLength(1);
    expect(started[0]!.attempt).toBe(1);
    expect(finished[0]!.attempt).toBe(1);
  });
});

// ─── Retry from a failed node (resetFrom) ────────────────────────────────────

describe("resume with resetFrom", () => {
  it("re-runs the failed node and its downstream, keeping upstream artifacts", async () => {
    // A straight line: intake -> forge -> depot (no gate/rework).
    const graph: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "intake", kind: "source", name: "INTAKE", x: 0, y: 0 },
        {
          id: "forge",
          kind: "agent",
          name: "FORGE",
          x: 1, y: 0,
          agent: { model: "test", prompt: "", skills: [], temperature: 0.7, timeoutMs: 60_000, retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 } },
        },
        { id: "depot", kind: "sink", name: "DEPOT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "intake", to: "forge", kind: "flow" },
        { id: "e2", from: "forge", to: "depot", kind: "flow" },
      ],
    };
    const { plan } = compile(graph)!;

    const failWorker: Worker = {
      async *runAgent() {
        throw new ProviderError("UNSUPPORTED", "nope", 400);
      },
      async judge() { return { passed: false, reason: "x" }; },
    };
    const past = await drain(
      execute({ runId: "r", graph, plan: plan!, worker: failWorker, budgetUsd: null, input: "raw", now: () => 0 }),
    );
    expect(replay(past).status).toBe("failed");
    expect(replay(past).nodes.forge!.status).toBe("failed");

    const okWorker: Worker = {
      async *runAgent({ input }) {
        yield { type: "text-delta", text: "fixed" };
        return { output: `fixed:${input}`, usage: USAGE };
      },
      async judge() { return { passed: true, reason: "ok" }; },
    };
    const cont = await drain(
      resume({
        runId: "r", graph, plan: plan!, worker: okWorker, budgetUsd: null,
        pastEvents: past, action: "continue", resetFrom: "forge", now: () => 0,
      }),
    );

    // forge re-ran and the line completed.
    const all = [...past, ...cont];
    const state = replay(all);
    expect(state.status).toBe("done");
    expect(state.nodes.forge!.status).toBe("done");
    expect(state.nodes.forge!.outputs[1]).toBe("fixed:raw");
    expect(cont.some((e) => e.type === "node.finished" && e.nodeId === "depot")).toBe(true);
    // The failure is preserved in history.
    expect(state.failures.some((f) => f.kind === "node" && f.nodeId === "forge")).toBe(true);
  });
});
