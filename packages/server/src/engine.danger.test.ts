import { compile, type Graph, type RunEvent } from "@agent-world/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute, resume } from "./engine.js";
import { type Worker } from "./worker.js";
import { isDangerousTool } from "./permissions.js";

const AGENT = {
  model: "agnes-2.0-flash",
  prompt: "",
  skills: [],
  temperature: 0,
  timeoutMs: 60000,
  inputPolicy: { mode: "all" as const },
  retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
};

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aw-fswrite-"));
  process.env.TOOL_FS_ALLOW = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TOOL_FS_ALLOW;
});

function dangerGraph(): Graph {
  return {
    nodes: [
      { id: "s1", kind: "source", name: "Src", x: 0, y: 0, source: {} },
      { id: "w1", kind: "agent", name: "Writer", x: 1, y: 0, agent: { ...AGENT, skills: ["fs_write"] } },
      { id: "k1", kind: "sink", name: "Out", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", kind: "flow", from: "s1", to: "w1" },
      { id: "e2", kind: "flow", from: "w1", to: "k1" },
    ],
  };
}

/** Worker that calls the dangerous fs_write tool and lets a HaltRequested propagate. */
function dangerWorker(fileName = "out.txt"): Worker {
  return {
    async *runAgent(args) {
      const hasFsWrite = (args.tools ?? []).some((t) => t.name === "fs_write");
      if (hasFsWrite && args.executeTool) {
        const result = await args.executeTool("fs_write", { path: fileName, content: "hello danger" });
        yield { type: "tool-result", id: "c1", name: "fs_write", result } as never;
      }
      return { output: "done", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "ok", score: 9 };
    },
    async generateImage() {
      return [];
    },
  };
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
const finished = (events: RunEvent[]) =>
  events.find((e) => e.type === "run.finished") as Extract<RunEvent, { type: "run.finished" }>;

describe("4D.7 dangerous-action halt", () => {
  it("flags fs_write as dangerous and web_fetch as safe", () => {
    expect(isDangerousTool("fs_write")).toBe(true);
    expect(isDangerousTool("web_fetch")).toBe(false);
    expect(isDangerousTool("does-not-exist")).toBe(false);
  });

  it("halts the run when a dangerous, unapproved tool is called", async () => {
    const graph = dangerGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(execute({ runId: "r1", graph, plan, worker: dangerWorker(), now: () => 0 }));
    const fin = finished(events);
    expect(fin.status).toBe("halted");
    expect(fin.haltedNodeId).toBe("w1");
    expect(fin.reason).toBe("dangerous-tool:fs_write");
    // The dangerous tool must NOT execute before human approval.
    expect(existsSync(join(dir, "out.txt"))).toBe(false);
  });

  it("resume with approveTools executes the tool and finishes the run", async () => {
    const graph = dangerGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const halted = await collect(execute({ runId: "r2", graph, plan, worker: dangerWorker(), now: () => 0 }));

    const events = await collect(
      resume({
        runId: "r2",
        graph,
        plan,
        worker: dangerWorker(),
        budgetUsd: null,
        pastEvents: halted,
        action: "approve",
        approveTools: ["fs_write"],
        now: () => 0,
      }),
    );
    const fin = finished(events);
    expect(fin.status).toBe("done");
    // The approved dangerous tool executed: file written under the allowed root.
    expect(existsSync(join(dir, "out.txt"))).toBe(true);
  });

  it("resume WITHOUT approval re-halts on the same dangerous tool", async () => {
    const graph = dangerGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const halted = await collect(execute({ runId: "r3", graph, plan, worker: dangerWorker("out-noapprove.txt"), now: () => 0 }));

    const events = await collect(
      resume({
        runId: "r3",
        graph,
        plan,
        worker: dangerWorker("out-noapprove.txt"),
        budgetUsd: null,
        pastEvents: halted,
        action: "approve",
        now: () => 0,
      }),
    );
    const fin = finished(events);
    expect(fin.status).toBe("halted");
    expect(fin.reason).toBe("dangerous-tool:fs_write");
    expect(existsSync(join(dir, "out-noapprove.txt"))).toBe(false);
  });
});
