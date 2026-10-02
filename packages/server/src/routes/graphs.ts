/** Graphs route domain (audit P2-2 split from index.ts). */
import { audit } from "../audit.js";
import { loadConfig } from "../config.js";
import { contentHash } from "../db.js";
import { quotaResponseBody } from "../dispatch-gate.js";
import { findGraphIdByName as findGraphIdByNameCore } from "../graphs-name.js";
import { log } from "../logger.js";
import { graphAccessRole, requireGraph, visibleGraphs } from "../rbac.js";
import { RunStartError, startRun } from "../run.js";
import { asRecord } from "../safe-utils.js";
import { listBuiltinSkills } from "../skills/registry.js";
import { loadUserSkills } from "../skills/user-skills.js";
import { TriggerError } from "../triggers.js";
import { validateModels } from "../validate-models.js";
import { DEFAULT_PLAN, Graph, TEMPLATES, TriggerConfig, compile, getTemplate, instantiateTemplate, replay } from "@agent-world/core";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { clientIp, jsonResponse } from "./shared.js";
import { isPlanId, PLANS } from "../plans.js";
import { getOrCreateSubscription } from "../subscriptionService.js";
import type { RouteContext } from "./ctx.js";

export function registerGraphsRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  ctx: RouteContext,
): void {
  const { db, live, scheduler, triggers, worker, blockDemo } = ctx;

app.get("/api/skills", async (c) => {
  const userId = c.get("userId");
  const cfg = await loadConfig(userId);
  const own = await loadUserSkills(userId, cfg);
  const ownCatalog = [...own.values()].map(({ tool: _tool, ...rest }) => rest);
  return c.json([...listBuiltinSkills(), ...ownCatalog]);
});

app.get("/api/graphs", async (c) => {
  const userId = c.get("userId");
  // Owned graphs + graphs shared to this user (design-rbac P1). Owned rows
  // carry sharedRole: null; shared rows carry the granted role so the UI can
  // badge them and hide owner-only actions.
  const visible = await visibleGraphs(db, userId);
  const owned = new Map((await db.listGraphs(userId)).map((g) => [g.id, g]));
  const out: Array<{
    id: string;
    name: string;
    version: number;
    updated_at: number;
    originTemplateId: string | null;
    sharedRole: string | null;
  }> = [];
  for (const [gid, role] of visible) {
    const meta = role === null ? owned.get(gid) : await db.getGraphMeta(gid);
    if (!meta) continue;
    out.push({ ...meta, sharedRole: role });
  }
  out.sort((a, b) => b.updated_at - a.updated_at);
  return c.json(out);
});

// Reject names that collide (case-insensitive, trimmed) with any other graph.
// `excludeId` lets PUT /api/graphs/:id skip the row it's updating.
const findGraphIdByName = async (name: string, userId: string, excludeId?: string): Promise<string | null> =>
  findGraphIdByNameCore(await db.listGraphs(userId), name, excludeId);


app.get("/api/templates", (c) =>
  c.json(
    TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      // Declared instantiation fields (without applyTo plumbing) so API clients
      // can render the same form the web UI shows.
      fields: (t.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        placeholder: f.placeholder ?? "",
        defaultValue: f.defaultValue ?? "",
      })),
      // Slim geometry so the client can render a preview thumbnail without the
      // full prompts/agents payload.
      nodes: t.graph.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        x: n.x,
        y: n.y,
      })),
      edges: t.graph.edges.map((e) => ({
        from: e.from,
        to: e.to,
        kind: e.kind ?? "edge",
      })),
    })),
  ),
);

app.post("/api/graphs", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    from?: string;
    template?: string;
    fieldValues?: Record<string, string>;
  };
  const id = randomUUID();
  // Validate name length if provided; empty/whitespace falls back to defaults below.
  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (trimmed.length > 100) {
      return c.json({ error: "产线名称不能超过 100 个字符" }, 400);
    }
  }
  // fieldValues must be a plain object of string values when provided.
  if (body.fieldValues !== undefined) {
    if (typeof body.fieldValues !== "object" || body.fieldValues === null || Array.isArray(body.fieldValues)) {
      return c.json({ error: "fieldValues must be an object of string values" }, 400);
    }
    for (const [k, v] of Object.entries(body.fieldValues)) {
      if (typeof v !== "string") {
        return c.json({ error: `fieldValues["${k}"] must be a string` }, 400);
      }
    }
  }
  // template must be a string when provided (non-string silently bypassed getTemplate lookup).
  if (body.template !== undefined && typeof body.template !== "string") {
    return c.json({ error: "template must be a string" }, 400);
  }
  let graph: Graph;
  let originTemplateId: string | null = null;
  if (body.template) {
    const tpl = getTemplate(body.template);
    if (!tpl) return c.json({ error: "template not found" }, 404);
    graph = instantiateTemplate(tpl, {
      id,
      name: body.name?.trim() || tpl.name,
      fieldValues: body.fieldValues,
    });
    originTemplateId = body.template;
  } else if (body.from) {
    // Cloning requires read access to the source (a shared viewer may clone).
    const access = await requireGraph(db, userId, body.from, "viewer");
    const src = access ? await db.getGraph(body.from, access.graphOwnerId) : null;
    if (!src) return c.json({ error: "source graph not found" }, 404);
    const { version: _srcVersion, ...srcDoc } = src;
    void _srcVersion;
    graph = {
      ...srcDoc,
      id,
      name: body.name?.trim() || `${srcDoc.name} 副本`,
      nodes: srcDoc.nodes.map((n) => ({ ...n })),
      edges: srcDoc.edges.map((e) => ({ ...e })),
    };
    // Clone is an independent copy — not a template instance.
    originTemplateId = null;
  } else {
    graph = {
      id,
      name: body.name?.trim() || "新产线",
      nodes: [],
      edges: [],
    };
    originTemplateId = null;
  }
  const dup = await findGraphIdByName(graph.name, userId);
  if (dup) {
    return c.json(
      { error: "duplicate_name", message: `已存在同名产线「${graph.name}」，请换一个名字。`, existingId: dup },
      409,
    );
  }
  await db.saveGraph(graph, Date.now(), userId, undefined, originTemplateId);
  audit(db, userId, "graph.create", {
    objectType: "graph",
    objectId: id,
    detail: { nodes: graph.nodes.length, originTemplateId },
    ip: clientIp(c),
  });
  return c.json(await db.getGraph(id, userId), 201);
});

app.get("/api/graphs/:id", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const access = await requireGraph(db, userId, graphId, "viewer");
  if (!access) return c.json({ error: "not found" }, 404);
  const graph = await db.getGraph(graphId, access.graphOwnerId);
  return graph ? c.json(graph) : c.json({ error: "not found" }, 404);
});

app.delete("/api/graphs/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (await graphAccessRole(db, userId, id) == null) return c.json({ error: "not found" }, 404);
  if (await graphAccessRole(db, userId, id) !== "owner") {
    return c.json({ error: "forbidden", message: "仅产线所有者可删除" }, 403);
  }
  const ownerId = (await db.graphOwnerId(id))!;
  await db.deleteGraph(id, ownerId);
  audit(db, userId, "graph.delete", { objectType: "graph", objectId: id, ip: clientIp(c) });
  return c.json({ ok: true });
});

// --- RTS stage-B macro-park position (migration 37, design-rts-stage-b B1) -
// The park coordinate is a view-layer override of the pure parkLayout(). Owner
// only: collaborators get the position through GET overview but may not move a
// factory they don't own. Coordinates must be finite (reject NaN/Infinity).
app.put("/api/graphs/:id/park-coord", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const role = await graphAccessRole(db, userId, id);
  if (role == null) return c.json({ error: "not found" }, 404);
  if (role !== "owner") return c.json({ error: "forbidden", message: "仅产线所有者可调整园区位置" }, 403);
  const body = await c.req.json().catch(() => null) as { x?: unknown; z?: unknown } | null;
  const x = typeof body?.x === "number" ? body.x : Number.NaN;
  const z = typeof body?.z === "number" ? body.z : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return c.json({ error: "bad_request", message: "x/z 必须为有限数值" }, 400);
  }
  const ownerId = (await db.graphOwnerId(id))!;
  const ok = await db.setParkCoord(ownerId, id, x, z);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true, parkX: x, parkZ: z });
});

app.delete("/api/graphs/:id/park-coord", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const role = await graphAccessRole(db, userId, id);
  if (role == null) return c.json({ error: "not found" }, 404);
  if (role !== "owner") return c.json({ error: "forbidden", message: "仅产线所有者可重置园区位置" }, 403);
  const ownerId = (await db.graphOwnerId(id))!;
  await db.clearParkCoord(ownerId, id);
  return c.json({ ok: true });
});

// --- Graph sharing ACL (design-rbac P1) -----------------------------------
// Only the graph owner may read or change the collaborator list. Editors and
// viewers get 403 (they can see the graph, not its ACL); unknown graphs 404.

app.get("/api/graphs/:id/access", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  if (await graphAccessRole(db, userId, graphId) == null) return c.json({ error: "not found" }, 404);
  if (await graphAccessRole(db, userId, graphId) !== "owner") {
    return c.json({ error: "forbidden", message: "仅产线所有者可管理共享" }, 403);
  }
  const collaborators = await Promise.all(
    (await db.listResourceAccess("graph", graphId)).map(async (row) => {
      const user = await db.findUserById(row.user_id);
      return { userId: row.user_id, email: user?.email ?? null, role: row.role, createdAt: row.created_at };
    }),
  );
  return c.json({ collaborators });
});

app.put("/api/graphs/:id/access", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  if (await graphAccessRole(db, userId, graphId) == null) return c.json({ error: "not found" }, 404);
  if (await graphAccessRole(db, userId, graphId) !== "owner") {
    return c.json({ error: "forbidden", message: "仅产线所有者可管理共享" }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as { email?: string; role?: string | null };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) return c.json({ error: "email is required" }, 400);
  // role: "editor" | "viewer" to grant/overwrite, null (or omitted) to revoke.
  const role = body.role ?? null;
  if (role !== null && role !== "editor" && role !== "viewer") {
    return c.json({ error: "role must be editor, viewer, or null" }, 400);
  }

  const target = await db.findUserByEmail(email);
  if (!target) return c.json({ error: "user not found", message: "该邮箱尚未注册" }, 404);
  const graphOwnerId = (await db.graphOwnerId(graphId))!;
  if (target.id === graphOwnerId) {
    return c.json({ error: "cannot share with owner", message: "所有者无需共享" }, 400);
  }

  if (role === null) {
    const removed = await db.deleteResourceAccess("graph", graphId, target.id);
    if (removed) {
      audit(db, userId, "access.revoke", {
        objectType: "graph",
        objectId: graphId,
        detail: { grantee: target.id },
        ip: clientIp(c),
      });
    }
    return c.json({ ok: true, revoked: removed });
  }

  // M3 S5: enforce plan seats limit. Count current collaborators + owner.
  const ownerSub = await getOrCreateSubscription(db, graphOwnerId);
  const ownerPlan = isPlanId(ownerSub.plan) ? ownerSub.plan : DEFAULT_PLAN;
  const seatsLimit = PLANS[ownerPlan].seats;
  const currentCollaborators = await db.listResourceAccess("graph", graphId);
  const seatsUsed = currentCollaborators.length + 1; // +1 for owner
  // If target is already a collaborator, this is an update (not adding a new seat).
  const alreadyShared = currentCollaborators.some((r) => r.user_id === target.id);
  if (!alreadyShared && seatsUsed >= seatsLimit) {
    return c.json(
      {
        error: "seats_exceeded",
        message: `当前套餐 ${ownerPlan} 仅支持 ${seatsLimit} 个席位（已用 ${seatsUsed}），请升级套餐或移除现有协作人。`,
      },
      403,
    );
  }

  await db.saveResourceAccess("graph", graphId, target.id, role);
  audit(db, userId, "access.grant", {
    objectType: "graph",
    objectId: graphId,
    detail: { grantee: target.id, role },
    ip: clientIp(c),
  });
  return c.json({ ok: true, role });
});

/** Auto-snapshot parameters from user settings, falling back to the design
 *  defaults (10 min throttle window, 30 auto-snapshots kept per graph). */
async function autoSnapshotSettings(userId: string): Promise<{ minIntervalMs: number; maxKeep: number }> {
  const s = (await loadConfig(userId)).autoSnapshot;
  return {
    minIntervalMs: s?.minIntervalMs ?? 10 * 60 * 1000,
    maxKeep: s?.maxKeep ?? 30,
  };
}

app.put("/api/graphs/:id", async (c) => {
  const userId = c.get("userId");
  const paramId = c.req.param("id");
  const parsed = Graph.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // H1: the body id must match the path — otherwise a crafted body could
  // target a different document than the URL implies.
  if (parsed.data.id !== paramId) {
    return c.json({ error: "id_mismatch", message: "请求体中的产线 ID 与路径不一致" }, 400);
  }

  // ACL (design-rbac P1): owner or shared editor may save; the graph stays
  // owned by its owner, so every scoped write below runs as that owner.
  const access = await requireGraph(db, userId, paramId, "editor");
  if (!access) {
    return await graphAccessRole(db, userId, paramId) == null
      ? c.json({ error: "not found" }, 404)
      : c.json({ error: "forbidden", message: "只读协作者不能修改产线" }, 403);
  }
  const ownerId = access.graphOwnerId;

  // H2: a graph document can carry triggers, so enforce the webhook-secret
  // rule on the save path too (the create-trigger route alone is bypassable
  // by writing graph.triggers directly through this PUT).
  const emptySecretWebhook = (parsed.data.triggers ?? []).find(
    (t) => t.type === "webhook" && !t.webhookSecret?.trim(),
  );
  if (emptySecretWebhook) {
    return c.json({ error: "webhook 触发器必须设置 secret" }, 400);
  }

  const dupId = await findGraphIdByName(parsed.data.name, ownerId, paramId);
  if (dupId) {
    return c.json(
      { error: "duplicate_name", message: `已存在同名产线「${parsed.data.name}」，请换一个名字。`, existingId: dupId },
      409,
    );
  }

  // Pre-save auto-snapshot: capture what's about to be overwritten so a bad
  // edit that gets saved can always be rolled back. Throttled and pruned by
  // db.saveAutoSnapshot; parameters come from user settings when configured.
  const existing = await db.getGraph(parsed.data.id, ownerId);
  if (existing) {
    const s = await autoSnapshotSettings(ownerId);
    await db.saveAutoSnapshot(parsed.data.id, JSON.stringify(existing), s.minIntervalMs, s.maxKeep);
  }

  // Optimistic concurrency: a tab sends the version it last loaded via
  // If-Match. A mismatch means another tab (or session) saved first, so we
  // refuse instead of silently overwriting their edits.
  const ifMatch = c.req.header("if-match");
  const expectedVersion = ifMatch != null ? Number(ifMatch) : undefined;
  const result = await db.saveGraph(parsed.data, Date.now(), ownerId, expectedVersion);
  if (!result.ok) {
    if ("conflict" in result) {
      return c.json(
        { error: "conflict", message: "该产线已在其他标签页被修改，请刷新后重试。", serverVersion: result.serverVersion },
        409,
      );
    }
    // H1: id collides with another user's graph — never overwrite it.
    return c.json({ error: "forbidden", message: "该产线不属于当前账号" }, 403);
  }
  audit(db, userId, "graph.update", {
    objectType: "graph",
    objectId: paramId,
    detail: { nodes: parsed.data.nodes.length, version: result.version },
    ip: clientIp(c),
  });
  return c.json({ ok: true, version: result.version });
});

/** Which node kinds require a worker model and which modality they need. */

app.post("/api/compile", async (c) => {
  const parsed = Graph.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const result = compile(parsed.data);
  const modelDiags = validateModels(parsed.data, await loadConfig(c.get("userId")));
  log.info("compile", {
    graphId: parsed.data.id,
    nodes: parsed.data.nodes.length,
    plan: result.plan !== null,
    diagnostics: [...result.diagnostics, ...modelDiags].map((d) => d.message),
  });
  return c.json({
    ...result,
    diagnostics: [...result.diagnostics, ...modelDiags],
  });
});

/**
 * User-level search config as the UI sees it: every per-provider apiKey is
 * redacted, and legacy flat credentials (pre per-provider binding) are
 * surfaced in the slot of the provider they were configured against so the
 * form shows them where they now belong. Display-level only — the file on
 * disk is rewritten with slots on the next save.
 */
app.get("/api/graphs/:id/triggers", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  if (!await requireGraph(db, userId, graphId, "viewer")) return c.json({ error: "graph not found" }, 404);
  return c.json(triggers.listByGraph(graphId));
});

app.post("/api/graphs/:id/triggers", async (c) => {
  const userId = c.get("userId");
  const d = await blockDemo(c, "webhook"); if (d) return d;
  const graphId = c.req.param("id");
  if (!await db.getGraph(graphId, userId)) return c.json({ error: "graph not found" }, 404);
  const rawObj = asRecord(await c.req.json().catch(() => ({})));
  const withId = rawObj.id ? rawObj : { ...rawObj, id: crypto.randomUUID() };
  const parsed = TriggerConfig.safeParse(withId);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  // Webhook triggers are callable by anyone who knows the URL; an empty
  // secret would leave the pipeline anonymously triggerable.
  if (parsed.data.type === "webhook" && !parsed.data.webhookSecret?.trim()) {
    return c.json({ error: "webhook 触发器必须设置 secret" }, 400);
  }
  try {
    const trigger = await triggers.upsert(graphId, parsed.data);
    scheduler.sync(trigger);
    return c.json(trigger, 201);
  } catch (e) {
    if (e instanceof TriggerError) {
      return jsonResponse(e.status, { error: e.message });
    }
    throw e;
  }
});

app.delete("/api/graphs/:id/triggers/:tid", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  if (!await db.getGraph(graphId, userId)) return c.json({ error: "graph not found" }, 404);
  const tid = c.req.param("tid");
  scheduler.unsync(tid);
  await triggers.remove(graphId, tid);
  return c.body(null, 204);
});

// Next cron fire times for the UI (4A.7).
app.get("/api/graphs/:id/triggers/next-runs", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  if (!await requireGraph(db, userId, graphId, "viewer")) return c.json({ error: "graph not found" }, 404);
  return c.json(triggers.nextRunMap(graphId));
});

// Manually fire a trigger (e.g. a batch run, or a cron/event re-run on demand).
app.post("/api/graphs/:id/triggers/:tid/fire", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const tid = c.req.param("tid");
  if (!await db.getGraph(graphId, userId)) return c.json({ error: "graph not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { payload?: unknown };
  const trigger = triggers.get(tid);
  if (!trigger) return jsonResponse(404, { error: "trigger not found" });
  try {
    if (trigger.type === "batch") {
      const runIds = await triggers.fireBatch(tid, body.payload);
      return c.json({ runIds });
    }
    const { runId } = await triggers.fire(tid, body.payload, graphId);
    return c.json({ runId });
  } catch (e) {
    const quota = quotaResponseBody(e);
    if (quota) return c.json(quota, 402);
    // 派发口共用 startRun 的前置检查会抛 RunStartError（模型不可用 422 / 编译失败
    // 422），这里不接就会 500 给手动触发与 webhook 调用方。
    if (e instanceof RunStartError) return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    if (e instanceof TriggerError) return jsonResponse(e.status, { error: e.message });
    throw e;
  }
});

app.post("/api/graphs/:id/webhook", async (c) => {
  const graphId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { secret?: string; timestamp?: number; payload?: unknown };
  const secret = body.secret ?? c.req.header("x-webhook-secret") ?? "";
  // M1 replay defence: external callers must send a fresh timestamp (header or
  // body). Missing/stale requests are rejected before the secret is checked.
  const rawTs = c.req.header("x-webhook-timestamp") ?? body.timestamp;
  const timestampMs = rawTs != null ? Number(rawTs) : undefined;
  if (timestampMs == null || !Number.isFinite(timestampMs)) {
    return c.json({ error: "missing X-Webhook-Timestamp" }, 401);
  }
  try {
    const { runId } = await triggers.fireWebhook(graphId, secret, body.payload, timestampMs);
    return c.json({ runId });
  } catch (e) {
    // 402 是对外的诚实回答：这条 webhook 我们收到了，但配额不允许跑。
    const quota = quotaResponseBody(e);
    if (quota) return c.json(quota, 402);
    if (e instanceof RunStartError) return jsonResponse(e.status, { error: e.message, diagnostics: e.extra });
    if (e instanceof TriggerError) {
      return jsonResponse(e.status, { error: e.message });
    }
    throw e;
  }
});

// Test a connector config without starting a run (preview the pulled material).
app.get("/api/graphs/:id/versions", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const access = await requireGraph(db, userId, graphId, "viewer");
  if (!access) return c.json({ error: "graph not found" }, 404);
  const graph = await db.getGraph(graphId, access.graphOwnerId);
  if (!graph) return c.json({ error: "graph not found" }, 404);
  // Run-correlation hashes (design-versions §3): which snapshot matches what
  // actually ran last, and whether the live graph still matches it.
  const latestRunHash = await db.getLatestRunContentHash(graphId, access.graphOwnerId);
  return c.json({
    versions: await db.listVersions(graphId, access.graphOwnerId),
    latestRunHash,
    currentHash: contentHash(JSON.stringify(graph)),
  });
});

app.post("/api/graphs/:id/versions", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const access = await requireGraph(db, userId, graphId, "editor");
  if (!access) return c.json({ error: "graph not found" }, 404);
  const graph = await db.getGraph(graphId, access.graphOwnerId);
  if (!graph) return c.json({ error: "graph not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; note?: string };
  const name = body.name?.trim() || new Date().toLocaleString();
  const snapshot = JSON.stringify(graph);
  const version = await db.saveVersion(graphId, name, snapshot, body.note ?? "", contentHash(snapshot));
  return c.json(version, 201);
});

app.get("/api/graphs/:id/versions/:vid", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const access = await requireGraph(db, userId, graphId, "viewer");
  if (!access) return c.json({ error: "graph not found" }, 404);
  const v = await db.getVersion(c.req.param("vid"), access.graphOwnerId);
  if (!v) return c.json({ error: "version not found" }, 404);
  return c.json({ id: v.id, graphId: v.graph_id, name: v.name, note: v.note, createdAt: v.created_at, snapshot: JSON.parse(v.snapshot) });
});

app.post("/api/graphs/:id/versions/:vid/restore", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const access = await requireGraph(db, userId, graphId, "editor");
  if (!access) return c.json({ error: "graph not found" }, 404);
  const v = await db.getVersion(c.req.param("vid"), access.graphOwnerId);
  if (!v) return c.json({ error: "version not found" }, 404);
  if (v.graph_id !== graphId) return c.json({ error: "version does not belong to this graph" }, 400);
  const snapshot = JSON.parse(v.snapshot);
  await db.saveGraph(snapshot, Date.now(), access.graphOwnerId);
  audit(db, userId, "graph.restore_version", {
    objectType: "graph",
    objectId: graphId,
    detail: { version: c.req.param("vid") },
    ip: clientIp(c),
  });
  return c.json({ ok: true, graph: snapshot });
});

app.delete("/api/graphs/:id/versions/:vid", async (c) => {
  const userId = c.get("userId");
  const graphId = c.req.param("id");
  const access = await requireGraph(db, userId, graphId, "editor");
  if (!access) return c.json({ error: "graph not found" }, 404);
  await db.deleteVersion(c.req.param("vid"), access.graphOwnerId);
  return c.body(null, 204);
});
}