/**
 * Ops M2 content distribution routes (OP-20~26).
 *
 * Human-gated platform drafts. The only way to `published` is the explicit
 * approve endpoint; the create/review endpoints never publish. Douyin is
 * refused (OP-23 qualification lock).
 */
import {
  ComplianceGateError,
  PublisherNotConfiguredError,
  PublisherService,
  PublisherValidationError,
} from "../publisher/platforms/service.js";
import { IllegalDraftTransition } from "@agent-world/core";
import type { Hono } from "hono";
import { audit } from "../audit.js";
import { clientIp } from "./shared.js";
import type { RouteContext } from "./ctx.js";

export function registerPublisherRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  ctx: RouteContext,
): void {
  const { db, blockDemo } = ctx;

  const errorBody = (message: string) => ({ error: message });

  app.post("/api/platform-drafts", async (c) => {
    const userId = c.get("userId");
    const demo = await blockDemo(c, "publish");
    if (demo) return demo;
    const body = (await c.req.json().catch(() => ({}))) as {
      platform?: string;
      title?: string;
      body?: string;
      tags?: string[];
      graphId?: string;
      runId?: string;
      artifactId?: string;
    };
    const service = new PublisherService(db);
    try {
      const draft = await service.createDraft({
        userId,
        platform: body.platform ?? "",
        title: body.title ?? "",
        body: body.body ?? "",
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        graphId: body.graphId ?? null,
        runId: body.runId ?? null,
        artifactId: body.artifactId ?? null,
      });
      audit(db, userId, "platform_draft.create", { objectType: "platform_draft", objectId: draft.id, detail: { platform: draft.platform }, ip: clientIp(c) });
      return c.json(draft, 201);
    } catch (e) {
      if (e instanceof PublisherNotConfiguredError) return c.json(errorBody(e.message), 422);
      if (e instanceof PublisherValidationError) return c.json(errorBody(e.message), 400);
      throw e;
    }
  });

  app.get("/api/platform-drafts", async (c) => {
    const userId = c.get("userId");
    return c.json(await new PublisherService(db).list(userId));
  });

  app.post("/api/platform-drafts/:id/review", async (c) => {
    const userId = c.get("userId");
    const demo = await blockDemo(c, "publish");
    if (demo) return demo;
    try {
      const draft = await new PublisherService(db).submitForReview(c.req.param("id"), userId);
      audit(db, userId, "platform_draft.review", { objectType: "platform_draft", objectId: draft.id, ip: clientIp(c) });
      return c.json(draft);
    } catch (e) {
      return mapDraftError(c, e);
    }
  });

  app.post("/api/platform-drafts/:id/approve", async (c) => {
    const userId = c.get("userId");
    const demo = await blockDemo(c, "publish");
    if (demo) return demo;
    try {
      const draft = await new PublisherService(db).approve(c.req.param("id"), userId, userId);
      audit(db, userId, "platform_draft.approve", { objectType: "platform_draft", objectId: draft.id, detail: { platform: draft.platform }, ip: clientIp(c) });
      return c.json(draft);
    } catch (e) {
      return mapDraftError(c, e);
    }
  });

  app.post("/api/platform-drafts/:id/reject", async (c) => {
    const userId = c.get("userId");
    const demo = await blockDemo(c, "publish");
    if (demo) return demo;
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    try {
      const draft = await new PublisherService(db).reject(c.req.param("id"), userId, userId, body.reason ?? "");
      audit(db, userId, "platform_draft.reject", { objectType: "platform_draft", objectId: draft.id, ip: clientIp(c) });
      return c.json(draft);
    } catch (e) {
      return mapDraftError(c, e);
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDraftError(c: any, e: unknown): Response {
  if (e instanceof PublisherNotConfiguredError) return c.json({ error: e.message }, 422);
  if (e instanceof ComplianceGateError) return c.json({ error: e.message, violations: e.violations }, 422);
  if (e instanceof PublisherValidationError) return c.json({ error: e.message }, 404);
  if (e instanceof IllegalDraftTransition) return c.json({ error: e.message }, 409);
  throw e;
}
