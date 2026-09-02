import { compile, replay, type Graph } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker, type Worker } from "./worker.js";

// Dogfood tpl-custom-model: the generic node's prompt references an upstream
// artifact (`${craft}`) and used to reach the model with the placeholder
// still literal. Prompts interpolate like http url/body and notify messages.
describe("generic node — prompt interpolation", () => {
  it("interpolates ${craft} with the upstream artifact before dispatch", async () => {
    const calls: Array<{ prompt: string; input: string }> = [];
    const base = fakeWorker();
    const worker: Worker = {
      ...base,
      async *runTextGen(args) {
        calls.push({ prompt: args.config.prompt, input: String(args.input) });
        yield { type: "text-delta", text: "ok" };
        return { output: "done", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 } };
      },
    };
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        {
          id: "craft",
          kind: "code",
          name: "CRAFT",
          x: 1,
          y: 0,
          code: {
            language: "javascript",
            code: 'console.log(JSON.stringify({ intent: "polish", sourceText: "hello world" }));',
          },
        },
        {
          id: "gen",
          kind: "generic",
          name: "GEN",
          x: 2,
          y: 0,
          generic: { model: "agnes-2.0-flash", modality: "text", prompt: "EXEC: ${craft}" },
        },
        { id: "out", kind: "sink", name: "OUT", x: 3, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "craft", kind: "flow" },
        { id: "e2", from: "craft", to: "gen", kind: "flow" },
        { id: "e3", from: "gen", to: "out", kind: "flow" },
      ],
    };
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker, budgetUsd: null, now: () => 0, input: "x" })) {
      events.push(e);
    }

    expect(replay(events).status).toBe("done");
    expect(calls.length).toBeGreaterThan(0);
    const prompt = calls[0]!.prompt;
    expect(prompt).not.toContain("${craft}");
    expect(prompt).toContain("EXEC:");
    expect(prompt).toContain("polish");
    expect(prompt).toContain("hello world");
  });

  it("interpolates ${src} in a textGen prompt (same contract)", async () => {
    const calls: Array<{ prompt: string }> = [];
    const base = fakeWorker();
    const worker: Worker = {
      ...base,
      async *runTextGen(args) {
        calls.push({ prompt: args.config.prompt });
        yield { type: "text-delta", text: "ok" };
        return { output: "done", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 } };
      },
    };
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        {
          id: "agt",
          kind: "textGen",
          name: "AGT",
          x: 1,
          y: 0,
          textGen: { model: "agnes-2.0-flash", prompt: "ECHO ${src}", skills: [] },
        },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "agt", kind: "flow" },
        { id: "e2", from: "agt", to: "out", kind: "flow" },
      ],
    };
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker, budgetUsd: null, now: () => 0, input: "loop-item-42" })) {
      events.push(e);
    }

    expect(replay(events).status).toBe("done");
    expect(calls[0]!.prompt).toContain("ECHO loop-item-42");
    expect(calls[0]!.prompt).not.toContain("${src}");
  });
});

// Dogfood tpl-custom-model: auditing the one node no template test covered
// showed the generic node still had the silent-skip behaviour that b6de7d9
// removed from the dedicated media nodes — every failure path marked the node
// done with an empty output, so a run whose only product was a generic node
// reported success while producing nothing. Its text product was also missing
// from the artifact gallery (setTextArtifact without artifact.produced), the
// same observability gap 8418d2e closed for gates.
describe("generic node — honest failure and artifact parity", () => {
  function graph(modality: "text" | "image" | "video" | "audio"): Graph {
    return {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        {
          id: "gen",
          kind: "generic",
          name: "GEN",
          x: 1,
          y: 0,
          generic: { model: "agnes-2.0-flash", modality, prompt: "do the thing" },
        },
        { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "gen", kind: "flow" },
        { id: "e2", from: "gen", to: "out", kind: "flow" },
      ],
    };
  }

  /** Same chain plus an error edge catching the generic node. */
  function catchGraph(): Graph {
    return {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        {
          id: "gen",
          kind: "generic",
          name: "GEN",
          x: 1,
          y: 0,
          generic: { model: "agnes-2.0-flash", modality: "text", prompt: "do the thing" },
        },
        {
          id: "catch",
          kind: "textGen",
          name: "CATCH",
          x: 2,
          y: 1,
          textGen: { model: "agnes-2.0-flash", prompt: "fallback copy", skills: [] },
        },
        { id: "out", kind: "sink", name: "OUT", x: 3, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "gen", kind: "flow" },
        { id: "x1", from: "gen", to: "catch", kind: "error" },
        { id: "e3", from: "catch", to: "out", kind: "flow" },
      ],
    };
  }

  async function collect(g: Graph, worker: Worker, input = "x") {
    const { plan } = compile(g)!;
    const events: any[] = [];
    for await (const e of execute({ runId: "r", graph: g, plan: plan!, worker, budgetUsd: null, now: () => 0, input })) {
      events.push(e);
    }
    return events;
  }

  it("fails the run when text generation throws instead of reporting an empty success", async () => {
    const worker: Worker = {
      ...fakeWorker(),
      runTextGen: async function* () {
        throw new Error("provider exploded");
      },
    };
    const events = await collect(graph("text"), worker);
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "gen");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
    expect(failed.error).toContain("provider exploded");
    // The old behaviour emitted node.finished with output "" and sailed to done.
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "gen")).toBe(false);
    expect(replay(events).status).toBe("failed");
  });

  it("fails when the worker lacks the requested media capability", async () => {
    // fakeWorker does implement generateAudio, so drop it: a missing capability
    // is a configuration/provider problem, not a successful no-op (agnes has no
    // TTS model today, which is exactly how tpl-news-podcast surfaced this).
    const worker: Worker = { ...fakeWorker(), generateAudio: undefined };
    const events = await collect(graph("audio"), worker);
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "gen");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("VALIDATION");
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "gen")).toBe(false);
    expect(replay(events).status).toBe("failed");
  });

  it("fails when the provider returns zero results for a media modality", async () => {
    // A worker can expose the capability and still hand back nothing —
    // routingWorker returns [] for a provider without the modality. An empty
    // result set is not a successful no-op (audit item L8): the node asked for
    // n ≥ 1 items and got none, so there is no product.
    const worker: Worker = { ...fakeWorker(), generateAudio: async () => [] };
    const events = await collect(graph("audio"), worker);
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "gen");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("UNSUPPORTED");
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "gen")).toBe(false);
    expect(replay(events).status).toBe("failed");
  });

  it("can be caught by an error edge, so templates keep the fallback option", async () => {
    const worker: Worker = {
      ...fakeWorker(),
      runTextGen: async function* ({ node }) {
        if ((node as { id: string }).id === "gen") throw new Error("provider exploded");
        yield { type: "text-delta", text: "fallback" };
        return { output: "FALLBACK-COPY", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
      },
    };
    const events = await collect(catchGraph(), worker);
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "gen")).toBe(true);
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "catch")).toBe(true);
    expect(replay(events).status).toBe("done");
  });

  it("fails when the model returns an empty completion (no text is no product)", async () => {
    // openai-compatible falls back to `msg.content ?? ""`, so a 200 response can
    // carry no text at all (tool-call-only turn, filtered reply). That used to be
    // recorded as a done node with an empty text artifact and a done run.
    const worker: Worker = {
      ...fakeWorker(),
      async *runTextGen() {
        return { output: "  \n ", usage: { tokensIn: 1, tokensOut: 0, costUsd: 0 } };
      },
    };
    const events = await collect(graph("text"), worker);
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "gen");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
    expect(failed.error).toContain("agnes-2.0-flash");
    expect(events.some((e) => e.type === "node.finished" && e.nodeId === "gen")).toBe(false);
    expect(events.some((e) => e.type === "artifact.produced" && e.nodeId === "gen")).toBe(false);
    expect(replay(events).status).toBe("failed");
  });

  it("publishes its text product as an artifact like every other node kind", async () => {
    const worker: Worker = {
      ...fakeWorker(),
      async *runTextGen() {
        yield { type: "text-delta", text: "PRODUCT" };
        return { output: "PRODUCT-TEXT", usage: { tokensIn: 1, tokensOut: 1, costUsd: 0 } };
      },
    };
    const events = await collect(graph("text"), worker);
    expect(replay(events).status).toBe("done");
    const art = events.find((e) => e.type === "artifact.produced" && e.nodeId === "gen");
    expect(art, "generic text product must be inspectable in the gallery").toBeTruthy();
    expect(art.artifact.kind).toBe("text");
    expect(art.artifact.content).toContain("PRODUCT-TEXT");
  });
});
