/** Settings route domain (audit P2-2 split from index.ts). */
import { audit, changedFields } from "../audit.js";
import type { AppConfig, Modality } from "../config.js";
import { AppConfigSchema, DEFAULT_MODALITY, MODALITIES, MODALITY_ENDPOINT, endpointFor, loadConfig, modalityOf, normalizeBaseUrl, saveConfig } from "../config.js";
import { log } from "../logger.js";
import { errMsg, isAbortError } from "../safe-utils.js";
import { sanitizeError } from "../sanitize.js";
import { guardedFetch } from "../ssrf.js";
import { Hono } from "hono";
import { join } from "node:path";
import { clientIp } from "./shared.js";
import type { RouteContext } from "./ctx.js";

/**
 * Lightweight video connectivity probe. Never submits a real generation job:
 * generation is slow and billed per task, so "test connection" only verifies
 * the key and model existence. Uses GET /models (the OpenAI-compatible
 * standard for key + model-list validation); falls back to POSTing an empty
 * prompt to the video endpoint, which providers reject fast with a 4xx
 * validation error without doing any real work.
 */
async function probeVideo(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<{ ok: boolean; status?: number; error?: string; modality: "video"; endpoint?: string; note?: string }> {
  const PROBE_TIMEOUT_MS = 15_000;
  const modelsUrl = `${baseUrl}/models`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let res: Response;
  try {
    // Provider probes hit a user-supplied baseUrl — leave through the guarded
    // egress (audit H5 SSRF half).
    res = await guardedFetch(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (isAbortError(err)) return { ok: false, modality: "video", error: "连接超时（15s）" };
    return { ok: false, modality: "video", error: sanitizeError(errMsg(err)) };
  } finally {
    clearTimeout(timer);
  }

  if (res.ok) {
    const json = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
    const ids = (json.data ?? []).map((m) => m.id).filter(Boolean);
    if (ids.length > 0) {
      if (ids.includes(model)) return { ok: true, modality: "video", endpoint: modelsUrl };
      return { ok: false, modality: "video", endpoint: modelsUrl, error: `模型 ${model} 不在服务商模型列表中` };
    }
    // Key + endpoint responded, but no model list was returned.
    return { ok: true, modality: "video", endpoint: modelsUrl, note: "服务商未返回模型列表，仅校验到 Key 与端点可达" };
  }

  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, modality: "video", error: `HTTP ${res.status}: ${sanitizeError(text.slice(0, 300))}` };
  }

  // No GET /models on this provider (404/405): POST an empty prompt to the
  // video endpoint. Valid providers reject it fast with a 4xx validation
  // error — that proves the endpoint and key without starting a job.
  if (res.status === 404 || res.status === 405) {
    const postController = new AbortController();
    const postTimer = setTimeout(() => postController.abort(), PROBE_TIMEOUT_MS);
    try {
      const postRes = await guardedFetch(`${baseUrl}${MODALITY_ENDPOINT.video}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt: "" }),
        signal: postController.signal,
      });
      if (postRes.status === 400 || postRes.status === 422) {
        return {
          ok: true,
          modality: "video",
          endpoint: `${baseUrl}${MODALITY_ENDPOINT.video}`,
          note: "端点可达且 Key 有效（空 prompt 被参数校验拒绝，未触发生成）",
        };
      }
      if (postRes.status === 401 || postRes.status === 403) {
        return { ok: false, status: postRes.status, modality: "video", error: `HTTP ${postRes.status}: API Key 无效` };
      }
      if (postRes.ok) {
        return { ok: false, modality: "video", error: "服务商接受了空 prompt（返回 2xx），疑似真实触发生成；请改用运行时验证" };
      }
      const text = await postRes.text().catch(() => "");
      return { ok: false, status: postRes.status, modality: "video", error: `HTTP ${postRes.status}: ${sanitizeError(text.slice(0, 300))}` };
    } finally {
      clearTimeout(postTimer);
    }
  }

  const text = await res.text().catch(() => "");
  return { ok: false, status: res.status, modality: "video", error: `HTTP ${res.status}: ${sanitizeError(text.slice(0, 300))}` };
}

/**
 * Minimal request body for a connectivity probe, shaped per modality. Video is
 * excluded: it probes via GET /models and never sends a generation request.
 */
function buildTestPayload(modality: Exclude<Modality, "video">, model: string): Record<string, unknown> {
  switch (modality) {
    case "text":
      return { model, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: false };
    case "image":
      return { model, prompt: "test", n: 1, size: "1024x1024" };
    case "embedding":
      return { model, input: "test" };
    case "audio":
      // OpenAI-compatible TTS. A one-character input keeps the response tiny.
      return { model, input: ".", voice: "alloy" };
  }
}




function redactKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 6)}${"*".repeat(6)}${key.slice(-4)}`;
}

/** A key that came back from the UI and looks redacted, not the real secret. */
function isRedactedKey(key: string | undefined): boolean {
  if (!key) return true;
  return key.includes("*") || key.includes("...");
}


export function registerSettingsRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  ctx: RouteContext,
): void {
  const { db, worker } = ctx;

function redactSearchConfigForUi(s: NonNullable<AppConfig["searchConfig"]>): NonNullable<AppConfig["searchConfig"]> {
  const out: NonNullable<AppConfig["searchConfig"]> = { ...s };
  // The legacy flat key must never leave the server in cleartext either.
  if (out.apiKey) out.apiKey = redactKey(out.apiKey);
  for (const p of ["tavily", "serpapi", "google"] as const) {
    // Tavily/serpapi carry only apiKey, google also cx — treat all three as the
    // common optional shape so migration and redaction stay type-safe.
    const slot: { apiKey?: string; cx?: string } = { ...(s[p] ?? {}) };
    // Read-time migration: seed the slot from the legacy flat credential,
    // but only when the flat config targeted this same provider.
    if (s.provider === p) {
      if (s.apiKey && !slot.apiKey) slot.apiKey = s.apiKey;
      if (p === "google" && s.cx && !slot.cx) slot.cx = s.cx;
    }
    if (slot.apiKey) slot.apiKey = redactKey(slot.apiKey);
    out[p] = slot;
  }
  return out;
}

/**
 * A user's MCP servers as the UI sees them: every header value is redacted.
 * Header names stay visible (the form needs to show which headers are set),
 * the values never leave the server in cleartext — an MCP auth header is a
 * bearer token in all but name.
 */
function redactMcpServersForUi(servers: NonNullable<AppConfig["mcpServers"]>): NonNullable<AppConfig["mcpServers"]> {
  return servers.map((s) =>
    s.headers
      ? { ...s, headers: Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [k, redactKey(v)])) }
      : s,
  );
}

app.get("/api/settings", async (c) => {
  const cfg = await loadConfig(c.get("userId"));
  // Never return raw API keys — redact for the UI.
  const redacted: AppConfig = {
    ...cfg,
    providers: Object.fromEntries(
      Object.entries(cfg.providers).map(([name, p]) => [
        name,
        { ...p, apiKey: p.apiKey ? redactKey(p.apiKey) : undefined },
      ]),
    ),
    searchConfig: cfg.searchConfig ? redactSearchConfigForUi(cfg.searchConfig) : undefined,
    mcpServers: cfg.mcpServers ? redactMcpServersForUi(cfg.mcpServers) : undefined,
  };
  return c.json(redacted);
});

// Security audit trail (design-audit-log §3.4). Plain users see their own
// records only (the userId query param is ignored — no cross-user leak);
// owner/admin (design-rbac P3) see every user's rows, with an optional
// userId filter. Newest first, cursor-paginated.
app.put("/api/settings", async (c) => {
  const userId = c.get("userId");
  const rawBody = await c.req.json();
  const parsed = AppConfigSchema.partial().safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: "Invalid settings payload", details: parsed.error.flatten() }, 400);
  }
  const body = parsed.data;
  const current = await loadConfig(userId);
  const bodyProviders = body.providers ?? {};
  const mergedProviders: AppConfig["providers"] = {};
  // Always keep the internal fake provider.
  if (current.providers.fake) mergedProviders.fake = current.providers.fake;
  for (const [name, provider] of Object.entries(bodyProviders)) {
    // If the UI sent back a redacted key, keep the real one.
    if (provider.apiKey && isRedactedKey(provider.apiKey)) {
      provider.apiKey = current.providers[name]?.apiKey ?? provider.apiKey;
    }
    mergedProviders[name] = provider;
  }
  const merged: AppConfig = {
    ...current,
    ...body,
    providers: mergedProviders,
  };
  // Same redacted-key round-trip rule for the user-level search service, per
  // provider: a masked key echoed back means "unchanged" — keep the stored one.
  if (body.searchConfig) {
    const mergedSearch: NonNullable<AppConfig["searchConfig"]> = { ...body.searchConfig };
    for (const p of ["tavily", "serpapi", "google"] as const) {
      const slot = mergedSearch[p];
      if (slot?.apiKey && isRedactedKey(slot.apiKey)) {
        mergedSearch[p] = { ...slot, apiKey: current.searchConfig?.[p]?.apiKey ?? slot.apiKey };
      }
    }
    if (body.searchConfig.apiKey && isRedactedKey(body.searchConfig.apiKey)) {
      mergedSearch.apiKey = current.searchConfig?.apiKey ?? body.searchConfig.apiKey;
    }
    merged.searchConfig = mergedSearch;
  }
  // Same rule for MCP auth headers, matched per server id + header name: a
  // masked value echoed back from the form means "unchanged". Without this,
  // saving any unrelated setting would overwrite the real token with asterisks.
  if (body.mcpServers) {
    merged.mcpServers = body.mcpServers.map((server) => {
      if (!server.headers) return server;
      const previous = current.mcpServers?.find((s) => s.id === server.id)?.headers ?? {};
      const headers = Object.fromEntries(
        Object.entries(server.headers).map(([name, value]) => [
          name,
          isRedactedKey(value) && previous[name] ? previous[name] : value,
        ]),
      );
      return { ...server, headers };
    });
  }
  const path = await saveConfig(merged, userId);
  // Audit field PATHS only — never values (red line in design-audit-log §3.2).
  audit(db, userId, "settings.update", {
    objectType: "settings",
    detail: { fields: changedFields(Object.fromEntries(Object.entries(current)), Object.fromEntries(Object.entries(merged))) },
    ip: clientIp(c),
  });
  return c.json({ ok: true, path });
});

/**
 * Test a provider connection without saving. Accepts provider config in the
 * body so the user can verify before hitting save. Text/embedding probe with a
 * minimal non-streaming request; image/audio trigger a real generation (billed)
 * and validate the response shape; video probes cheaply via GET /models and
 * never submits a real generation job.
 */
app.post("/api/providers/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    modality?: Modality;
    /** When set, use the saved real key for this provider if the body has no new key. */
    providerName?: string;
  };
  const rawUrl = body.baseUrl ?? "";
  if (!rawUrl.trim()) return c.json({ ok: false, error: "Base URL is required" }, 400);
  const baseUrl = normalizeBaseUrl(rawUrl);
  let apiKey = body.apiKey ?? "";
  const model = body.model?.trim() || "agnes-2.5-flash";

  // Resolve modality: explicit > saved for this model > text default.
  if (body.modality !== undefined && !MODALITIES.includes(body.modality)) {
    return c.json(
      { ok: false, error: `Invalid modality "${body.modality}". Expected one of: ${MODALITIES.join(", ")}` },
      400,
    );
  }
  let modality: Modality = body.modality ?? DEFAULT_MODALITY;
  const saved = body.providerName
    ? (await loadConfig(c.get("userId"))).providers[body.providerName]
    : undefined;
  if (saved) modality = body.modality ?? modalityOf(saved, model);

  // The UI holds a redacted key for already-saved providers. If the caller did
  // not type a fresh key (empty or looks redacted), resolve the real key from
  // the saved config on the server.
  const looksRedacted = !apiKey || isRedactedKey(apiKey);
  if (looksRedacted && body.providerName) {
    if (!saved) {
      return c.json({ ok: false, error: `Provider "${body.providerName}" 未保存，请先添加并保存` }, 400);
    }
    // A server-resolved key must never travel to a caller-chosen destination:
    // pairing the saved key with a different baseUrl would let any user
    // exfiltrate it to their own host. Key and endpoint must stay same-source;
    // to test a new address, supply a fresh key in the same request.
    if (normalizeBaseUrl(saved.baseUrl ?? "") !== baseUrl) {
      return c.json(
        { ok: false, error: "使用已保存的 API Key 时不能修改 Base URL；如需测试新地址，请同时填入新的 API Key" },
        400,
      );
    }
    if (saved.apiKey && !isRedactedKey(saved.apiKey)) apiKey = saved.apiKey;
  }

  if (!apiKey || isRedactedKey(apiKey)) {
    return c.json({ ok: false, error: "API Key 未配置或已失效，请重新填写" }, 400);
  }

  // A real key is about to leave the process for a probe — audit the attempt
  // (design-audit-log §3.2). Provider name only, never the key or baseUrl.
  audit(db, c.get("userId"), "settings.test_provider", {
    objectType: "settings",
    detail: { provider: body.providerName ?? null },
    ip: clientIp(c),
  });

  // Prefer the saved provider's endpoint override (per modality); the probe and
  // the real worker must agree on where to POST, so share endpointFor().
  const endpoint = saved ? endpointFor(saved, model, modality) : MODALITY_ENDPOINT[modality];

  // Video generation is slow and billed per job — "test connection" must not
  // trigger a real job. Probe cheaply (GET /models), matching market practice.
  if (modality === "video") {
    return c.json(await probeVideo(baseUrl, apiKey, model));
  }

  const payload = buildTestPayload(modality, model);

  // Image/video generation is much slower than chat; give those a longer leash.
  const PROBE_TIMEOUT: Record<Modality, number> = {
    text: 15_000,
    embedding: 15_000,
    image: 90_000,
    video: 120_000,
    audio: 60_000,
  };
  const probeTimeoutMs = PROBE_TIMEOUT[modality];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);
  try {
    // Provider probes hit a user-supplied baseUrl — route through the guarded
    // egress so a custom endpoint can never be pointed at internal services
    // (audit H5 SSRF half).
    const res = await guardedFetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json({
        ok: false,
        status: res.status,
        error: sanitizeError(`HTTP ${res.status}: ${text.slice(0, 300)}`),
      });
    }
    // Image is a real, billed call — don't trust a bare 2xx, verify the
    // response actually carries generated images.
    if (modality === "image") {
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const items = json.data ?? [];
      if (items.length === 0 || items.some((it) => !it.b64_json && !it.url)) {
        return c.json({
          ok: false,
          status: res.status,
          error: "图片接口返回 2xx 但未包含有效图片数据（data 为空或缺少 url/b64_json）",
        });
      }
    }
    return c.json({ ok: true, modality, endpoint: `${baseUrl}${endpoint}` });
  } catch (err) {
    clearTimeout(timeout);
    if (isAbortError(err)) {
      return c.json({ ok: false, error: `Connection timed out (${Math.round(probeTimeoutMs / 1000)}s)` });
    }
    return c.json({ ok: false, error: sanitizeError(errMsg(err)) });
  }
});
}