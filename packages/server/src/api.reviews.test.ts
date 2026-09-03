import type { Graph, RunEvent } from "@agent-world/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./db.js";
import type { StoredArtifact } from "./artifact-store.js";
import type { PendingReview } from "./reviews.js";

// The Hono app and its database are module singletons read at import time, so
// point DB_FILE at a scratch file before pulling ./index.js in.
let dir: string;
let app: Awaited<ReturnType<typeof import("./index.js")>>["app"];
let dbMod: typeof import("./db.js");
let reviewsMod: typeof import("./reviews.js");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "aw-reviews-"));
  process.env.DB_FILE = join(dir, "api.sqlite");
  // These tests exercise the review API, not registration policy; allow account
  // creation despite the M3 self-registration gate.
  vi.stubEnv("ALLOW_REGISTRATION", "1");
  app = (await import("./index.js")).app;
  dbMod = await import("./db.js");
  reviewsMod = await import("./reviews.js");
});

afterAll(() => {
  delete process.env.DB_FILE;
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function register(email: string): Promise<string> {
  const res = await app.request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = /auth_token=([^;]+)/.exec(cookie);
  if (!m) throw new Error(`no auth_token in set-cookie: ${cookie}`);
  return m[1]!;
}

function authed(token: string): Record<string, string> {
  return { cookie: `auth_token=${token}`, "content-type": "application/json" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls until the probe returns something truthy; the run drain is async. */
async function waitFor<T>(probe: () => Promise<T | null | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await sleep(50);
  }
}

async function fetchPending(
  headers: Record<string, string>,
  query = "",
): Promise<{ reviews: PendingReview[]; total: number }> {
  const res = await app.request(`/api/reviews/pending${query}`, { headers });
  expect(res.status).toBe(200);
  return (await res.json()) as { reviews: PendingReview[]; total: number };
}

async function decide(headers: Record<string, string>, body: unknown) {
  return app.request("/api/reviews/decide", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const REVIEW_PROMPT = "确认可否发布";

/** source → human → sink: halts on the human node without any LLM or network. */
function reviewGraph(id: string, name: string): Graph {
  return {
    id,
    name,
    nodes: [
      { id: "src", kind: "source", name: "原料", x: 0, y: 0 },
      { id: "rev", kind: "human", name: "人工审核", x: 1, y: 0, human: { prompt: REVIEW_PROMPT } },
      { id: "sink", kind: "sink", name: "成品", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "rev", kind: "flow" },
      { id: "e2", from: "rev", to: "sink", kind: "flow" },
    ],
  } as Graph;
}

/** Creates a graph, runs it and waits for it to show up in the review queue. */
async function parkRun(headers: Record<string, string>, input = "春季新款连衣裙文案") {
  // Graph names must be unique per user, so a test that parks two runs needs
  // two distinct names (PUT /api/graphs/:id 409s on a collision).
  const name = `评审产线-${Math.random().toString(36).slice(2, 8)}`;
  const created = await app.request("/api/graphs", {
    method: "POST",
    headers,
    body: JSON.stringify({ name }),
  });
  const { id: graphId } = (await created.json()) as { id: string };
  const saved = await app.request(`/api/graphs/${graphId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(reviewGraph(graphId, name)),
  });
  expect(saved.status).toBe(200);

  const runRes = await app.request("/api/runs", {
    method: "POST",
    headers,
    body: JSON.stringify({ graphId, input }),
  });
  const { runId } = (await runRes.json()) as { runId: string };

  const review = await waitFor(async () => {
    const { reviews } = await fetchPending(headers);
    return reviews.find((r) => r.runId === runId);
  });
  return { graphId, graphName: name, runId, review };
}

describe("review queue API", () => {
  it("lists a halted run with the context an operator needs to decide", async () => {
    const headers = authed(await register(`review-ctx-${Date.now()}@t.test`));
    const { graphId, graphName, review } = await parkRun(headers);

    expect(review.kind).toBe("human");
    expect(review.nodeId).toBe("rev");
    expect(review.nodeName).toBe("人工审核");
    // The `human:` prefix is engine plumbing, not something to show an operator.
    expect(review.reason).toBe(REVIEW_PROMPT);
    expect(review.content).toBe("春季新款连衣裙文案");
    expect(review.contentTruncated).toBe(false);
    expect(review.graphId).toBe(graphId);
    expect(review.graphName).toBe(graphName);
    expect(review.trigger).toBe("manual");
    expect(review.waitingMs).toBeGreaterThanOrEqual(0);
    expect(review.haltedAt).toBeGreaterThanOrEqual(review.startedAt);
  });

  it("approve drives the run to done and files the product under its pipeline", async () => {
    const headers = authed(await register(`review-ok-${Date.now()}@t.test`));
    const { graphId, graphName, runId } = await parkRun(headers);

    const res = await decide(headers, [{ runId, action: "approve" }]);
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as {
      results: Array<{ runId: string; ok: boolean; action?: string }>;
    };
    expect(results).toEqual([{ runId, ok: true, action: "approve" }]);

    // The sink only archives once the decision lets the run through, and the
    // resume path must stamp graphId/role or the gallery shows "(未知流水线)".
    const artifact = await waitFor(async () => {
      const list = await app.request(`/api/runs/${runId}/artifacts`, { headers });
      const rows = (await list.json()) as StoredArtifact[];
      return rows.find((a) => a.nodeId === "sink");
    });
    expect(artifact.graphId).toBe(graphId);
    expect(artifact.role).toBe("final");
    expect(artifact.graphName).toBe(graphName);

    // A decided run leaves the queue.
    await waitFor(async () => {
      const { reviews } = await fetchPending(headers);
      return reviews.every((r) => r.runId !== runId) ? true : null;
    });
  });

  it("edit sends the operator's text downstream instead of the model's", async () => {
    const headers = authed(await register(`review-edit-${Date.now()}@t.test`));
    const { runId } = await parkRun(headers);

    const res = await decide(headers, [
      { runId, action: "edit", editOutput: { rev: "人工改过的合规文案" } },
    ]);
    expect(res.status).toBe(200);

    const artifact = await waitFor(async () => {
      const list = await app.request(`/api/runs/${runId}/artifacts`, { headers });
      const rows = (await list.json()) as StoredArtifact[];
      return rows.find((a) => a.nodeId === "sink");
    });
    const body = await app.request(`/api/artifacts/${artifact.id}`, { headers });
    expect(await body.text()).toContain("人工改过的合规文案");
  });

  it("reject fails the run and clears it from the queue", async () => {
    const headers = authed(await register(`review-no-${Date.now()}@t.test`));
    const { runId } = await parkRun(headers);

    const res = await decide(headers, [{ runId, action: "reject" }]);
    expect(res.status).toBe(200);

    const status = await waitFor(async () => {
      const list = await app.request(`/api/runs?limit=50`, { headers });
      const { runs } = (await list.json()) as { runs: Array<{ id: string; status: string }> };
      const row = runs.find((r) => r.id === runId);
      return row && row.status !== "halted" ? row.status : null;
    });
    expect(status).toBe("failed");
    const { reviews } = await fetchPending(headers);
    expect(reviews.map((r) => r.runId)).not.toContain(runId);

    // A crashed resume lands on "failed" too, so check the rejection was really
    // processed: the decision and the node failure must both be in the log.
    const log = await app.request(`/api/runs/${runId}/events`, { headers });
    const { events } = (await log.json()) as { events: RunEvent[] };
    expect(
      events.some((e) => e.type === "human.decision" && e.nodeId === "rev" && e.decision === "rejected"),
    ).toBe(true);
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "rev")).toBe(true);
    const seqs = events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("deciding the same run twice in one batch 409s the duplicate", async () => {
    const headers = authed(await register(`review-twice-${Date.now()}@t.test`));
    const { runId } = await parkRun(headers);

    const res = await decide(headers, [
      { runId, action: "approve" },
      { runId, action: "approve" },
    ]);
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as {
      results: Array<{ runId: string; ok: boolean; status?: number }>;
    };
    expect(results[0]).toMatchObject({ ok: true });
    // A double-click must not dispatch a second resume of the same run.
    expect(results[1]).toMatchObject({ ok: false, status: 409 });
  });
});

describe("review queue scoping", () => {
  it("requires authentication", async () => {
    const res = await app.request("/api/reviews/pending");
    expect(res.status).toBe(401);
    const decideRes = await decide({ "content-type": "application/json" }, [
      { runId: "x", action: "approve" },
    ]);
    expect(decideRes.status).toBe(401);
  });

  it("never shows or decides another tenant's runs", async () => {
    const mine = authed(await register(`review-a-${Date.now()}@t.test`));
    const theirs = authed(await register(`review-b-${Date.now()}@t.test`));
    const { runId } = await parkRun(mine);

    const asOther = await fetchPending(theirs);
    expect(asOther.total).toBe(0);
    expect(asOther.reviews).toEqual([]);

    const res = await decide(theirs, [{ runId, action: "approve" }]);
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as {
      results: Array<{ runId: string; ok: boolean; status?: number }>;
    };
    expect(results[0]).toMatchObject({ ok: false, status: 404 });

    // The owner's run is untouched and still waiting.
    const stillPending = await fetchPending(mine);
    expect(stillPending.reviews.map((r) => r.runId)).toContain(runId);
  });

  it("filters by graphId and paginates with a total count", async () => {
    const headers = authed(await register(`review-page-${Date.now()}@t.test`));
    const first = await parkRun(headers, "第一篇");
    const second = await parkRun(headers, "第二篇");
    expect(first.graphId).not.toBe(second.graphId);

    const onlyFirst = await fetchPending(headers, `?graphId=${first.graphId}`);
    expect(onlyFirst.total).toBe(1);
    expect(onlyFirst.reviews.map((r) => r.runId)).toEqual([first.runId]);

    const page = await fetchPending(headers, "?limit=1");
    expect(page.total).toBe(2);
    expect(page.reviews).toHaveLength(1);
    // Longest-waiting first: `first` halted before `second`.
    expect(page.reviews[0]!.runId).toBe(first.runId);
    const next = await fetchPending(headers, "?limit=1&offset=1");
    expect(next.reviews[0]!.runId).toBe(second.runId);
  });
});

describe("review queue batch validation", () => {
  it("400s on a malformed body", async () => {
    const headers = authed(await register(`review-bad-${Date.now()}@t.test`));
    const bodies: unknown[] = [
      "nope",
      { runId: "x", action: "approve" },
      [],
      [null],
      [{ action: "approve" }],
      [{ runId: "", action: "approve" }],
      [{ runId: "x", action: "ship" }],
      Array.from({ length: 51 }, (_, i) => ({ runId: `r${i}`, action: "approve" })),
    ];
    for (const body of bodies) {
      const res = await decide(headers, body);
      expect(res.status).toBe(400);
      const { error } = (await res.json()) as { error: string };
      expect(error.length).toBeGreaterThan(0);
    }
  });

  it("reports an unknown run per item without aborting the rest of the batch", async () => {
    const headers = authed(await register(`review-mix-${Date.now()}@t.test`));
    const { runId } = await parkRun(headers);

    const res = await decide(headers, [
      { runId: "does-not-exist", action: "approve" },
      { runId, action: "scrap" },
    ]);
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as {
      results: Array<{ runId: string; ok: boolean; status?: number; action?: string }>;
    };
    expect(results[0]).toMatchObject({ runId: "does-not-exist", ok: false, status: 404 });
    expect(results[1]).toMatchObject({ runId, ok: true, action: "scrap" });

    await waitFor(async () => {
      const { reviews } = await fetchPending(headers);
      return reviews.every((r) => r.runId !== runId) ? true : null;
    });
  });
});

describe("pending review aggregation (store level)", () => {
  const U = "u1";

  function seedHalted(
    db: Db,
    opts: {
      runId: string;
      graph: Graph;
      startedAt: number;
      haltedAt: number;
      reason: string;
      nodeId?: string;
      reviewContent?: string;
      verdictReason?: string;
      /** Simulate a row written before migration 20: no halted columns. */
      legacy?: boolean;
      /** Simulate a log written before halt recording: no context anywhere. */
      noHaltInfo?: boolean;
    },
  ) {
    const nodeId = opts.nodeId ?? "rev";
    db.createRun({
      id: opts.runId,
      userId: U,
      graph: opts.graph,
      budgetUsd: null,
      at: opts.startedAt,
      input: "输入",
    });
    let seq = 0;
    const events: RunEvent[] = [];
    if (opts.reviewContent !== undefined) {
      events.push({
        seq: seq++,
        ts: opts.startedAt,
        type: "human.review",
        nodeId,
        attempt: 1,
        content: opts.reviewContent,
      });
    }
    if (opts.verdictReason !== undefined) {
      events.push({
        seq: seq++,
        ts: opts.startedAt,
        type: "gate.verdict",
        nodeId,
        attempt: 1,
        passed: false,
        reason: opts.verdictReason,
      });
    }
    events.push({
      seq: seq++,
      ts: opts.haltedAt,
      type: "run.finished",
      runId: opts.runId,
      status: "halted",
      ...(opts.noHaltInfo ? {} : { haltedNodeId: nodeId, reason: opts.reason }),
    });
    for (const event of events) db.record(opts.runId, event);
    db.finishRun(
      opts.runId,
      U,
      "halted",
      opts.haltedAt,
      opts.legacy ? undefined : { nodeId, reason: opts.reason },
    );
  }

  it("orders longest-waiting first and reports wait time against the caller's clock", () => {
    const db = dbMod.openDb(":memory:");
    const graph = reviewGraph("g1", "评审产线");
    db.saveGraph(graph, 1_000, U);
    const t = 1_700_000_000_000;
    seedHalted(db, { runId: "r-new", graph, startedAt: t, haltedAt: t + 3_000, reason: "human:确认可否发布" });
    seedHalted(db, { runId: "r-old", graph, startedAt: t, haltedAt: t + 1_000, reason: "human:确认可否发布" });
    seedHalted(db, { runId: "r-mid", graph, startedAt: t, haltedAt: t + 2_000, reason: "human:确认可否发布" });

    const { reviews, total } = reviewsMod.listPendingReviews(db, U, { now: t + 10_000 });
    expect(total).toBe(3);
    expect(reviews.map((r) => r.runId)).toEqual(["r-old", "r-mid", "r-new"]);
    expect(reviews[0]!.waitingMs).toBe(9_000);
    expect(reviews[0]!.graphName).toBe("评审产线");
    expect(reviews[0]!.nodeName).toBe("人工审核");

    // Pagination keeps the FIFO order and still reports the full total.
    const page = reviewsMod.listPendingReviews(db, U, { limit: 1, offset: 1, now: t + 10_000 });
    expect(page.total).toBe(3);
    expect(page.reviews.map((r) => r.runId)).toEqual(["r-mid"]);
  });

  it("keeps non-halted runs out of the queue", () => {
    const db = dbMod.openDb(":memory:");
    const graph = reviewGraph("g1", "评审产线");
    db.saveGraph(graph, 1_000, U);
    const t = 1_700_000_000_000;
    seedHalted(db, { runId: "r-halted", graph, startedAt: t, haltedAt: t, reason: "human:x" });
    db.createRun({ id: "r-done", userId: U, graph, budgetUsd: null, at: t });
    db.finishRun("r-done", U, "done", t + 10);

    const { reviews, total } = reviewsMod.listPendingReviews(db, U);
    expect(total).toBe(1);
    expect(reviews.map((r) => r.runId)).toEqual(["r-halted"]);
  });

  it("resolves halt context from the event log for rows written before migration 20", () => {
    const db = dbMod.openDb(":memory:");
    const graph = reviewGraph("g1", "评审产线");
    db.saveGraph(graph, 1_000, U);
    seedHalted(db, {
      runId: "r-legacy",
      graph,
      startedAt: 2_000,
      haltedAt: 3_000,
      reason: "human:确认可否发布",
      reviewContent: "旧版本暂停的产出",
      legacy: true,
    });

    const { reviews } = reviewsMod.listPendingReviews(db, U, { now: 10_000 });
    expect(reviews).toHaveLength(1);
    // A pre-migration run must not drop off the queue with an empty reason.
    expect(reviews[0]!.nodeId).toBe("rev");
    expect(reviews[0]!.kind).toBe("human");
    expect(reviews[0]!.reason).toBe("确认可否发布");
    expect(reviews[0]!.content).toBe("旧版本暂停的产出");
  });

  it("still queues a run whose log predates halt recording", () => {
    const db = dbMod.openDb(":memory:");
    const graph = reviewGraph("g1", "评审产线");
    db.saveGraph(graph, 1_000, U);
    // Neither the columns nor the log say where it parked. Listing it with no
    // node beats dropping it: the operator can still open the run and decide.
    seedHalted(db, {
      runId: "r-ancient",
      graph,
      startedAt: 2_000,
      haltedAt: 3_000,
      reason: "human:确认可否发布",
      legacy: true,
      noHaltInfo: true,
    });

    const { reviews, total } = reviewsMod.listPendingReviews(db, U);
    expect(total).toBe(1);
    expect(reviews[0]!.runId).toBe("r-ancient");
    expect(reviews[0]!.nodeId).toBeNull();
    expect(reviews[0]!.nodeName).toBeNull();
    expect(reviews[0]!.content).toBeNull();
  });

  it("previews long review content and flags the truncation", () => {
    const db = dbMod.openDb(":memory:");
    const graph = reviewGraph("g1", "评审产线");
    db.saveGraph(graph, 1_000, U);
    const long = "很长的文案".repeat(reviewsMod.PREVIEW_CHARS);
    seedHalted(db, {
      runId: "r-long",
      graph,
      startedAt: 2_000,
      haltedAt: 2_000,
      reason: "human:确认可否发布",
      reviewContent: long,
    });

    const { reviews } = reviewsMod.listPendingReviews(db, U);
    expect(long.length).toBeGreaterThan(reviewsMod.PREVIEW_CHARS);
    expect(reviews[0]!.content).toHaveLength(reviewsMod.PREVIEW_CHARS);
    expect(reviews[0]!.contentTruncated).toBe(true);
  });

  it("names a deleted pipeline instead of returning an empty row", () => {
    const db = dbMod.openDb(":memory:");
    // No saveGraph: the graph row is gone but the halted run still needs a label.
    seedHalted(db, {
      runId: "r-orphan",
      graph: reviewGraph("g-gone", "评审产线"),
      startedAt: 2_000,
      haltedAt: 2_000,
      reason: "human:确认可否发布",
    });
    const { reviews } = reviewsMod.listPendingReviews(db, U);
    expect(reviews[0]!.graphName).toBe("(已删除产线)");
    // The snapshot still resolves the node name.
    expect(reviews[0]!.nodeName).toBe("人工审核");
  });

  it("splits dangerous-tool and gate halts into their own review kinds", () => {
    const db = dbMod.openDb(":memory:");
    const graph = reviewGraph("g1", "评审产线");
    db.saveGraph(graph, 1_000, U);
    seedHalted(db, {
      runId: "r-tool",
      graph,
      startedAt: 2_000,
      haltedAt: 2_000,
      reason: "dangerous-tool:shell",
    });
    seedHalted(db, {
      runId: "r-gate",
      graph,
      startedAt: 2_000,
      haltedAt: 2_100,
      reason: "评审连续三次不达标",
      verdictReason: "评审连续三次不达标",
    });

    const byId = new Map(reviewsMod.listPendingReviews(db, U).reviews.map((r) => [r.runId, r]));
    expect(byId.get("r-tool")).toMatchObject({ kind: "tool", tool: "shell", content: null });
    expect(byId.get("r-gate")).toMatchObject({
      kind: "gate",
      detail: "评审连续三次不达标",
      reason: "评审连续三次不达标",
      tool: null,
    });
  });

  it("classifies halt reasons by prefix", () => {
    expect(reviewsMod.classifyHalt("human:确认")).toBe("human");
    expect(reviewsMod.classifyHalt("dangerous-tool:shell")).toBe("tool");
    expect(reviewsMod.classifyHalt("评审不达标")).toBe("gate");
    // A null reason predates halt recording; treat it as the generic case.
    expect(reviewsMod.classifyHalt(null)).toBe("gate");
  });

  it("scopes the queue to one tenant", () => {
    const db = dbMod.openDb(":memory:");
    const graph = reviewGraph("g1", "评审产线");
    db.saveGraph(graph, 1_000, U);
    seedHalted(db, { runId: "r1", graph, startedAt: 2_000, haltedAt: 2_000, reason: "human:x" });
    expect(reviewsMod.listPendingReviews(db, "someone-else").total).toBe(0);
  });
});

describe("parseDecisions", () => {
  it("accepts a batch and carries the decision payload through", () => {
    const out = reviewsMod.parseDecisions([
      { runId: "r1", action: "approve" },
      { runId: "r2", action: "edit", editOutput: { n1: "改过的" }, approveTools: ["shell", 42] },
    ]);
    expect(out.error).toBeUndefined();
    expect(out.decisions).toEqual([
      { runId: "r1", action: "approve" },
      { runId: "r2", action: "edit", editOutput: { n1: "改过的" }, approveTools: ["shell"] },
    ]);
  });

  it("rejects everything that is not a well-formed batch", () => {
    expect(reviewsMod.parseDecisions(null).error).toBeDefined();
    expect(reviewsMod.parseDecisions({ runId: "r1" }).error).toBeDefined();
    expect(reviewsMod.parseDecisions([]).error).toBeDefined();
    expect(reviewsMod.parseDecisions(["r1"]).error).toBeDefined();
    expect(reviewsMod.parseDecisions([{ action: "approve" }]).error).toBeDefined();
    expect(reviewsMod.parseDecisions([{ runId: "r1" }]).error).toBeDefined();
    const tooMany = Array.from({ length: reviewsMod.MAX_DECISIONS_PER_CALL + 1 }, (_, i) => ({
      runId: `r${i}`,
      action: "approve",
    }));
    expect(reviewsMod.parseDecisions(tooMany).error).toContain(
      String(reviewsMod.MAX_DECISIONS_PER_CALL),
    );
  });

  it("names the offending item so an operator can find it", () => {
    const { error } = reviewsMod.parseDecisions([
      { runId: "r1", action: "approve" },
      { runId: "r2", action: "ship" },
    ]);
    expect(error).toContain("第 2 条");
    expect(error).toContain("approve");
  });
});
