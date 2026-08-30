import { compile, type Graph, type RunEvent } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { execute } from "./engine.js";
import { type Worker } from "./worker.js";

const TEXTGEN = {
  model: "agnes-2.0-flash",
  prompt: "",
  skills: [],
  temperature: 0,
  timeoutMs: 60000,
  inputPolicy: { mode: "all" as const },
  retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
};

function spyWorker(opts?: { videoCount?: number; noVideo?: boolean }): {
  worker: Worker;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const worker: Worker = {
    async *runTextGen(args) {
      calls.push(args as unknown as Record<string, unknown>);
      yield { type: "text-delta", text: "ok" };
      return { output: "out", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "" };
    },
    async generateImage() {
      return [{ data: Buffer.from("img"), mimeType: "image/png", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { images: 1 } } }];
    },
    ...(opts?.noVideo
      ? {}
      : {
          async generateVideo(args: { config: { n?: number } }) {
            calls.push(args as unknown as Record<string, unknown>);
            const n = opts?.videoCount ?? args.config.n ?? 1;
            return Array.from({ length: n }, (_, i) => ({
              data: Buffer.from(`fake-video-${i}`),
              mimeType: "video/mp4",
              durationSec: 5,
              usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { seconds: 5 } },
            }));
          },
        }),
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

function graphVideoGenToSink(): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "Src", x: 0, y: 0, source: {} },
      {
        id: "vid",
        kind: "videoGen",
        name: "Vid",
        x: 1,
        y: 0,
        videoGen: { model: "video-gen", prompt: "test video", n: 1, duration: 5 },
      },
      { id: "sink", kind: "sink", name: "Sink", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", kind: "flow", from: "src", to: "vid" },
      { id: "e2", kind: "flow", from: "vid", to: "sink" },
    ],
  };
}

describe("videoGen node (P1-6)", () => {
  it("produces a video artifact and emits artifact.produced", async () => {
    const { worker } = spyWorker({ videoCount: 1 });
    const events = await run(graphVideoGenToSink(), worker);

    const produced = events.filter((e) => e.type === "artifact.produced" && e.artifact.kind === "video");
    expect(produced.length).toBe(1);
    expect(produced[0]!.artifact.mimeType).toBe("video/mp4");
    expect(produced[0]!.artifact.uri).toBeTruthy();

    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "vid");
    expect(finished).toBeDefined();
    expect(finished!.type === "node.finished" && finished.usage?.units?.seconds).toBe(5);
  });

  it("supports multiple video outputs (n > 1)", async () => {
    const { worker } = spyWorker({ videoCount: 2 });
    const graph = graphVideoGenToSink();
    graph.nodes.find((n) => n.id === "vid")!.videoGen!.n = 2;
    const events = await run(graph, worker);

    const produced = events.filter((e) => e.type === "artifact.produced" && e.artifact.kind === "video");
    expect(produced.length).toBe(2);
  });

  it("soft-fails when worker has no generateVideo method", async () => {
    const { worker } = spyWorker({ noVideo: true });
    const events = await run(graphVideoGenToSink(), worker);

    // No artifact produced, but node still finishes (done, not error)
    const produced = events.filter((e) => e.type === "artifact.produced" && e.artifact.kind === "video");
    expect(produced.length).toBe(0);

    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "vid");
    expect(finished).toBeDefined();

    // Pipeline continues to sink
    const sinkFinished = events.find((e) => e.type === "node.finished" && e.nodeId === "sink");
    expect(sinkFinished).toBeDefined();
  });

  it("video artifact flows to downstream agent via inputFor placeholder", async () => {
    const { worker, calls } = spyWorker({ videoCount: 1 });
    const graph: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "Src", x: 0, y: 0, source: {} },
        { id: "vid", kind: "videoGen", name: "Vid", x: 1, y: 0, videoGen: { model: "video-gen", prompt: "test", n: 1 } },
        { id: "agt", kind: "textGen", name: "Agt", x: 2, y: 0, textGen: TEXTGEN },
      ],
      edges: [
        { id: "e1", kind: "flow", from: "src", to: "vid" },
        { id: "e2", kind: "flow", from: "vid", to: "agt" },
      ],
    };
    await run(graph, worker);

    // The agent's runTextGen should have been called with input containing the video placeholder
    const agentCall = calls.find((c) => "input" in c && typeof c.input === "string" && c.input.includes("视频"));
    expect(agentCall).toBeDefined();
  });
});
