import { compile, type Graph, type RunEvent, type Usage } from "@agent-world/core";
import { describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import {
  nextVideoPollDelayMs,
  VIDEO_POLL_BASE_DELAY_MS,
  VIDEO_POLL_MAX_DELAY_MS,
} from "./nodes/videogen.js";
import type { VideoGenResult, VideoJobPoll, Worker } from "./worker.js";

function videoResult(): VideoGenResult {
  return {
    data: Buffer.from("fake-video"),
    mimeType: "video/mp4",
    durationSec: 5,
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0, units: { seconds: 5 } } as Usage,
  };
}

/** Worker with ONLY the async submit+poll seam (no generateVideo at all). */
function asyncWorker(polls: VideoJobPoll[]): { worker: Worker; submit: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> } {
  const submit = vi.fn(async () => ({ jobId: "job-1", provider: "fake" }));
  const query = vi.fn(async () => polls[Math.min(query.mock.calls.length - 1, polls.length - 1)]!);
  const worker = {
    async *runTextGen() {
      yield { type: "text-delta", text: "ok" };
      return { output: "out", usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    },
    async judge() {
      return { passed: true, reason: "" };
    },
    async generateImage() {
      return [];
    },
    submitVideoJob: submit,
    queryVideoJob: query,
  } as unknown as Worker;
  return { worker, submit, query };
}

function graphVideo(): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "Src", x: 0, y: 0, source: {} },
      { id: "vid", kind: "videoGen", name: "Vid", x: 1, y: 0, videoGen: { model: "video-gen", prompt: "test", n: 1 } },
      { id: "sink", kind: "sink", name: "Sink", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", kind: "flow", from: "src", to: "vid" },
      { id: "e2", kind: "flow", from: "vid", to: "sink" },
    ],
  };
}

async function run(graph: Graph, worker: Worker, now: () => number, sleep: (ms: number) => Promise<void>) {
  const { plan } = compile(graph);
  if (!plan) throw new Error("graph did not compile");
  const events: RunEvent[] = [];
  for await (const e of execute({ runId: "r", graph, plan, worker, now, sleep })) {
    events.push(e);
  }
  return events;
}

describe("nextVideoPollDelayMs", () => {
  it("doubles with backoff and caps", () => {
    expect(nextVideoPollDelayMs(0)).toBe(VIDEO_POLL_BASE_DELAY_MS);
    expect(nextVideoPollDelayMs(1)).toBe(VIDEO_POLL_BASE_DELAY_MS * 2);
    expect(nextVideoPollDelayMs(100)).toBe(VIDEO_POLL_MAX_DELAY_MS);
  });
});

describe("videoGen async submit+poll seam (G4.4)", () => {
  it("submits once, polls through running, then produces the artifact without generateVideo", async () => {
    const { worker, submit, query } = asyncWorker([
      { state: "running" },
      { state: "pending" },
      { state: "succeeded", results: [videoResult()] },
    ]);
    const events = await run(graphVideo(), worker, () => 0, async () => {});

    expect(submit).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(3);
    // Never fell back to the synchronous seam.
    expect((worker as Partial<Worker>).generateVideo).toBeUndefined();

    const produced = events.filter((e) => e.type === "artifact.produced" && e.artifact.kind === "video");
    expect(produced.length).toBe(1);
    const finished = events.find((e) => e.type === "node.finished" && e.nodeId === "vid");
    expect(finished).toBeDefined();
    expect(finished!.type === "node.finished" && finished.usage?.units?.seconds).toBe(5);
    // Downstream proceeds once the remote job succeeds.
    expect(events.find((e) => e.type === "node.finished" && e.nodeId === "sink")).toBeDefined();
  });

  it("fails with PROVIDER_ERROR when the remote job fails", async () => {
    const { worker } = asyncWorker([{ state: "failed", error: "render boom" }]);
    const events = await run(graphVideo(), worker, () => 0, async () => {});

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "vid");
    expect(failed && failed.type === "node.failed" && failed.errorCode).toBe("PROVIDER_ERROR");
    expect(events.find((e) => e.type === "node.finished" && e.nodeId === "sink")).toBeUndefined();
  });

  it("propagates a known RATE_LIMIT code from the remote job", async () => {
    const { worker } = asyncWorker([{ state: "failed", error: "429", errorCode: "RATE_LIMIT" }]);
    const events = await run(graphVideo(), worker, () => 0, async () => {});

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "vid");
    expect(failed && failed.type === "node.failed" && failed.errorCode).toBe("RATE_LIMIT");
  });

  it("fails with TIMEOUT once the polling deadline trips", async () => {
    // Virtual clock advances by the backoff gap on every (instant) sleep.
    let clock = 0;
    const sleep = async (ms: number) => {
      clock += ms;
    };
    const { worker, query } = asyncWorker([{ state: "running" }]);
    const events = await run(graphVideo(), worker, () => clock, sleep);

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "vid");
    expect(failed && failed.type === "node.failed" && failed.errorCode).toBe("TIMEOUT");
    // It polled repeatedly rather than failing on the first pending status.
    expect(query.mock.calls.length).toBeGreaterThan(3);
  });
});
