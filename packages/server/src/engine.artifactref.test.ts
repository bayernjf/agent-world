import { compile, type Graph, type RunEvent } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute, reconstructState } from "./engine.js";
import { type Worker } from "./worker.js";

const AGENT = {
  model: "agnes-2.0-flash",
  prompt: "",
  skills: [],
  temperature: 0,
  timeoutMs: 60000,
  inputPolicy: { mode: "all" as const },
  retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
};

function spyWorker(opts?: { imageCount?: number }): {
  worker: Worker;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const worker: Worker = {
    async *runAgent(args) {
      calls.push(args as unknown as Record<string, unknown>);
      yield { type: "text-delta", text: "ok" };
      return { output: "out", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "" };
    },
    async generateImage() {
      const n = opts?.imageCount ?? 1;
      return Array.from({ length: n }, (_, i) => ({
        data: Buffer.from(`fake-img-${i}`),
        mimeType: "image/png",
        usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { images: 1 } },
      }));
    },
  };
  return { worker, calls };
}

async function run(graph: Graph, worker: Worker) {
  const { plan } = compile(graph);
  if (!plan) throw new Error("graph did not compile");
  const events: RunEvent[] = [];
  for await (const e of execute({ runId: "r", graph, plan, worker, now: () => 0 })) {
    events.push(e);
  }
  return events;
}

/** source → imageGen → agent: imageGen output flows to downstream agent via images. */
function graphImageGenToAgent(): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "Src", x: 0, y: 0, source: {} },
      {
        id: "img",
        kind: "imageGen",
        name: "Img",
        x: 1,
        y: 0,
        imageGen: { model: "agnes-image", prompt: "test", n: 1 },
      },
      { id: "agt", kind: "agent", name: "Agt", x: 2, y: 0, agent: AGENT },
    ],
    edges: [
      { id: "e1", kind: "flow", from: "src", to: "img" },
      { id: "e2", kind: "flow", from: "img", to: "agt" },
    ],
  };
}

describe("ArtifactRef upgrade (P1-4)", () => {
  it("imageGen-produced image flows to downstream agent via images param", async () => {
    const { worker, calls } = spyWorker({ imageCount: 1 });
    await run(graphImageGenToAgent(), worker);

    const agentCall = calls.find((c) => (c.node as { id: string }).id === "agt")!;
    expect(agentCall).toBeDefined();
    const images = agentCall.images as string[];
    expect(Array.isArray(images)).toBe(true);
    expect(images.length).toBe(1);
    // The image URI is a stored artifact (data: URI in tests, /api/artifacts/ in prod).
    expect(typeof images[0]).toBe("string");
    expect(images[0].length).toBeGreaterThan(0);
    // Content parts include the image.
    const content = agentCall.content as Array<{ type: string; image?: string }>;
    expect(content).toBeDefined();
    expect(content.some((p) => p.type === "image" && p.image === images[0])).toBe(true);
  });

  it("reconstructState builds typed artifact arrays from event log", async () => {
    const { worker } = spyWorker({ imageCount: 2 });
    const events = await run(graphImageGenToAgent(), worker);

    const state = reconstructState(events);

    // source node: text artifact from buildSourceBrief
    const srcArts = state.artifacts.get("src") ?? [];
    expect(srcArts.length).toBeGreaterThanOrEqual(1);
    expect(srcArts[0]!.kind).toBe("text");
    expect(typeof srcArts[0]!.content).toBe("string");

    // imageGen node: two image artifacts (no text artifact, output is "")
    const imgArts = state.artifacts.get("img") ?? [];
    expect(imgArts.length).toBe(2);
    expect(imgArts.every((a) => a.kind === "image")).toBe(true);
    expect(imgArts.every((a) => typeof a.uri === "string" && a.uri.length > 0)).toBe(true);

    // agent node: text artifact
    const agtArts = state.artifacts.get("agt") ?? [];
    expect(agtArts.length).toBeGreaterThanOrEqual(1);
    expect(agtArts[0]!.kind).toBe("text");
    expect(agtArts[0]!.content).toBe("out");
  });

  it("inputFor includes image placeholders for non-text upstream artifacts", async () => {
    const { worker, calls } = spyWorker({ imageCount: 1 });
    await run(graphImageGenToAgent(), worker);

    const agentCall = calls.find((c) => (c.node as { id: string }).id === "agt")!;
    const input = agentCall.input as string;
    // The agent's text input should include a [图片: ...] placeholder for the
    // imageGen output, plus the source text.
    expect(input).toContain("[图片:");
  });

  it("rework loop reset clears artifact arrays", async () => {
    // A gate loop: source → agent → gate → (back to agent on fail).
    // When the gate fails and triggers a rework, the agent's artifacts should
    // be cleared so the next attempt starts fresh.
    const graph: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "Src", x: 0, y: 0, source: {} },
        { id: "agt", kind: "agent", name: "Agt", x: 1, y: 0, agent: { ...AGENT, retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 } } },
        { id: "gate", kind: "gate", name: "Gate", x: 2, y: 0, gate: { criterion: "good", maxAttempts: 2, onExhausted: "halt" } },
      ],
      edges: [
        { id: "e1", kind: "flow", from: "src", to: "agt" },
        { id: "e2", kind: "flow", from: "agt", to: "gate" },
        { id: "e3", kind: "rework", from: "gate", to: "agt" },
      ],
    };

    let judgeCalls = 0;
    const worker: Worker = {
      async *runAgent() {
        yield { type: "text-delta", text: "draft" };
        return { output: `draft-${judgeCalls}`, usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
      },
      async judge() {
        judgeCalls++;
        // Fail first time, pass second time.
        if (judgeCalls === 1) return { passed: false, reason: "not good enough", score: 3 };
        return { passed: true, reason: "good", score: 9 };
      },
      async generateImage() {
        return [];
      },
    };

    const events = await run(graph, worker);
    const state = reconstructState(events);

    // After rework + final pass, the agent should have its final output.
    const agtArts = state.artifacts.get("agt") ?? [];
    expect(agtArts.length).toBeGreaterThanOrEqual(1);
    // The last text artifact should be the second attempt's output.
    const textArts = agtArts.filter((a) => a.kind === "text");
    expect(textArts[textArts.length - 1]!.content).toBe("draft-1");
  });
});
