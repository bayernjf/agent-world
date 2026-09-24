import { compile, type Graph, type RunEvent, type Usage } from "@agent-world/core";
import { describe, expect, it, vi } from "vitest";
import { execute, resume } from "./engine.js";
import type { RemoteJobStore } from "./db.js";
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

/** In-memory RemoteJobStore so the async submit/poll path runs without a DB. */
function memoryStore() {
  const rows: Array<Record<string, unknown>> = [];
  const store = {
    userId: "u",
    async insert(job: Record<string, unknown>) {
      rows.push({ ...job });
    },
    async getOpen(runId: string, nodeId: string, attempt: number) {
      const open = rows.filter(
        (r) =>
          r.runId === runId &&
          r.nodeId === nodeId &&
          r.attempt === attempt &&
          r.state !== "succeeded" &&
          r.state !== "failed" &&
          r.state !== "lost",
      );
      return open[open.length - 1] ?? null;
    },
    async touch(id: string, state: string, lastPolledAt?: number) {
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.state = state;
        if (lastPolledAt !== undefined) r.lastPolledAt = lastPolledAt;
      }
    },
    async finish(id: string, state: string, errorCode?: string | null) {
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.state = state;
        r.finishedAt = Date.now();
        if (errorCode !== undefined && errorCode !== null) r.errorCode = errorCode;
      }
    },
  };
  return { store: store as unknown as RemoteJobStore, rows };
}

async function run(
  graph: Graph,
  worker: Worker,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  store?: RemoteJobStore,
) {
  const { plan } = compile(graph);
  if (!plan) throw new Error("graph did not compile");
  const events: RunEvent[] = [];
  for await (const e of execute({ runId: "r", graph, plan, worker, now, sleep, remoteJobStore: store })) {
    events.push(e);
  }
  return events;
}

async function resumeFrom(
  graph: Graph,
  worker: Worker,
  pastEvents: RunEvent[],
  action: "continue" | "approve" | "reattach" | "accept-degraded",
  store: RemoteJobStore,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  resetFrom?: string,
) {
  const { plan } = compile(graph);
  if (!plan) throw new Error("graph did not compile");
  const events: RunEvent[] = [];
  for await (
    const e of resume({
      runId: "r",
      graph,
      plan,
      worker,
      budgetUsd: null,
      pastEvents,
      action,
      resetFrom,
      now,
      sleep,
      remoteJobStore: store,
    })
  ) {
    events.push(e);
  }
  return events;
}

/** Virtual clock: each (instant) sleep advances by the backoff gap until the
 *  5-minute poll window closes and the node degrades. */
function virtualClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let clock = 0;
  return { now: () => clock, sleep: async (ms: number) => { clock += ms; } };
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
    const { store } = memoryStore();
    const events = await run(graphVideo(), worker, () => 0, async () => {}, store);

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
    const { store } = memoryStore();
    const events = await run(graphVideo(), worker, () => 0, async () => {}, store);

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "vid");
    expect(failed && failed.type === "node.failed" && failed.errorCode).toBe("PROVIDER_ERROR");
    expect(events.find((e) => e.type === "node.finished" && e.nodeId === "sink")).toBeUndefined();
  });

  it("propagates a known RATE_LIMIT code from the remote job", async () => {
    const { worker } = asyncWorker([{ state: "failed", error: "429", errorCode: "RATE_LIMIT" }]);
    const { store } = memoryStore();
    const events = await run(graphVideo(), worker, () => 0, async () => {}, store);

    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "vid");
    expect(failed && failed.type === "node.failed" && failed.errorCode).toBe("RATE_LIMIT");
  });

  it("degrades (halted, row left open) once the polling deadline trips", async () => {
    const { worker, query } = asyncWorker([{ state: "running" }]);
    const { store, rows } = memoryStore();
    const vc = virtualClock();
    const events = await run(graphVideo(), worker, vc.now, vc.sleep, store);

    // Timeout no longer fails: the node degrades and the run halts, with the
    // remote_jobs row left OPEN so a later reattach continues polling.
    const degraded = events.find((e) => e.type === "node.degraded" && e.nodeId === "vid");
    expect(degraded).toBeDefined();
    expect(degraded!.type === "node.degraded" && degraded.errorCode).toBe("TIMEOUT");
    const fin = events.find((e) => e.type === "run.finished");
    expect(fin!.type === "run.finished" && fin.status).toBe("halted");
    // It polled repeatedly rather than failing on the first pending status.
    expect(query.mock.calls.length).toBeGreaterThan(3);
    // The persisted row is still open (running), not failed.
    const open = rows.filter((r) => r.nodeId === "vid" && r.state === "running");
    expect(open.length).toBe(1);
    expect(events.find((e) => e.type === "node.finished" && e.nodeId === "sink")).toBeUndefined();
  });
});

describe("videoGen degraded recovery (G4 steps 4-6)", () => {
  it("reattach reuses the open job without resubmitting, then finishes", async () => {
    const polls: VideoJobPoll[] = [{ state: "running" }];
    const { worker, submit } = asyncWorker(polls);
    const { store } = memoryStore();
    const vc = virtualClock();
    const first = await run(graphVideo(), worker, vc.now, vc.sleep, store);
    expect(first.find((e) => e.type === "node.degraded")).toBeDefined();
    expect(submit).toHaveBeenCalledTimes(1);

    // The remote render has finished by the time the operator reattaches.
    polls.push({ state: "succeeded", results: [videoResult()] });
    const more = await resumeFrom(graphVideo(), worker, first, "reattach", store, () => 0, async () => {});

    // Same attempt, open row reused → still exactly one submit (no double bill).
    expect(submit).toHaveBeenCalledTimes(1);
    expect(more.filter((e) => e.type === "artifact.produced" && e.artifact.kind === "video").length).toBe(1);
    expect(more.find((e) => e.type === "node.finished" && e.nodeId === "sink")).toBeDefined();
  });

  it("accept-degraded welds downstream and records node.degradedAccepted (badge kept)", async () => {
    const polls: VideoJobPoll[] = [{ state: "running" }];
    const { worker } = asyncWorker(polls);
    const { store } = memoryStore();
    const vc = virtualClock();
    const first = await run(graphVideo(), worker, vc.now, vc.sleep, store);
    expect(first.find((e) => e.type === "node.degraded")).toBeDefined();

    const more = await resumeFrom(graphVideo(), worker, first, "accept-degraded", store, () => 0, async () => {});
    expect(more.find((e) => e.type === "node.degradedAccepted" && e.nodeId === "vid")).toBeDefined();
    // Downstream weld runs even though vid produced nothing.
    expect(more.find((e) => e.type === "node.finished" && e.nodeId === "sink")).toBeDefined();
  });

  it("marks REMOTE_JOB_LOST when the provider forgets the job; explicit resubmit bills again", async () => {
    const polls: VideoJobPoll[] = [{ state: "unknown" }];
    const { worker, submit } = asyncWorker(polls);
    const { store } = memoryStore();
    const first = await run(graphVideo(), worker, () => 0, async () => {}, store);

    const degraded = first.find((e) => e.type === "node.degraded" && e.nodeId === "vid");
    expect(degraded).toBeDefined();
    expect(degraded!.type === "node.degraded" && degraded.errorCode).toBe("REMOTE_JOB_LOST");

    // Operator explicitly resubmits (reset from vid): the lost row is skipped,
    // so a brand-new job is submitted and billed.
    polls.push({ state: "succeeded", results: [videoResult()] });
    const more = await resumeFrom(graphVideo(), worker, first, "continue", store, () => 0, async () => {}, "vid");
    expect(submit).toHaveBeenCalledTimes(2);
    expect(more.filter((e) => e.type === "artifact.produced" && e.artifact.kind === "video").length).toBe(1);
  });
});
