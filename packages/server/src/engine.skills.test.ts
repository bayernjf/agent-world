import { compile, type Graph, type RunEvent, type Skill } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { type Worker } from "./worker.js";
import { registerSkill } from "./skills/registry.js";

// --- prompt-module skills (E.2) ---
registerSkill({
  id: "mod-a",
  name: "Module A",
  kind: "prompt-module",
  source: "local",
  permissions: {},
  config: { prompt: "MODULE_A_PROMPT", equips: ["mod-b"] },
});
registerSkill({
  id: "mod-b",
  name: "Module B",
  kind: "prompt-module",
  source: "local",
  permissions: {},
  config: { prompt: "MODULE_B_PROMPT", equips: ["mod-a"] }, // cycle with mod-a
});
// --- output-contract skill (E.3) ---
registerSkill({
  id: "contract-c",
  name: "Contract C",
  kind: "output-contract",
  source: "local",
  permissions: {},
  config: { schema: { type: "object", required: ["title"], properties: { title: { type: "string" } } } },
});

const AGENT = {
  model: "agnes-2.0-flash",
  prompt: "BASE_PROMPT",
  skills: [] as Array<string | { id: string; enabled?: boolean; config?: Record<string, unknown> }>,
  temperature: 0,
  timeoutMs: 60000,
  inputPolicy: { mode: "all" as const },
  retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
};

function promptGraph(skills: typeof AGENT.skills): Graph {
  return {
    nodes: [
      { id: "s1", kind: "source", name: "Src", x: 0, y: 0, source: {} },
      { id: "w1", kind: "agent", name: "Writer", x: 1, y: 0, agent: { ...AGENT, skills } },
      { id: "k1", kind: "sink", name: "End", x: 2, y: 0, sink: {} },
    ],
    edges: [
      { id: "e1", kind: "flow", from: "s1", to: "w1" },
      { id: "e2", kind: "flow", from: "w1", to: "k1" },
    ],
  };
}

/** Worker that records the system prompt each agent receives. */
function recordingWorker(): { worker: Worker; prompts: string[] } {
  const prompts: string[] = [];
  const worker: Worker = {
    async *runAgent(args) {
      prompts.push(args.config.prompt);
      const out = `OUT-${(args.node as { id: string }).id}`;
      yield { type: "text-delta", text: out };
      return { output: out, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "ok" };
    },
    async generateImage() {
      return [];
    },
  };
  return { worker, prompts };
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const finished = (events: RunEvent[]) =>
  events.find((e) => e.type === "run.finished") as Extract<RunEvent, { type: "run.finished" }>;

describe("E.2 prompt-module skills", () => {
  it("injects a mounted prompt-module's text into the agent prompt", async () => {
    const { worker, prompts } = recordingWorker();
    const graph = promptGraph(["mod-a"]);
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    await collect(execute({ runId: "r1", graph, plan, worker, now: () => 0 }));
    expect(prompts[0]).toContain("BASE_PROMPT");
    expect(prompts[0]).toContain("MODULE_A_PROMPT");
  });

  it("resolves multi-level equips with dedup (and survives cycles)", async () => {
    const { worker, prompts } = recordingWorker();
    const graph = promptGraph(["mod-a"]); // mod-a equips mod-b, mod-b equips mod-a
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    await collect(execute({ runId: "r2", graph, plan, worker, now: () => 0 }));
    const prompt = prompts[0];
    expect(prompt).toContain("MODULE_A_PROMPT");
    expect(prompt).toContain("MODULE_B_PROMPT");
    // dedup: each module text appears exactly once
    expect(prompt.match(/MODULE_A_PROMPT/g)).toHaveLength(1);
    expect(prompt.match(/MODULE_B_PROMPT/g)).toHaveLength(1);
  });
});

describe("E.3 output-contract skills", () => {
  function contractGraph(): Graph {
    return {
      nodes: [
        { id: "s1", kind: "source", name: "Src", x: 0, y: 0, source: {} },
        { id: "w1", kind: "agent", name: "Writer", x: 1, y: 0, agent: { ...AGENT, skills: ["contract-c"] } },
        { id: "k1", kind: "sink", name: "End", x: 2, y: 0, sink: {} },
      ],
      // self rework line so a contract failure re-runs the writer
      edges: [
        { id: "e1", kind: "flow", from: "s1", to: "w1" },
        { id: "e2", kind: "flow", from: "w1", to: "k1" },
        { id: "e3", kind: "rework", from: "w1", to: "w1" },
      ],
    };
  }

  /** Worker whose agent output never satisfies the contract (always invalid JSON). */
  function invalidWorker(): Worker {
    return {
      async *runAgent() {
        const out = "this is not json at all";
        yield { type: "text-delta", text: out };
        return { output: out, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
      },
      async judge() {
        return { passed: true, reason: "ok" };
      },
      async generateImage() {
        return [];
      },
    };
  }

  /** Worker that outputs invalid JSON first, then valid JSON after a rework. */
  function recoverWorker(): Worker {
    return {
      async *runAgent(args) {
        const out = args.attempt > 1 ? '{"title":"hello"}' : "this is not json at all";
        yield { type: "text-delta", text: out };
        return { output: out, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
      },
      async judge() {
        return { passed: true, reason: "ok" };
      },
      async generateImage() {
        return [];
      },
    };
  }

  it("passes when the agent output satisfies the contract", async () => {
    const worker: Worker = {
      async *runAgent() {
        const out = '{"title":"hello"}';
        yield { type: "text-delta", text: out };
        return { output: out, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
      },
      async judge() {
        return { passed: true, reason: "ok" };
      },
      async generateImage() {
        return [];
      },
    };
    const graph = contractGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(execute({ runId: "r3", graph, plan, worker, now: () => 0 }));
    expect(finished(events).status).toBe("done");
  });

  it("reworks on contract failure and recovers on the next attempt", async () => {
    const graph = contractGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(execute({ runId: "r4", graph, plan, worker: recoverWorker(), now: () => 0 }));
    expect(finished(events).status).toBe("done");
  });

  it("fails with VALIDATION after exhausting rework attempts", async () => {
    const graph = contractGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(execute({ runId: "r5", graph, plan, worker: invalidWorker(), now: () => 0 }));
    const fin = finished(events);
    expect(fin.status).toBe("failed");
    const failed = events.find(
      (e) => e.type === "node.failed" && (e as { errorCode?: string }).errorCode === "VALIDATION",
    );
    expect(failed).toBeDefined();
  });
});
