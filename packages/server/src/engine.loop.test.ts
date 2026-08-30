import { compile, replay, type Graph, type LoopConfig } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function graph(
  loop: LoopConfig,
  itemsCode: string,
  body: { kind: "code"; code: string } | { kind: "textGen" },
): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      {
        id: "items",
        kind: "code",
        name: "ITEMS",
        x: 1,
        y: 0,
        code: { language: "javascript", code: itemsCode, timeoutMs: 5000 },
      },
      { id: "loop", kind: "loop", name: "LOOP", x: 2, y: 0, loop },
      ...(body.kind === "code"
        ? [
            {
              id: "body",
              kind: "code" as const,
              name: "BODY",
              x: 3,
              y: 0,
              code: { language: "javascript", code: body.code, timeoutMs: 5000 },
            },
          ]
        : [
            {
              id: "body",
              kind: "textGen" as const,
              name: "BODY",
              x: 3,
              y: 0,
              textGen: {
                model: "test",
                prompt: "处理循环项",
                skills: [],
                temperature: 0.7,
                timeoutMs: 1000,
                retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
              },
            },
          ]),
    ],
    edges: [
      { id: "e1", from: "src", to: "items", kind: "flow" },
      { id: "e2", from: "items", to: "loop", kind: "flow" },
      { id: "e3", from: "loop", to: "body", kind: "flow" },
    ],
  };
}

async function collect(g: Graph, input?: string) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    now: () => 0,
    input,
  })) {
    events.push(e);
  }
  return events;
}

function jsonOf(events: any[], nodeId: string): string | undefined {
  return events.find(
    (e) => e.type === "artifact.produced" && e.nodeId === nodeId && e.artifact.kind === "json",
  )?.artifact.content;
}

describe("loop node", () => {
  it("executes the loop body once per item and aggregates results", async () => {
    const events = await collect(
      graph(
        { items: "${items}" },
        "console.log(JSON.stringify([{ n: 1 }, { n: 2 }, { n: 3 }]))",
        {
          kind: "code",
          code: 'const fs = require("fs"); const input = JSON.parse(fs.readFileSync(0, "utf8")); console.log(JSON.stringify({ doubled: input.inputs.item.n * 2 }))',
        },
      ),
    );
    expect(replay(events).status).toBe("done");
    expect(JSON.parse(jsonOf(events, "loop")!)).toEqual({
      results: [{ doubled: 2 }, { doubled: 4 }, { doubled: 6 }],
    });
    // The body ran once per item.
    expect(events.filter((e) => e.type === "node.finished" && e.nodeId === "body")).toHaveLength(3);
  });

  it("truncates to maxIterations", async () => {
    const events = await collect(
      graph(
        { items: "${items}", maxIterations: 2 },
        "console.log(JSON.stringify([{ n: 1 }, { n: 2 }, { n: 3 }]))",
        {
          kind: "code",
          code: 'const fs = require("fs"); const input = JSON.parse(fs.readFileSync(0, "utf8")); console.log(JSON.stringify({ n: input.inputs.item.n }))',
        },
      ),
    );
    expect(replay(events).status).toBe("done");
    expect(JSON.parse(jsonOf(events, "loop")!).results).toHaveLength(2);
  });

  it("injects the current item into agent bodies and aggregates text outputs", async () => {
    const events = await collect(
      graph(
        { items: "${items}" },
        "console.log(JSON.stringify([{ n: 1 }, { n: 2 }]))",
        { kind: "textGen" },
      ),
    );
    expect(replay(events).status).toBe("done");
    const results = JSON.parse(jsonOf(events, "loop")!);
    expect(results.results).toHaveLength(2);
    // Each round the agent ran once and its output was aggregated.
    const finished = events.filter((e) => e.type === "node.finished" && e.nodeId === "body");
    expect(finished).toHaveLength(2);
    expect(results.results[0]).toContain("BODY");
    expect(results.results[1]).toContain("BODY");
  });

  it("fails the run when a loop-body node fails", async () => {
    const events = await collect(
      graph(
        { items: "${items}" },
        "console.log(JSON.stringify([{ n: 1 }]))",
        { kind: "code", code: "process.exit(1)" },
      ),
    );
    expect(replay(events).status).toBe("failed");
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "loop")).toBe(true);
  });

  it("fails with VALIDATION when items does not resolve to an array", async () => {
    const events = await collect(
      graph(
        { items: "${items}" },
        "console.log(JSON.stringify({ notAnArray: true }))",
        { kind: "code", code: "console.log('x')" },
      ),
    );
    expect(replay(events).status).toBe("failed");
    expect(
      events.some(
        (e) => e.type === "node.failed" && e.nodeId === "loop" && e.errorCode === "VALIDATION",
      ),
    ).toBe(true);
  });
});
