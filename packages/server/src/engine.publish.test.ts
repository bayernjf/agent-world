import { compile, type Graph, type RunEvent } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import type { Worker } from "./worker.js";

function worker(): Worker {
  return {
    async *runTextGen() {
      return { output: "", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "" };
    },
    async generateImage() {
      return [];
    },
  } as Worker;
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function finished(events: RunEvent[]) {
  const f = events.filter((e) => e.type === "run.finished");
  return f[f.length - 1] as Extract<RunEvent, { type: "run.finished" }>;
}

function publishGraph(platform = "xiaohongshu"): Graph {
  return {
    id: "g",
    name: "publish line",
    nodes: [
      { id: "intake", kind: "source", name: "原料台", x: 0, y: 0, source: {} },
      { id: "pub", kind: "publish", name: "发布台", x: 1, y: 0, publish: { platform: platform as never } },
      { id: "depot", kind: "sink", name: "成品", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "pub", kind: "flow" },
      { id: "e2", from: "pub", to: "depot", kind: "flow" },
    ],
  };
}

describe("publish node (F7-A)", () => {
  it("assembles a platform package from the upstream text", async () => {
    const graph = publishGraph();
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const input = "夏日通勤穿搭\n这件托特包百搭又耐看。#穿搭 #通勤";
    const events = await collect(
      execute({ runId: "r", graph, plan, worker: worker(), budgetUsd: null, input, now: () => 0 }),
    );
    expect(finished(events).status).toBe("done");

    const produced = events.find(
      (e) => e.type === "artifact.produced" && (e.artifact as { id: string }).id.endsWith("-publish"),
    );
    expect(produced).toBeDefined();
    const payload = JSON.parse((produced as { artifact: { content: string } }).artifact.content);
    expect(payload.platform).toBe("xiaohongshu");
    expect(payload.title).toBe("夏日通勤穿搭");
    expect(payload.body).toContain("托特包");
    expect(payload.hashtags).toEqual(["#穿搭", "#通勤"]);
    expect(payload.readyToPublish).toBe(true);
  });

  it("extracts no hashtags for a platform without hashtags (wechat)", async () => {
    const graph = publishGraph("wechat");
    const { plan } = compile(graph);
    if (!plan) throw new Error("no plan");
    const events = await collect(
      execute({
        runId: "r",
        graph,
        plan,
        worker: worker(),
        budgetUsd: null,
        input: "标题\n正文 #本应被忽略",
        now: () => 0,
      }),
    );
    expect(finished(events).status).toBe("done");
    const produced = events.find(
      (e) => e.type === "artifact.produced" && (e.artifact as { id: string }).id.endsWith("-publish"),
    );
    const payload = JSON.parse((produced as { artifact: { content: string } }).artifact.content);
    expect(payload.platform).toBe("wechat");
    expect(payload.hashtags).toEqual([]);
  });
});
