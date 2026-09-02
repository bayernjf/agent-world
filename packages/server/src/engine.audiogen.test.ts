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

function spyWorker(opts?: { audioCount?: number; noAudio?: boolean }): {
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
    ...(opts?.noAudio
      ? {}
      : {
          async generateAudio(args: { config: { n?: number; format?: string } }) {
            calls.push(args as unknown as Record<string, unknown>);
            const n = opts?.audioCount ?? args.config.n ?? 1;
            const mime = args.config.format === "wav" ? "audio/wav" : "audio/mpeg";
            return Array.from({ length: n }, (_, i) => ({
              data: Buffer.from(`fake-audio-${i}`),
              mimeType: mime,
              usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: {} },
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

function graphAudioGenToSink(): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "Src", x: 0, y: 0, source: {} },
      {
        id: "aud",
        kind: "audioGen",
        name: "Aud",
        x: 1,
        y: 0,
        audioGen: { model: "tts-1", prompt: "hello world", voice: "alloy", format: "mp3", n: 1 },
      },
      { id: "sink", kind: "sink", name: "Sink", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", kind: "flow", from: "src", to: "aud" },
      { id: "e2", kind: "flow", from: "aud", to: "sink" },
    ],
  };
}

describe("audioGen node (P1-6)", () => {
  it("produces an audio artifact and emits artifact.produced", async () => {
    const { worker } = spyWorker({ audioCount: 1 });
    const events = await run(graphAudioGenToSink(), worker);

    const produced = events.filter((e) => e.type === "artifact.produced" && e.artifact.kind === "audio");
    expect(produced.length).toBe(1);
    expect(produced[0]!.artifact.mimeType).toBe("audio/mpeg");
    expect(produced[0]!.artifact.uri).toBeTruthy();

    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "aud");
    expect(finished).toBeDefined();
  });

  it("supports wav output format", async () => {
    const { worker } = spyWorker({ audioCount: 1 });
    const graph = graphAudioGenToSink();
    graph.nodes.find((n) => n.id === "aud")!.audioGen!.format = "wav";
    const events = await run(graph, worker);

    const produced = events.filter((e) => e.type === "artifact.produced" && e.artifact.kind === "audio");
    expect(produced.length).toBe(1);
    expect(produced[0]!.artifact.mimeType).toBe("audio/wav");
  });

  it("supports multiple audio outputs (n > 1)", async () => {
    const { worker } = spyWorker({ audioCount: 2 });
    const graph = graphAudioGenToSink();
    graph.nodes.find((n) => n.id === "aud")!.audioGen!.n = 2;
    const events = await run(graph, worker);

    const produced = events.filter((e) => e.type === "artifact.produced" && e.artifact.kind === "audio");
    expect(produced.length).toBe(2);
  });

  it("fails the node when worker has no generateAudio method (no silent skip)", async () => {
    const { worker } = spyWorker({ noAudio: true });
    const events = await run(graphAudioGenToSink(), worker);

    const produced = events.filter((e) => e.type === "artifact.produced" && e.artifact.kind === "audio");
    expect(produced.length).toBe(0);

    // Honest failure instead of soft-skip (dogfood 2026-09-01)
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "aud");
    expect(failed).toBeDefined();
    expect(failed && failed.type === "node.failed" && failed.errorCode).toBe("VALIDATION");

    // Downstream does NOT run as if nothing happened
    const sinkFinished = events.find((e) => e.type === "node.finished" && e.nodeId === "sink");
    expect(sinkFinished).toBeUndefined();
  });

  it("audio artifact flows to downstream agent via inputFor placeholder", async () => {
    const { worker, calls } = spyWorker({ audioCount: 1 });
    const graph: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "Src", x: 0, y: 0, source: {} },
        { id: "aud", kind: "audioGen", name: "Aud", x: 1, y: 0, audioGen: { model: "tts-1", prompt: "test", format: "mp3", n: 1 } },
        { id: "agt", kind: "textGen", name: "Agt", x: 2, y: 0, textGen: TEXTGEN },
      ],
      edges: [
        { id: "e1", kind: "flow", from: "src", to: "aud" },
        { id: "e2", kind: "flow", from: "aud", to: "agt" },
      ],
    };
    await run(graph, worker);

    const agentCall = calls.find((c) => "input" in c && typeof c.input === "string" && c.input.includes("音频"));
    expect(agentCall).toBeDefined();
  });
});
