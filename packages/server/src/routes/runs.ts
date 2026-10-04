/** Runs route domain (audit P2-2 split from index.ts). */
import { audit } from "../audit.js";
import { runBatch } from "../batch.js";
import { loadConfig } from "../config.js";
import { validateModels } from "../validate-models.js";
import { buildFailureInfo, diagnoseRun } from "../diagnose.js";
import { quotaResponseBody } from "../dispatch-gate.js";
import type { SnapshotLike } from "../graph-snapshot.js";
import { SnapshotLikeSchema, parseGraphSnapshot } from "../graph-snapshot.js";
import { log } from "../logger.js";
import { graphAccessRole, hasAtLeast, requireGraph, requireRun, runAccessRole, visibleGraphs } from "../rbac.js";
import { listPendingReviews, parseDecisions } from "../reviews.js";
import type { ResumeAction } from "../run.js";
import { RunStartError, startRun, resumeRun, forkRun } from "../run.js";
import { errMsg } from "../safe-utils.js";
import { clientIp, jsonResponse, runLimiter } from "./shared.js";
import { Graph, RunEvent, buildTimeline, compile, envelope, parseCsv, replay } from "@agent-world/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";

/** Sentinel in idempotency_keys.run_id while the winner is still creating. */
const PENDING_RUN_ID = "";
/** A pending claim this old can only belong to a crashed request; steal it. */
const IDEMPOTENT_CLAIM_STALE_MS = 15 * 60_000;
import type { RouteContext } from "./ctx.js";

export function registerRunsRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  ctx: RouteContext,
): void {
  const { PUBLIC_URL, artifacts, db, live, triggers, worker, workerRegistry } = ctx;

app.get("/api/runs", async (c) => {
  const userId = c.get("userId");
  const limit = Number(c.req.query("limit") ?? 50);
  const offset = Number(c.req.query("offset") ?? 0);
  const graphId = c.req.query("graphId");
  const status = c.req.query("status");
  const q = c.req.query("q");
  // Runs of owned + shared graphs (design-rbac P1). Collaborators' runs are
  // saved under the graph owner, so we scope by visible graph ids, not user_id.
  const graphIds = [...(await visibleGraphs(db, userId)).keys()];
  const { rows, total } = await db.listRuns(userId, {
    limit,
    offset,
    graphId: graphId || undefined,
    status: status || undefined,
    q: q || undefined,
    graphIds,
  });
  return c.json({ runs: rows, total });
});

app.get("/api/runs/:id/stats", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!await requireRun(db, userId, runId, "viewer")) return c.json({ error: "not found" }, 404);
  return c.json(await db.runStats(runId));
});

/**
 * Step-level trace (G1): run metadata plus a per-node / per-attempt timeline
 * projected from the event stream. Read-only — output is returned as a preview;
 * full output stays behind the existing event / artifact surfaces.
 */
app.get("/api/runs/:id/timeline", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!await requireRun(db, userId, runId, "viewer")) return c.json({ error: "not found" }, 404);
  const run = await db.getRunById(runId);
  if (!run) return c.json({ error: "not found" }, 404);
  const events = await db.events(runId);
  // The event stream only carries node ids; resolve human-readable name/kind
  // from the snapshot captured when the run started (best-effort).
  let snapshot: SnapshotLike = null;
  try {
    const parsed: unknown = typeof run.snapshot === "string" ? JSON.parse(run.snapshot) : run.snapshot;
    if (parsed !== null && typeof parsed === "object") snapshot = SnapshotLikeSchema.parse(parsed);
  } catch {
    snapshot = null;
  }
  const nodeMeta: Record<string, { name: string | null; kind: string | null }> = {};
  for (const n of snapshot?.nodes ?? []) {
    nodeMeta[n.id] = { name: n.name ?? null, kind: n.kind ?? null };
  }
  return c.json({
    run: {
      id: run.id,
      graphId: run.graph_id,
      status: run.status,
      trigger: run.trigger ?? "manual",
      startedAt: run.started_at,
      endedAt: run.ended_at ?? null,
      budgetUsd: run.budget_usd ?? null,
      haltedNodeId: run.halted_node_id ?? null,
      haltedReason: run.halted_reason ?? null,
      // G5.1: starting feed, so the A/B entry can preview and reuse it.
      input: run.input ?? "",
    },
    nodeMeta,
    timeline: buildTimeline(events),
  });
});

/**
 * Full node output for one attempt (G1): the timeline projection only returns a
 * truncated preview, so the complete `node.finished` output is lazy-loaded on
 * demand. Read-only and projected straight from the event stream — no schema
 * migration and no driver change. When several variants share (node, attempt),
 * the `main` lane is preferred.
 */
app.get("/api/runs/:id/nodes/:nodeId/attempt/:attempt/output", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  const nodeId = c.req.param("nodeId");
  const attemptNum = Number.parseInt(c.req.param("attempt"), 10);
  if (!Number.isInteger(attemptNum) || attemptNum < 1) {
    return c.json({ error: "bad attempt" }, 400);
  }
  if (!await requireRun(db, userId, runId, "viewer")) return c.json({ error: "not found" }, 404);
  const events = await db.events(runId);
  const finished = events.filter(
    (e): e is Extract<RunEvent, { type: "node.finished" }> =>
      e.type === "node.finished" && e.nodeId === nodeId && e.attempt === attemptNum,
  );
  const pick = finished.find((e) => (e.variant ?? "main") === "main") ?? finished[finished.length - 1];
  if (!pick) return c.json({ error: "not found" }, 404);
  return c.json({
    nodeId: pick.nodeId,
    attempt: pick.attempt,
    variant: pick.variant ?? "main",
    output: pick.output,
  });
});

/**
 * LLM-assisted diagnosis for a failed run: distils the event log + snapshot
 * into a prompt and asks the user's default model for a root cause and fix.
 * Best-effort: provider/quota failures surface as 503, never a 500.
 */
app.post("/api/runs/:id/diagnose", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!await requireRun(db, userId, runId, "viewer")) return c.json({ error: "not found" }, 404);
  const run = await db.getRunById(runId);
  if (!run) return c.json({ error: "not found" }, 404);
  let snapshot: unknown = null;
  try {
    snapshot = run.snapshot ? JSON.parse(run.snapshot as string) : null;
  } catch {
    snapshot = null;
  }
  const events = await db.events(runId);
  const info = buildFailureInfo({
    graphName: (snapshot as { name?: string } | null)?.name ?? run.graph_id,
    status: run.status,
    trigger: run.trigger ?? "manual",
    events,
    snapshot,
  });
  try {
    const result = await diagnoseRun(worker, userId, info);
    return c.json(result);
  } catch (err) {
    log.warn("run diagnosis failed", { runId, error: errMsg(err) });
    return c.json({ error: "diagnosis_unavailable", message: errMsg(err) }, 503);
  }
});

/** The graph as it was when this run started (snapshot), used to render a
 *  historical run's finished product in the gallery. */
app.get("/api/runs/:id/graph", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!await requireRun(db, userId, runId, "viewer")) return c.json({ error: "not found" }, 404);
  const run = await db.getRunById(runId);
  if (!run) return c.json({ error: "not found" }, 404);
  try {
    return c.json(JSON.parse(run.snapshot));
  } catch {
    return c.json({ error: "snapshot corrupted" }, 500);
  }
});

// --- Knowledge base / archive (5.2) ---
app.post("/api/runs", async (c) => {
  const userId = c.get("userId");
  if (!runLimiter.allow(`run:${userId}`)) {
    return c.json({ error: "派发过于频繁，请稍后再试" }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    graphId?: string;
    budgetUsd?: number | null;
    trigger?: string;
    input?: string;
    connectorValues?: Record<string, string>;
    workerId?: string;
  };
  // Default to the most recently updated graph the caller can see (owned or
  // shared), so a collaborator with no owned graphs can still hit Run.
  const visible = await visibleGraphs(db, userId);
  const graphId = body.graphId ?? [...visible.keys()][0];
  if (!graphId) return c.json({ error: "no graphs found — create one first" }, 400);
  // Running requires editor access. The run executes under the graph OWNER's
  // identity so config (models/keys), variables, banned terms, cost accounting,
  // and subgraph resolution stay consistent with the owner's context.
  const access = await requireGraph(db, userId, graphId, "editor");
  if (!access) {
    return await graphAccessRole(db, userId, graphId) == null
      ? c.json({ error: "not found" }, 404)
      : c.json({ error: "forbidden", message: "只读协作者不能运行产线" }, 403);
  }
  const ownerId = access.graphOwnerId;
  const graph = await db.getGraph(graphId, ownerId);
  if (!graph) return c.json({ error: "graph not found" }, 404);

  const modelDiags = validateModels(graph, await loadConfig(ownerId));
  const modelErrors = modelDiags.filter((d) => d.severity === "error");
  if (modelErrors.length > 0) {
    const summary =
      modelErrors.length === 1
        ? modelErrors[0]!.message
        : `${modelErrors.length} 个节点未配置模型：${modelErrors[0]!.message}${modelErrors.length > 1 ? "（其余见 diagnostics）" : ""}`;
    return c.json(
      {
        error: "graph has unconfigured model(s)",
        message: `${summary} 请按上方提示补全对应配置后再派发。`,
        diagnostics: modelDiags,
      },
      422,
    );
  }

  // 订阅 / demo 配额闸门已移入 startRun()（dispatch-gate.ts），这样重跑、批量、
  // 触发器、AB 每一条派发路都盖得到，而不是只有这一条。402 体由下面
  // startRun 的 catch 经 quotaResponseBody 统一生成。

  // 幂等（engineering-blueprint §2）：同一 Idempotency-Key 重复提交只建一次 run，
  // 返回第一次的 runId——堵「双击运行 / 重试建重复 run 重复烧钱」。
  const idempotencyKey = c.req.header("Idempotency-Key") || undefined;
  // The claim is opened before the run exists. Read-then-create-then-write let
  // two concurrent same-key requests both miss the read and both create (and
  // bill) a run, the loser quietly detached from the mapping (audit 7.6).
  let claimedKey: string | null = null;
  if (idempotencyKey) {
    const existing = await db.getIdempotentRun(userId, idempotencyKey);
    if (existing) {
      return c.json({ runId: existing, diagnostics: [], modelWarnings: modelDiags, replay: true });
    }
    let won = await db.claimIdempotencyKey(userId, idempotencyKey, PENDING_RUN_ID);
    if (
      !won &&
      (await db.stealStaleIdempotentClaim(userId, idempotencyKey, Date.now() - IDEMPOTENT_CLAIM_STALE_MS))
    ) {
      // A pending claim this old belongs to a request that died mid-run; without
      // stealing it the key stays wedged against its owner's every retry.
      won = await db.claimIdempotencyKey(userId, idempotencyKey, PENDING_RUN_ID);
    }
    if (!won) {
      return c.json({ error: "another request with this Idempotency-Key is in flight", idempotencyKey }, 409);
    }
    claimedKey = idempotencyKey;
  }

  try {
    const { runId, diagnostics } = await startRun({
      db,
      userId: ownerId,
      worker: workerRegistry.get(body.workerId),
      artifacts,
      live,
      graph,
      trigger: body.trigger ?? "manual",
      budgetUsd: body.budgetUsd ?? null,
      input: body.input,
      connectorValues: body.connectorValues,
      publicUrl: PUBLIC_URL,
      onFinish: (gid, status) => {
        void triggers.onGraphFinished(gid, status);
      },
      onArtifact: (aid) => {
        void triggers.onArtifact(aid);
      },
    });
    if (claimedKey) {
      await db.saveIdempotentRun(userId, claimedKey, runId);
      claimedKey = null;
    }
    // Audit records the actual operator, not the owner the ran as.
    audit(db, userId, "run.start", {
      objectType: "run",
      objectId: runId,
      detail: { graph: graphId, trigger: body.trigger ?? "manual" },
      ip: clientIp(c),
    });
    return c.json({ runId, diagnostics, modelWarnings: modelDiags });
  } catch (e) {
    if (claimedKey) {
      // No run was created, so the key must stay usable: retrying with the same
      // key is the normal recovery path from a 402/422 here.
      await db.releaseIdempotentClaim(userId, claimedKey);
    }
    const quota = quotaResponseBody(e);
    if (quota) return c.json(quota, 402);
    if (e instanceof RunStartError) {
      return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    }
    throw e;
  }
});

// --- Batch jobs (F5: one run per input row, grouped for progress) ---
app.post("/api/batches", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    graphId?: string;
    rows?: Record<string, unknown>[];
    csv?: string;
    concurrency?: number;
    sourceName?: string;
  };
  const graphId = body.graphId;
  if (!graphId) return c.json({ error: "graphId required" }, 400);
  const access = await requireGraph(db, userId, graphId, "editor");
  if (!access) {
    return await graphAccessRole(db, userId, graphId) == null
      ? c.json({ error: "not found" }, 404)
      : c.json({ error: "forbidden", message: "只读协作者不能运行产线" }, 403);
  }
  const ownerId = access.graphOwnerId;
  const graph = await db.getGraph(graphId, ownerId);
  if (!graph) return c.json({ error: "graph not found" }, 404);

  let rows: Record<string, unknown>[] = body.rows ?? [];
  if (body.csv) rows = parseCsv(body.csv, { hasHeader: true });
  if (rows.length === 0) return c.json({ error: "no rows to run" }, 400);

  const batchId = randomUUID();
  await db.createBatch({ id: batchId, userId: ownerId, graphId, sourceName: body.sourceName, rows });

  const concurrency = Math.min(Math.max(body.concurrency ?? 2, 1), 8);
  void runBatch({
    db,
    userId: ownerId,
    worker: workerRegistry.get(undefined),
    artifacts,
    live,
    graph,
    batchId,
    concurrency,
    publicUrl: PUBLIC_URL,
  });

  return c.json({ batchId }, 201);
});

app.get("/api/batches", async (c) => {
  const userId = c.get("userId");
  const graphIds = [...(await visibleGraphs(db, userId)).keys()];
  return c.json(await db.listBatches(userId, graphIds));
});

app.get("/api/batches/:id", async (c) => {
  const userId = c.get("userId");
  const batch = await db.getBatchUnscoped(c.req.param("id"));
  if (!batch) return c.json({ error: "not found" }, 404);
  if (!await requireGraph(db, userId, batch.graphId, "viewer")) return c.json({ error: "not found" }, 404);
  const items = await db.listBatchItems(batch.id);
  return c.json({ ...batch, items });
});

app.post("/api/batches/:id/items/:itemId/retry", async (c) => {
  const userId = c.get("userId");
  const batch = await db.getBatchUnscoped(c.req.param("id"));
  if (!batch) return c.json({ error: "not found" }, 404);
  const access = await requireGraph(db, userId, batch.graphId, "editor");
  if (!access) return c.json({ error: "not found" }, 404);
  const ownerId = access.graphOwnerId;
  const graph = await db.getGraph(batch.graphId, ownerId);
  if (!graph) return c.json({ error: "graph not found" }, 404);
  const item = (await db.listBatchItems(batch.id)).find((i) => i.id === c.req.param("itemId"));
  if (!item) return c.json({ error: "item not found" }, 404);

  try {
    const { runId } = await startRun({
      db,
      userId: ownerId,
      worker: workerRegistry.get(undefined),
      artifacts,
      live,
      graph,
      trigger: "batch-retry",
      input: JSON.stringify(item.input),
      publicUrl: PUBLIC_URL,
      onFinish: async (_gid, status) => {
        if (status === "done") await db.markBatchItemDone(item.id, null, []);
        else await db.markBatchItemFailed(item.id, `run ${status}`);
      },
    });
    await db.markBatchItemRunning(item.id, runId);
    return c.json({ runId });
  } catch (e) {
    // 原先这里没有 try：被拦的派发（订阅配额，或早已存在的月度预算熔断）会冒到
    // Hono 的错误处理，用户看到 500 而不是「额度已满」。
    const quota = quotaResponseBody(e);
    if (quota) return c.json(quota, 402);
    if (e instanceof RunStartError) {
      return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    }
    throw e;
  }
});

// --- Content calendar (F8: scheduled publishing plan) ---
app.post("/api/runs/:id/cancel", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  // Cancel is a write action: editor or owner. Viewers with read access get
  // 403; outsiders get 404 (no existence leak).
  const role = await runAccessRole(db, userId, runId);
  if (role == null) return c.json({ error: "not found" }, 404);
  if (!hasAtLeast(role, "editor")) return c.json({ error: "forbidden", message: "只读协作者不能取消运行" }, 403);
  const entry = live.get(runId);
  if (!entry) return c.json({ error: "not live" }, 404);
  entry.controller.abort();
  audit(db, userId, "run.cancel", { objectType: "run", objectId: runId, ip: clientIp(c) });
  return c.json({ ok: true });
});

app.delete("/api/runs/:id", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  // Only the graph owner may delete runs (design-rbac: editors can't delete).
  const role = await runAccessRole(db, userId, runId);
  if (role == null) return c.json({ error: "not found" }, 404);
  if (role !== "owner") return c.json({ error: "forbidden", message: "仅产线所有者可删除运行" }, 403);
  const runOwnerId = (await db.getRunGraphRef(runId))!.userId;
  const entry = live.get(runId);
  if (entry && !entry.done) {
    return c.json({ error: "run is still in progress; cancel it first" }, 409);
  }
  live.delete(runId);
  await db.deleteRun(runId, runOwnerId);
  return c.json({ ok: true });
});

/** Resume a halted run: `{ action: "continue" | "approve" | "reject" | "edit" | "scrap", editOutput?, resetFrom? }`. */
app.post("/api/runs/:id/resume", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  // Resume is a write action: editor or owner. Runs execute under the run
  // owner's identity (same as startRun) so state stays consistent.
  const role = await runAccessRole(db, userId, runId);
  if (role == null) return c.json({ error: "not found" }, 404);
  if (!hasAtLeast(role, "editor")) return c.json({ error: "forbidden", message: "只读协作者不能恢复运行" }, 403);
  const runOwnerId = (await db.getRunGraphRef(runId))!.userId;

  const body = (await c.req.json().catch(() => ({}))) as {
    action?: ResumeAction;
    editOutput?: Record<string, string>;
    resetFrom?: string;
    approveTools?: unknown;
    workerId?: string;
  };
  const action: ResumeAction =
    body.action === "scrap" ||
    body.action === "approve" ||
    body.action === "reject" ||
    body.action === "edit"
      ? body.action
      : "continue";
  const resetFrom = typeof body.resetFrom === "string" ? body.resetFrom : undefined;
  const editOutput = body.editOutput && typeof body.editOutput === "object" ? body.editOutput : undefined;
  const approveTools =
    Array.isArray(body.approveTools) ? body.approveTools.filter((t) => typeof t === "string") : undefined;

  try {
    const out = await resumeRun({
      db,
      userId: runOwnerId,
      worker: workerRegistry.get(body.workerId),
      artifacts,
      live,
      runId,
      action,
      resetFrom,
      editOutput,
      approveTools,
      publicUrl: PUBLIC_URL,
      onFinish: (gid, status) => {
        void triggers.onGraphFinished(gid, status);
      },
      onArtifact: (aid) => {
        void triggers.onArtifact(aid);
      },
    });
    return c.json({ ok: true, action: out.action });
  } catch (e) {
    if (e instanceof RunStartError) {
      return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    }
    throw e;
  }
});

/**
 * Review queue (F2): every run parked on a human decision, across pipelines,
 * longest-waiting first. The engine already halts and resumes; this only makes
 * the pending work discoverable outside a single run view.
 */
app.get("/api/reviews/pending", async (c) => {
  const userId = c.get("userId");
  const limit = Number(c.req.query("limit"));
  const offset = Number(c.req.query("offset"));
  const graphId = c.req.query("graphId") || undefined;
  const graphIds = [...(await visibleGraphs(db, userId)).keys()];
  const { reviews, total } = await listPendingReviews(db, userId, {
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
    ...(Number.isFinite(offset) && offset > 0 ? { offset } : {}),
    ...(graphId ? { graphId } : {}),
    graphIds,
  });
  return c.json({ reviews, total });
});

/**
 * Batch decision. Dispatches each item through the same resume path as a single
 * decision; per-item failures (not found / still active / won't compile) come
 * back in `results` with 200 rather than aborting the rest of the batch.
 */
app.post("/api/reviews/decide", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const { decisions, error } = parseDecisions(body);
  if (!decisions) return c.json({ error: error ?? "请求体必须是决策数组" }, 400);

  const results: Array<
    | { runId: string; ok: true; action: ResumeAction }
    | { runId: string; ok: false; status: number; error: string }
  > = [];
  for (const decision of decisions) {
    try {
      // Each decision requires editor access to that run's graph; runs resume
      // under the run owner's identity.
      const access = await requireRun(db, userId, decision.runId, "editor");
      if (!access) {
        results.push({ runId: decision.runId, ok: false, status: 404, error: "not found" });
        continue;
      }
      await resumeRun({
        db,
        userId: access.runOwnerId,
        worker: workerRegistry.get(),
        artifacts,
        live,
        runId: decision.runId,
        action: decision.action,
        editOutput: decision.editOutput,
        approveTools: decision.approveTools,
        publicUrl: PUBLIC_URL,
        onFinish: (gid, status) => {
          void triggers.onGraphFinished(gid, status);
        },
        onArtifact: (aid) => {
          void triggers.onArtifact(aid);
        },
      });
      results.push({ runId: decision.runId, ok: true, action: decision.action });
    } catch (e) {
      if (e instanceof RunStartError) {
        results.push({ runId: decision.runId, ok: false, status: e.status, error: e.message });
        continue;
      }
      throw e;
    }
  }
  return c.json({ ok: true, results });
});

/**
 * Re-run a finished run: same graph snapshot (exactly what executed), same
 * input and budget. Useful after fixing a failure — one click from the run
 * gallery instead of re-picking nodes on the canvas.
 */
app.post("/api/runs/:id/rerun", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  const role = await runAccessRole(db, userId, runId);
  if (role == null) return c.json({ error: "not found" }, 404);
  if (!hasAtLeast(role, "editor")) return c.json({ error: "forbidden", message: "只读协作者不能重跑运行" }, 403);
  const runOwnerId = (await db.getRunGraphRef(runId))!.userId;
  const run = await db.getRunById(runId);
  if (!run) return c.json({ error: "not found" }, 404);
  if (run.status === "running") return c.json({ error: "run is still live" }, 409);
  let graph: Graph;
  try {
    graph = parseGraphSnapshot(run.snapshot);
  } catch {
    return c.json({ error: "run snapshot is corrupt" }, 422);
  }
  if (!graph?.nodes?.length) return c.json({ error: "run snapshot is empty" }, 422);

  const modelDiags = validateModels(graph, await loadConfig(runOwnerId));
  const modelErrors = modelDiags.filter((d) => d.severity === "error");
  if (modelErrors.length > 0) {
    return c.json(
      {
        error: "graph has unconfigured model(s)",
        message: `${modelErrors.length} 个节点未配置模型，请按提示补全对应配置后再重跑。`,
        diagnostics: modelDiags,
      },
      422,
    );
  }
  try {
    const { runId, diagnostics } = await startRun({
      db,
      userId: runOwnerId,
      worker: workerRegistry.get(undefined),
      artifacts,
      live,
      graph,
      trigger: "rerun",
      budgetUsd: run.budget_usd,
      input: run.input ?? undefined,
      publicUrl: PUBLIC_URL,
      onFinish: (gid, status) => {
        void triggers.onGraphFinished(gid, status);
      },
      onArtifact: (aid) => {
        void triggers.onArtifact(aid);
      },
    });
    return c.json({ runId, diagnostics, modelWarnings: modelDiags });
  } catch (e) {
    const quota = quotaResponseBody(e);
    if (quota) return c.json(quota, 402);
    if (e instanceof RunStartError) {
      return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    }
    throw e;
  }
});

/**
 * G1.2 fork: create a new run that reuses `fromNodeId` and every upstream step
 * (zero cost) and re-runs only its flow descendants. Returns the new run id.
 */
app.post("/api/runs/:id/fork", async (c) => {
  const userId = c.get("userId");
  const parentRunId = c.req.param("id");
  const role = await runAccessRole(db, userId, parentRunId);
  if (role == null) return c.json({ error: "not found" }, 404);
  if (!hasAtLeast(role, "editor")) {
    return c.json({ error: "forbidden", message: "只读协作者不能从此处重跑运行" }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { fromNodeId?: unknown };
  const fromNodeId = typeof body?.fromNodeId === "string" ? body.fromNodeId : "";
  if (!fromNodeId) return c.json({ error: "fromNodeId is required" }, 400);

  const graphRef = await db.getRunGraphRef(parentRunId);
  if (!graphRef) return c.json({ error: "not found" }, 404);
  const runOwnerId = graphRef.userId;
  const parent = await db.getRunById(parentRunId);
  if (!parent) return c.json({ error: "not found" }, 404);
  if (parent.status === "running") return c.json({ error: "run is still live" }, 409);

  let graph: Graph;
  try {
    graph = parseGraphSnapshot(parent.snapshot);
  } catch {
    return c.json({ error: "run snapshot is corrupt" }, 422);
  }
  if (!graph?.nodes?.length) return c.json({ error: "run snapshot is empty" }, 422);
  if (!graph.nodes.some((n) => n.id === fromNodeId)) {
    return c.json({ error: "fromNodeId not found in run snapshot" }, 422);
  }
  // Mirror rerun: descendants re-execute, so unconfigured models would 422 mid-run.
  const modelDiags = validateModels(graph, await loadConfig(runOwnerId));
  if (modelDiags.some((d) => d.severity === "error")) {
    return c.json(
      {
        error: "graph has unconfigured model(s)",
        message: `${modelDiags.filter((d) => d.severity === "error").length} 个节点未配置模型，请按提示补全对应配置后再从此处重跑。`,
        diagnostics: modelDiags,
      },
      422,
    );
  }

  try {
    const { runId } = await forkRun({
      db,
      userId: runOwnerId,
      worker: workerRegistry.get(undefined),
      artifacts,
      live,
      parentRunId,
      fromNodeId,
      publicUrl: PUBLIC_URL,
      onFinish: (gid, status) => {
        void triggers.onGraphFinished(gid, status);
      },
      onArtifact: (aid) => {
        void triggers.onArtifact(aid);
      },
    });
    return c.json({ runId });
  } catch (e) {
    const quota = quotaResponseBody(e);
    if (quota) return c.json(quota, 402);
    if (e instanceof RunStartError) {
      return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    }
    throw e;
  }
});

/** Full event log — the replay scrubber reads this. */
app.get("/api/runs/:id/events", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!await requireRun(db, userId, runId, "viewer")) return c.json({ error: "not found" }, 404);

  // Pagination: ?after=<seq> (exclusive) and ?limit=<n>. With no params the
  // full history is returned together with the reconstructed runtime state,
  // which is what the initial page load needs. Range requests return only the
  // event window plus a nextCursor, since partial events can't replay state.
  const afterRaw = c.req.query("after");
  const limitRaw = c.req.query("limit");
  if (afterRaw == null && limitRaw == null) {
    const events = await db.events(runId);
    return c.json({ events, state: replay(events) });
  }

  const after = afterRaw != null ? Number(afterRaw) : -1;
  const limit = limitRaw != null ? Number(limitRaw) : 500;
  if (!Number.isFinite(limit) || limit <= 0 || limit > 10000) {
    return c.json({ error: "limit must be between 1 and 10000" }, 400);
  }
  const { events, nextCursor } = await db.eventsRange(runId, after, limit);
  return c.json({ events, after, nextCursor, hasMore: nextCursor != null });
});

/** Live stream. Resumes from `?after=<seq>` so a dropped connection loses nothing. */
app.get("/api/runs/:id/stream", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!await requireRun(db, userId, runId, "viewer")) return c.json({ error: "not found" }, 404);
  // Resume point: explicit ?after= wins; otherwise honor the native
  // Last-Event-ID header the browser sends automatically when reconnecting to
  // a stream that carried `id:` frames.
  const queryAfter = c.req.query("after");
  const headerAfter = c.req.header("last-event-id");
  const after = queryAfter != null
    ? Number(queryAfter)
    : headerAfter != null
      ? Number(headerAfter)
      : -1;

  return streamSSE(c, async (stream) => {
    let cursor = after;

    for (const event of await db.events(runId)) {
      if (event.seq <= cursor) continue;
      await stream.writeSSE({ data: JSON.stringify(envelope(event)), id: String(event.seq) });
      cursor = event.seq;
    }

    const entry = live.get(runId);
    let lastWrite = Date.now();
    while (entry && !(entry.done && cursor >= (entry.events.at(-1)?.seq ?? -1))) {
      const pending = entry.events.filter((e) => e.seq > cursor);
      for (const event of pending) {
        await stream.writeSSE({ data: JSON.stringify(envelope(event)), id: String(event.seq) });
        cursor = event.seq;
        lastWrite = Date.now();
      }
      if (entry.done) break;
      // Heartbeat: proxies drop idle SSE connections (~60s). Send a comment
      // frame every 15s so a long model call (no events for tens of seconds)
      // keeps the connection alive. Browsers ignore SSE comment frames.
      if (Date.now() - lastWrite > 15000) {
        await stream.write(": ping\n\n");
        lastWrite = Date.now();
      }
      await stream.sleep(60);
    }
  });
});

/** Artifacts produced by a single run. */
app.get("/api/runs/:id/artifacts", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("id");
  if (!await requireRun(db, userId, runId, "viewer")) return c.json({ error: "not found" }, 404);
  return c.json(await db.listArtifactsForRunUnscoped(runId));
});

/** Upload a raw product image/file. Returns a StoredArtifact with a /api/artifacts/:id URI. */
app.post("/api/artifacts/upload", async (c) => {
  const userId = c.get("userId");
  const rawContentType = c.req.header("content-type") ?? "application/octet-stream";
  // Refuse to store/echo executable content types (a self-XSS vector when the
  // artifact is later served with the same content-type).
  const contentType = /text\/html|image\/svg|application\/xhtml/i.test(rawContentType)
    ? "application/octet-stream"
    : rawContentType;
  const label = c.req.query("label");
  const data = Buffer.from(await c.req.arrayBuffer());
  if (data.length === 0) return c.json({ error: "empty upload" }, 400);
  const MAX = 25 * 1024 * 1024;
  if (data.length > MAX) return c.json({ error: "file too large (max 25MB)" }, 413);

  let kind: "image" | "audio" | "video" | "file" = "file";
  if (contentType.startsWith("image/")) kind = "image";
  else if (contentType.startsWith("video/")) kind = "video";
  else if (contentType.startsWith("audio/")) kind = "audio";

  const saved = await artifacts.saveBinary({
    userId,
    data,
    kind,
    mimeType: contentType,
    label: label || undefined,
  });
  await db.insertArtifact(saved, userId);
  return c.json(saved, 201);
});

/** Cross-run artifact listing (latest first), for the product gallery. */
app.get("/api/artifacts", async (c) => {
  const userId = c.get("userId");
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const offset = Number(c.req.query("offset") ?? 0);
  // Include artifacts of shared graphs alongside the caller's own.
  const graphIds = [...(await visibleGraphs(db, userId)).keys()];
  return c.json(await db.listArtifacts(userId, limit, offset, graphIds));
});

/**
 * Server-side image proxy. External image URLs referenced by product-json or
 * extracted artifacts often fail in the browser due to hotlink protection /
 * CORS. The server fetches them (browser-like UA) and streams the bytes back
 * same-origin, so gallery + product images render reliably. Only http(s) is
 * allowed and private/internal addresses are refused (SSRF guard, shared with
 * the HTTP node via ssrf.ts — resolves hostnames at fetch time so DNS
 * rebinding cannot smuggle an internal address past the check); failures
 * return 502 so the client can show a graceful placeholder.
 */
}