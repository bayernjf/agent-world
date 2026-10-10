/** Ops route domain (audit P2-2 split from index.ts). */
import { decryptString, encryptString } from "../at-rest.js";
import { audit } from "../audit.js";
import { loadConfig } from "../config.js";
import { loadCrossGraphEdges } from "../crossGraphService.js";
import { publishToChannel } from "../publish.js";
import { visibleGraphs } from "../rbac.js";
import { clientIp } from "./shared.js";
import { WEBHOOK_TIMESTAMP_WINDOW_MS, secretEqual } from "../triggers.js";
import { AD_LAW_BANNED_WORDS, Graph, PLATFORM_PROFILES, getTemplate, parseCsv, replay, rowsToCsv, unpricedModels } from "@agent-world/core";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { RouteContext } from "./ctx.js";

export function registerOpsRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  ctx: RouteContext,
): void {
  const { db, triggers, blockDemo } = ctx;

app.get("/api/costs", async (c) => {
  const userId = c.get("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const groupBy = c.req.query("groupBy");
  // Content-level attribution (F9): aggregate cost/GMV/ROI by artifact/product/
  // platform/variant from the content_costs snapshots.
  if (groupBy && ["artifact_id", "product_id", "platform", "variant"].includes(groupBy)) {
    return c.json(await db.aggregateContentCosts(userId, groupBy));
  }
  return c.json({
    ...(await db.costReport({
      userId,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
    })),
    // Surfaced next to the numbers on purpose: an incomplete price card makes
    // those numbers quietly too low, and this page is where they get read.
    unpricedModels: unpricedModels((await loadConfig(userId)).providers),
  });
});

app.post("/api/content-costs", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    artifactId?: string | null;
    productId?: string | null;
    platform?: string | null;
    variant?: string | null;
    costUsd?: number;
    gmv?: number;
    capturedAt?: number;
  };
  const cost = await db.insertContentCost({
    id: randomUUID(),
    userId,
    artifactId: body.artifactId,
    productId: body.productId,
    platform: body.platform,
    variant: body.variant,
    costUsd: body.costUsd,
    gmv: body.gmv,
    capturedAt: body.capturedAt ?? Date.now(),
  });
  return c.json(cost, 201);
});

app.get("/api/content-costs", async (c) => {
  const userId = c.get("userId");
  return c.json(await db.listContentCosts(userId));
});

// --- Publish targets & open-channel publishing (F7-B) ---

app.post("/api/publish-targets", async (c) => {
  const userId = c.get("userId");
  const d = await blockDemo(c, "publish"); if (d) return d;
  const body = (await c.req.json().catch(() => ({}))) as {
    platform?: string;
    name?: string;
    provider?: string;
    url?: string;
    token?: string;
    metricsSecret?: string;
  };
  if (!body.platform || !body.provider || !body.url) {
    return c.json({ error: "platform/provider/url are required" }, 400);
  }
  // metricsSecret is the inbound webhook secret for effect-feedback collection;
  // it rides inside the encrypted config like `token`.
  const configEncrypted = encryptString(JSON.stringify({ url: body.url, token: body.token ?? "", metricsSecret: body.metricsSecret ?? "" }));
  const target = await db.createPublishTarget({
    id: randomUUID(),
    userId,
    platform: body.platform,
    name: body.name,
    provider: body.provider,
    configEncrypted,
    createdAt: Date.now(),
  });
  // Platform/provider ids only — never the webhook url or token it wraps.
  audit(db, userId, "publish_target.create", {
    objectType: "publish_target",
    objectId: target.id,
    detail: { platform: body.platform, provider: body.provider, hasToken: Boolean(body.token) },
    ip: clientIp(c),
  });
  return c.json(target, 201);
});

app.get("/api/publish-targets", async (c) => {
  const userId = c.get("userId");
  const targets = (await db.listPublishTargets(userId)).map((t) => {
    let config: { url?: string; token?: string; metricsSecret?: string } = {};
    try {
      config = JSON.parse(decryptString(t.configEncrypted));
    } catch {
      /* leave empty */
    }
    return { ...t, config };
  });
  return c.json(targets);
});

app.delete("/api/publish-targets/:id", async (c) => {
  const userId = c.get("userId");
  const d = await blockDemo(c, "publish"); if (d) return d;
  const id = c.req.param("id");
  const ok = await db.deletePublishTarget(id, userId);
  if (ok) audit(db, userId, "publish_target.delete", { objectType: "publish_target", objectId: id, ip: clientIp(c) });
  return c.json({ ok });
});

app.post("/api/publish", async (c) => {
  const userId = c.get("userId");
  const d = await blockDemo(c, "publish"); if (d) return d;
  const body = (await c.req.json().catch(() => ({}))) as {
    targetId?: string;
    title?: string;
    body?: string;
    tags?: string[];
    graphId?: string;
    runId?: string;
    artifactId?: string;
  };
  const target = (await db.listPublishTargets(userId)).find((t) => t.id === body.targetId);
  if (!target) return c.json({ error: "publish target not found" }, 404);
  let config: { url?: string; token?: string } = {};
  try {
    config = JSON.parse(decryptString(target.configEncrypted));
  } catch {
    return c.json({ error: "target config is unreadable" }, 400);
  }
  try {
    const result = await publishToChannel(
      { provider: target.provider, url: config.url ?? "", token: config.token },
      { title: body.title ?? "", body: body.body ?? "", tags: body.tags ?? [] },
    );
    const record = await db.insertPublishedContent({
      id: randomUUID(),
      userId,
      graphId: body.graphId,
      runId: body.runId,
      artifactId: body.artifactId,
      platform: target.platform,
      status: "published",
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      publishedAt: Date.now(),
      detailJson: JSON.stringify(result.detail),
    });
    return c.json(record, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "publish failed" }, 502);
  }
});

app.get("/api/published", async (c) => {
  const userId = c.get("userId");
  return c.json(await db.listPublishedContents(userId));
});

// --- Metrics webhook (F6: effect-feedback auto-collection, read-only inbound) ---
// A merchant's own middle tier / third-party data tool pushes impressions/clicks/
// conversions/GMV back by content id. Auth is per-channel secret + timestamp
// (same replay window as the trigger webhook); no session user is involved.
app.post("/api/metrics/webhook/:targetId", async (c) => {
  const targetId = c.req.param("targetId");
  const body = (await c.req.json().catch(() => ({}))) as {
    secret?: string;
    timestamp?: number;
    metrics?: Array<{
      external_content_id?: string | null;
      artifact_id?: string | null;
      impressions?: number;
      clicks?: number;
      conversions?: number;
      gmv?: number;
      ad_spend?: number;
      recorded_at?: number;
    }>;
  };

  const target = await db.getPublishTarget(targetId);
  if (!target) return c.json({ error: "publish target not found" }, 404);

  let config: { metricsSecret?: string } = {};
  try {
    config = JSON.parse(decryptString(target.configEncrypted));
  } catch {
    return c.json({ error: "target config is unreadable" }, 400);
  }

  const secret = body.secret ?? c.req.header("x-webhook-secret") ?? "";
  const expected = config.metricsSecret ?? "";
  const insecureAllowed = process.env.ALLOW_INSECURE_METRICS_WEBHOOK === "1";

  // Secret gate: a channel must have a configured secret, unless the insecure
  // escape hatch is explicitly enabled for a trusted intranet middle tier.
  if (!expected && !insecureAllowed) {
    return c.json({ error: "this channel has no metrics secret configured" }, 401);
  }
  if (expected && !secretEqual(expected, secret)) {
    return c.json({ error: "invalid metrics webhook secret" }, 401);
  }

  // Replay defence: fresh timestamp required, same window as the trigger webhook.
  const rawTs = c.req.header("x-webhook-timestamp") ?? body.timestamp;
  const timestampMs = rawTs != null ? Number(rawTs) : undefined;
  if (
    timestampMs == null ||
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > WEBHOOK_TIMESTAMP_WINDOW_MS
  ) {
    return c.json({ error: "webhook timestamp missing or outside the allowed replay window" }, 401);
  }

  const metrics = Array.isArray(body.metrics) ? body.metrics : [];
  if (metrics.length === 0) return c.json({ error: "metrics array is required" }, 400);

  let inserted = 0;
  const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
  for (const m of metrics) {
    const externalId = m.external_content_id ? String(m.external_content_id) : null;
    const artifactId = m.artifact_id ? String(m.artifact_id) : null;
    // A metric that links to nothing is noise — skip it instead of inventing a row.
    if (!externalId && !artifactId) continue;
    await db.insertMetric({
      id: randomUUID(),
      userId: target.userId,
      artifactId,
      platform: target.platform,
      externalContentId: externalId,
      impressions: num(m.impressions),
      clicks: num(m.clicks),
      conversions: num(m.conversions),
      gmv: num(m.gmv),
      adSpend: num(m.ad_spend),
      recordedAt: m.recorded_at ? Number(m.recorded_at) : Date.now(),
    });
    inserted++;
  }

  return c.json({ inserted }, 201);
});

app.get("/api/costs.csv", async (c) => {
  const userId = c.get("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const { byGraph, byNode, byModel, byDay } = await db.costRows({
    userId,
    from: from ? Number(from) : undefined,
    to: to ? Number(to) : undefined,
  });

  const esc = (v: unknown) => {
    const str = String(v ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines: string[] = [];
  lines.push("# section,key1,key2,runs/attempts,tokens_in,tokens_out,cost_usd");
  for (const g of byGraph) {
    lines.push(["graph", g.graph_name, "", g.runs, g.tokens_in, g.tokens_out, g.cost_usd.toFixed(6)].map(esc).join(","));
  }
  for (const n of byNode) {
    lines.push(["node", n.graph_name, n.node_name, n.attempts, n.tokens_in, n.tokens_out, n.cost_usd.toFixed(6)].map(esc).join(","));
  }
  for (const m of byModel) {
    lines.push(["model", m.model, "", m.calls, m.tokens_in, m.tokens_out, m.cost_usd.toFixed(6)].map(esc).join(","));
  }
  for (const d of byDay) {
    lines.push(["day", d.day, "", d.runs, d.tokens_in, d.tokens_out, d.cost_usd.toFixed(6)].map(esc).join(","));
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="agent-world-costs-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
});

app.get("/api/plan", async (c) => {
  const userId = c.get("userId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const plans =
    from && to
      ? await db.listPlans(userId, Number(from), Number(to))
      : await db.listPlans(userId);
  return c.json(plans);
});

app.post("/api/plan", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    graphId?: string | null;
    runId?: string | null;
    artifactId?: string | null;
    platform?: string | null;
    title?: string;
    scheduledAt?: number;
    note?: string | null;
  };
  if (!body.title?.trim()) return c.json({ error: "title required" }, 400);
  if (!body.scheduledAt) return c.json({ error: "scheduledAt required" }, 400);
  const plan = await db.createPlan({
    id: randomUUID(),
    userId,
    graphId: body.graphId,
    runId: body.runId,
    artifactId: body.artifactId,
    platform: body.platform,
    title: body.title.trim(),
    scheduledAt: body.scheduledAt,
    note: body.note,
  });
  return c.json(plan, 201);
});

const PlanPatchSchema = z
  .object({
    graphId: z.string().nullable().optional(),
    runId: z.string().nullable().optional(),
    artifactId: z.string().nullable().optional(),
    platform: z.string().nullable().optional(),
    title: z.string().optional(),
    scheduledAt: z.number().optional(),
    status: z.enum(["draft", "pending_review", "scheduled", "published", "failed"]).optional(),
    publishedUrl: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .partial()
  .passthrough();

app.patch("/api/plan/:id", async (c) => {
  const userId = c.get("userId");
  const parsed = PlanPatchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid plan payload", details: parsed.error.flatten() }, 400);
  }
  const body = parsed.data;
  const plan = await db.updatePlan(c.req.param("id"), userId, body);
  if (!plan) return c.json({ error: "not found" }, 404);
  return c.json(plan);
});

app.delete("/api/plan/:id", async (c) => {
  const userId = c.get("userId");
  const plan = await db.getPlan(c.req.param("id"), userId);
  if (!plan) return c.json({ error: "not found" }, 404);
  await db.deletePlan(plan.id, userId);
  return c.body(null, 204);
});

// --- Performance metrics (F6: content effect feedback loop) ---
app.post("/api/metrics", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    graphId?: string | null;
    runId?: string | null;
    nodeId?: string | null;
    variant?: string | null;
    artifactId?: string | null;
    productId?: string | null;
    platform?: string | null;
    externalContentId?: string | null;
    impressions?: number;
    clicks?: number;
    conversions?: number;
    gmv?: number;
    adSpend?: number;
    recordedAt?: number;
  };
  const metric = await db.insertMetric({
    id: randomUUID(),
    userId,
    graphId: body.graphId,
    runId: body.runId,
    nodeId: body.nodeId,
    variant: body.variant,
    artifactId: body.artifactId,
    productId: body.productId,
    platform: body.platform,
    externalContentId: body.externalContentId,
    impressions: body.impressions,
    clicks: body.clicks,
    conversions: body.conversions,
    gmv: body.gmv,
    adSpend: body.adSpend,
    recordedAt: body.recordedAt ?? Date.now(),
  });
  return c.json(metric, 201);
});

app.post("/api/metrics/import", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as { csv?: string };
  if (!body.csv) return c.json({ error: "csv required" }, 400);
  const rows = parseCsv(body.csv, { hasHeader: true });
  let imported = 0;
  for (const row of rows) {
    const num = (v: unknown) => (v === null || v === "" ? 0 : Number(v));
    await db.insertMetric({
      id: randomUUID(),
      userId,
      graphId: row.graph_id ? String(row.graph_id) : null,
      runId: row.run_id ? String(row.run_id) : null,
      artifactId: row.artifact_id ? String(row.artifact_id) : null,
      productId: row.product_id ? String(row.product_id) : null,
      platform: row.platform ? String(row.platform) : null,
      externalContentId: row.external_content_id ? String(row.external_content_id) : null,
      impressions: num(row.impressions),
      clicks: num(row.clicks),
      conversions: num(row.conversions),
      gmv: num(row.gmv),
      adSpend: num(row.ad_spend),
      recordedAt: row.recorded_at ? Number(row.recorded_at) : Date.now(),
    });
    imported += 1;
  }
  return c.json({ imported });
});

app.get("/api/metrics", async (c) => {
  const userId = c.get("userId");
  return c.json(await db.listMetrics(userId));
});

app.get("/api/performance", async (c) => {
  const userId = c.get("userId");
  const groupBy = c.req.query("groupBy") ?? "graph_id";
  return c.json(await db.aggregatePerformance(userId, groupBy));
});

// --- Operations dashboard overview (RTS phase A2) ---
app.get("/api/operations/overview", async (c) => {
  const userId = c.get("userId");
  // Optional window start (epoch ms). Counters/cost honor it; per-graph last*
  // always spans all time (handled in operationsByGraph).
  const rawSince = Number(c.req.query("since"));
  const since = Number.isFinite(rawSince) && rawSince > 0 ? rawSince : undefined;
  // Owned + shared graphs (design-rbac P1); collaborator runs live under owner.
  const graphIds = [...(await visibleGraphs(db, userId)).keys()];
  const graphs = await db.operationsByGraph(userId, { since, graphIds });
  // RTS stage-C C4/C6: month-boundary economy (same boundary rule as
  // costForMonth), per-graph F6 metrics, and the global monthly budget.
  const nowMs = Date.now();
  const nowDate = new Date(nowMs);
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  const monthEnd = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1).getTime();
  const [economy, metricsByG, cfg, plans] = await Promise.all([
    db.operationsEconomy(userId, { monthStart, monthEnd, graphIds }),
    db.metricsByGraph(userId, graphIds),
    loadConfig(userId),
    // RTS stage-C C5: scheduled content over the next 48h feeds the schedule axis.
    db.listPlans(userId, nowMs, nowMs + 48 * 3600 * 1000),
  ]);
  // RTS stage-B: attach the manual macro-park override per graph (only laid-out
  // graphs are returned; the client auto-layouts the missing ones).
  const parkCoords = await db.getParkCoords(userId, graphIds);
  const zeroMetrics = { impressions: 0, clicks: 0, conversions: 0, gmv: 0, adSpend: 0 };
  for (const g of graphs) {
    const p = parkCoords[g.graphId];
    g.parkX = p ? p.x : null;
    g.parkZ = p ? p.z : null;
    // RTS stage-B B3: display category from the origin template (graphs carry
    // no category of their own); non-template/blank graphs fall back to 自定义.
    g.category = (g.originTemplateId && getTemplate(g.originTemplateId)?.category) || "自定义";
    // F2 review queue = halted runs awaiting a human decision.
    g.pendingReview = g.halted;
    // RTS stage-C C6: effect metrics (all-zero → the factory honestly shows no heat).
    g.metrics = metricsByG[g.graphId] ?? zeroMetrics;
  }
  const totals = graphs.reduce(
    (acc, g) => {
      acc.totalRuns += g.totalRuns;
      acc.running += g.running;
      acc.halted += g.halted;
      acc.done += g.done;
      acc.failed += g.failed;
      acc.tripped += g.tripped;
      acc.cancelled += g.cancelled;
      acc.costUsd += g.costUsd;
      return acc;
    },
    {
      totalRuns: 0, running: 0, halted: 0, done: 0, failed: 0, tripped: 0, cancelled: 0, costUsd: 0,
      // RTS stage-C C4: month economy + global monthly budget (null = no cap set).
      monthCostUsd: economy.monthCostUsd,
      tokensIn: economy.tokensIn,
      tokensOut: economy.tokensOut,
      monthlyBudgetUsd: cfg.monthlyBudgetUsd ?? null,
    },
  );
  // Next cron fire per graph (cron triggers only); graphs without one omitted.
  const nextRuns: Record<string, Record<string, number | null>> = {};
  // RTS stage-C C5/C7: per-graph cron summary — hasCron (any cron exists),
  // enabled (at least one active), nextAt (nearest active fire). Paused crons
  // stay listed (hasCron) so the popover can offer "resume", but contribute no nextAt.
  const cronState: Record<string, { hasCron: boolean; enabled: boolean; nextAt: number | null }> = {};
  for (const gid of graphIds) {
    const m = triggers.nextRunMap(gid);
    if (Object.keys(m).length > 0) nextRuns[gid] = m;
    const crons = triggers.listByGraph(gid).filter((tr) => tr.type === "cron" && tr.cron);
    if (crons.length > 0) {
      const active = crons.filter((tr) => tr.enabled !== false);
      const activeNext = active
        .map((tr) => m[tr.id])
        .filter((v): v is number => typeof v === "number");
      cronState[gid] = {
        hasCron: true,
        enabled: active.length > 0,
        nextAt: activeNext.length > 0 ? Math.min(...activeNext) : null,
      };
    }
  }
  // RTS stage-C C1: material-flow edges between the visible factories
  // (subprocess nodes + graph-event triggers). internalOnly keeps edges inside
  // the caller's visible scope.
  const crossEdges = await loadCrossGraphEdges(graphIds, (gid) => db.getGraphById(gid));
  return c.json({ generatedAt: Date.now(), since: since ?? null, totals, graphs, nextRuns, crossEdges, plans, cronState });
});

// --- Trigger management + webhook ---
app.get("/api/brand-terms", async (c) => {
  const userId = c.get("userId");
  return c.json(await db.listBrandTerms(userId));
});

app.post("/api/brand-terms", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as { term?: string; note?: string };
  if (!body.term?.trim()) return c.json({ error: "term required" }, 400);
  return c.json(await db.addBrandTerm(userId, body.term, body.note ?? ""), 201);
});

app.delete("/api/brand-terms/:id", async (c) => {
  const userId = c.get("userId");
  await db.deleteBrandTerm(c.req.param("id"), userId);
  return c.body(null, 204);
});

// --- Products (F4: reusable product library) ---
app.get("/api/products", async (c) => {
  const userId = c.get("userId");
  const search = c.req.query("search");
  const category = c.req.query("category");
  const status = c.req.query("status");
  return c.json(await db.listProducts(userId, { search, category, status }));
});

app.post("/api/products", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    sku?: string;
    name?: string;
    brand?: string;
    category?: string;
    price?: number | null;
    attributes?: Record<string, unknown>;
    images?: string[];
  };
  if (!body.name?.trim()) return c.json({ error: "name required" }, 400);
  try {
    return c.json(await db.addProduct(userId, { ...body, name: body.name }), 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "invalid" }, 400);
  }
});

app.post("/api/products/import", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as { csv?: string };
  const csv = body.csv?.trim();
  if (!csv) return c.json({ error: "csv required" }, 400);
  const rows = parseCsv(csv, { hasHeader: true });
  const report = { imported: 0, failed: 0, errors: [] as string[] };
  const created: unknown[] = [];
  for (const [i, row] of rows.entries()) {
    const name = String(row.name ?? "").trim();
    if (!name) {
      report.failed++;
      report.errors.push(`Row ${i + 2} is missing the name column`);
      continue;
    }
    const attributes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!["name", "sku", "brand", "category", "price"].includes(k)) attributes[k] = v;
    }
    try {
      const p = await db.addProduct(userId, {
        name,
        sku: String(row.sku ?? ""),
        brand: String(row.brand ?? ""),
        category: String(row.category ?? ""),
        price: row.price == null || row.price === "" ? null : Number(row.price),
        attributes,
      });
      created.push(p);
      report.imported++;
    } catch (err) {
      report.failed++;
      report.errors.push(`Row ${i + 2}: ${err instanceof Error ? err.message : "Import failed"}`);
    }
  }
  return c.json({ ...report, products: created });
});

app.get("/api/products/export", async (c) => {
  const userId = c.get("userId");
  const products = await db.listProducts(userId);
  const rows = products.map((p) => ({
    name: p.name,
    sku: p.sku,
    brand: p.brand,
    category: p.category,
    price: p.price ?? "",
  }));
  const csv = rowsToCsv(rows, ["name", "sku", "brand", "category", "price"]);
  return c.text(csv, 200, { "content-type": "text/csv; charset=utf-8" });
});

app.patch("/api/products/:id", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    sku?: string;
    name?: string;
    brand?: string;
    category?: string;
    price?: number | null;
    attributes?: Record<string, unknown>;
    images?: string[];
    status?: "active" | "archived";
  };
  const updated = await db.updateProduct(c.req.param("id"), userId, body);
  if (!updated) return c.json({ error: "not found" }, 404);
  return c.json(updated);
});

app.delete("/api/products/:id", async (c) => {
  const userId = c.get("userId");
  await db.deleteProduct(c.req.param("id"), userId);
  return c.body(null, 204);
});

// --- Brand assets (F4: reusable brand material) ---
app.get("/api/brand-assets", async (c) => {
  const userId = c.get("userId");
  return c.json(await db.listBrandAssets(userId));
});

app.post("/api/brand-assets", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as {
    type?: string;
    label?: string;
    uri?: string;
    tags?: string[];
  };
  if (!body.label?.trim()) return c.json({ error: "label required" }, 400);
  return c.json(
    await db.addBrandAsset(userId, {
      type: body.type ?? "image",
      label: body.label,
      uri: body.uri ?? "",
      tags: body.tags ?? [],
    }),
    201,
  );
});

app.delete("/api/brand-assets/:id", async (c) => {
  const userId = c.get("userId");
  await db.deleteBrandAsset(c.req.param("id"), userId);
  return c.body(null, 204);
});

/**
 * Platform compliance profiles (F3). Returns the built-in profiles and the
 * regulatory banned-word baseline meta so the Inspector can render rules.
 */
app.get("/api/platforms", (c) => {
  return c.json({
    profiles: PLATFORM_PROFILES,
    adLawBannedWords: AD_LAW_BANNED_WORDS,
  });
});

app.get("/api/banned-terms", async (c) => {
  const userId = c.get("userId");
  return c.json(await db.listBannedTerms(userId));
});

app.post("/api/banned-terms", async (c) => {
  const userId = c.get("userId");
  const body = (await c.req.json().catch(() => ({}))) as { term?: string; note?: string };
  if (!body.term?.trim()) return c.json({ error: "term required" }, 400);
  return c.json(await db.addBannedTerm(userId, body.term, body.note ?? ""), 201);
});

app.delete("/api/banned-terms/:id", async (c) => {
  const userId = c.get("userId");
  await db.deleteBannedTerm(c.req.param("id"), userId);
  return c.body(null, 204);
});

// --- Graph versions (5.6) ---
}