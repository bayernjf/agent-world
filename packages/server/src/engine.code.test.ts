import { compile, replay, type Graph } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

function graph(code: NonNullable<Graph["nodes"][number]["code"]>): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "calc", kind: "code", name: "CALC", x: 1, y: 0, code },
      { id: "out", kind: "sink", name: "OUT", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "calc", kind: "flow" },
      { id: "e2", from: "calc", to: "out", kind: "flow" },
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

describe("code node (javascript)", () => {
  it("runs a script that reads stdin JSON and emits a json artifact", async () => {
    const script = [
      "const fs = require('fs');",
      "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
      "const n = Number(input.inputs.src);",
      "console.log(JSON.stringify({ doubled: n * 2 }));",
    ].join("\n");
    const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 10000 }), "21");

    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
    expect(finished).toBeTruthy();
    expect(finished.output).toBe(JSON.stringify({ doubled: 42 }, null, 2));

    const arti = events.find((e) => e.type === "artifact.produced" && e.nodeId === "calc")?.artifact;
    expect(arti?.kind).toBe("json");
    expect(replay(events).status).toBe("done");
  });

  it("turns plain stdout into a text artifact", async () => {
    const script = [
      "const fs = require('fs');",
      "JSON.parse(fs.readFileSync(0, 'utf8'));",
      "console.log('hello from script');",
    ].join("\n");
    const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 10000 }), "x");

    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
    expect(finished.output).toBe("hello from script");
    const arti = events.find((e) => e.type === "artifact.produced" && e.nodeId === "calc")?.artifact;
    expect(arti?.kind).toBe("text");
    expect(replay(events).status).toBe("done");
  });

  it("fails the node on non-zero exit code", async () => {
    const events = await collect(
      graph({ language: "javascript", code: "throw new Error('boom');", timeoutMs: 10000 }),
      "x",
    );

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "calc");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
    expect(replay(events).status).toBe("failed");
  });

  it("kills a script that exceeds the timeout", async () => {
    const events = await collect(
      graph({ language: "javascript", code: "setTimeout(() => {}, 5000);", timeoutMs: 1000 }),
      "x",
    );

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "calc");
    expect(failed).toBeTruthy();
    expect(failed.errorCode).toBe("TIMEOUT");
  });

  it("does not leak server env vars into the script (P0)", async () => {
    process.env.AW_TEST_SECRET = "super-secret";
    try {
      const script = [
        "const fs = require('fs');",
        "JSON.parse(fs.readFileSync(0, 'utf8'));",
        "console.log(process.env.AW_TEST_SECRET === undefined ? 'no-leak' : 'leaked');",
      ].join("\n");
      const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 10000 }), "x");
      const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
      expect(finished.output).toBe("no-leak");
    } finally {
      delete process.env.AW_TEST_SECRET;
    }
  });

  it("runs in an isolated working directory (P0)", async () => {
    const script = [
      "const fs = require('fs');",
      "JSON.parse(fs.readFileSync(0, 'utf8'));",
      "console.log(process.cwd());",
    ].join("\n");
    const events = await collect(graph({ language: "javascript", code: script, timeoutMs: 10000 }), "x");
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "calc");
    expect(finished.output).toContain("aw-code-");
  });
});
