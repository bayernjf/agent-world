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
