import { HttpNodeConfig, evaluateTemplate } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { fileLabelFromUrl, zeroUsage } from "./shared.js";
import { allowPrivateNetwork, guardedFetch, hostIsInternal } from "../ssrf.js";
import { withRetry } from "../retry.js";

/**
 * Http node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function httpNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, httpMeta, interpCtx, opts, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const cfg: HttpNodeConfig = HttpNodeConfig.parse(node.http ?? {});

  // Local interpolation context (renamed from `ctx`, which now names the NodeRunContext).
  const interp = interpCtx(nodeId);
  const interpolatedUrl = evaluateTemplate(cfg.url, interp);
  if (!interpolatedUrl.trim()) {
    states.set(nodeId, "failed");
    ctx.status = "failed";
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: "HTTP 节点 URL 为空",
      errorCode: "VALIDATION",
    });
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(interpolatedUrl);
  } catch {
    states.set(nodeId, "failed");
    ctx.status = "failed";
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `HTTP 节点 URL 不合法: ${interpolatedUrl}`,
      errorCode: "VALIDATION",
    });
    return;
  }

  for (const [key, raw] of Object.entries(cfg.query ?? {})) {
    try {
      targetUrl.searchParams.set(key, evaluateTemplate(raw, interp));
    } catch {
      // skip invalid params
    }
  }

  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(cfg.headers ?? {})) {
    headers[key] = evaluateTemplate(raw, interp);
  }
  const contentType = headers["content-type"] ?? headers["Content-Type"];
  const body = cfg.body ? evaluateTemplate(cfg.body, interp) : undefined;

  // SSRF guard: refuse private/internal targets (resolved at fetch time,
  // so DNS rebinding can't smuggle an internal address past the check).
  if (!allowPrivateNetwork() && (await hostIsInternal(targetUrl.hostname))) {
    states.set(nodeId, "failed");
    ctx.status = "failed";
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: "HTTP 节点拒绝访问内网或私网地址（SSRF 防护）",
      errorCode: "VALIDATION",
    });
    return;
  }

  let response: Response;
  try {
    response = await withRetry(
      async () => {
        // All outbound traffic leaves through guardedFetch: the DNS
        // answer that passes the internal check is the one the TCP/TLS
        // connection is pinned to (no check-vs-connect TOCTOU, audit
        // H3), and redirects are re-validated on every hop (audit C3).
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), cfg.timeoutMs);
        try {
          const r = await guardedFetch(targetUrl.toString(), {
            method: cfg.method,
            headers,
            body: body && cfg.method !== "GET" ? body : undefined,
            signal: abort.signal,
            maxRedirects: 5,
          });
          // 5xx triggers the retry path; deterministic guard rejections
          // (GuardedFetchError) are excluded from retry below.
          // failOnError: false means the caller wants the ctx.status as data
          // (health checks), so 5xx must complete the node, not retry.
          if (cfg.failOnError && r.status >= 500) throw new Error(`HTTP ${r.status}`);
          return r;
        } finally {
          clearTimeout(timer);
        }
      },
      cfg.retry,
      // AbortError means the attempt timed out; deterministic failures
      // (SSRF rejection, redirect budget exhausted) must not be retried.
      (err) =>
        !(err instanceof Error && err.name === "AbortError") &&
        !(err instanceof Error && /SSRF 防护|重定向超过/.test(err.message)),
      opts.sleep,
    );
  } catch (err) {
    states.set(nodeId, "failed");
    ctx.status = "failed";
    const msg = err instanceof Error ? err.message : String(err);
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `HTTP 请求失败: ${msg}`,
      errorCode: msg.includes("SSRF 防护") ? "VALIDATION" : "PROVIDER_ERROR",
    });
    return;
  }

  // Expose response metadata for branch / notify interpolation
  // (`${nodeId.ok}` etc.); the artifact below carries only the payload.
  httpMeta.set(nodeId, {
    ok: response.ok,
    status: response.status,
    url: targetUrl.toString(),
    method: cfg.method,
  });

  if (cfg.outputMode === "file") {
    let arrayBuf: ArrayBuffer;
    try {
      arrayBuf = await response.arrayBuffer();
    } catch (err) {
      states.set(nodeId, "failed");
      ctx.status = "failed";
      const msg = err instanceof Error ? err.message : String(err);
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `读取 HTTP 响应失败: ${msg}`,
        errorCode: "PROVIDER_ERROR",
      });
      return;
    }
    if (cfg.failOnError && (response.status < 200 || response.status >= 300)) {
      states.set(nodeId, "failed");
      ctx.status = "failed";
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `HTTP ${cfg.method} ${targetUrl.toString()} 返回 ${response.status}`,
        errorCode: "PROVIDER_ERROR",
      });
      return;
    }
    const bytes = Buffer.from(arrayBuf);
    const ctHeader = response.headers.get("content-type") ?? "";
    const mime = (ctHeader.split(";")[0] ?? "").trim() || "application/octet-stream";
    const fileName = fileLabelFromUrl(targetUrl);
    const uri = await opts.storeBinary(bytes, mime, fileName);
    const artifact: Artifact = {
      id: `${nodeId}-file`,
      kind: "file",
      uri,
      mimeType: mime,
      label: fileName,
      sizeBytes: bytes.length,
    };
    artifacts.set(nodeId, [artifact]);
    emit({ type: "artifact.produced", nodeId, attempt, artifact });
    states.set(nodeId, "done");
    const summary = `已下载文件：${fileName}（${bytes.length} 字节，${mime}）`;
    emit({ type: "node.finished", nodeId, attempt, output: summary, usage: zeroUsage() });
    sendPackets(nodeId, summary, "file");
    return;
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch (err) {
    states.set(nodeId, "failed");
    ctx.status = "failed";
    const msg = err instanceof Error ? err.message : String(err);
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `读取 HTTP 响应失败: ${msg}`,
      errorCode: "PROVIDER_ERROR",
    });
    return;
  }

  const contentTypeHeader = response.headers.get("content-type") ?? "";
  const isJsonByHeader = /application\/json|text\/json/i.test(contentTypeHeader);
  const canParseJson = (() => {
    try {
      JSON.parse(responseText);
      return true;
    } catch {
      return false;
    }
  })();
  const asJson = cfg.outputMode === "json" || (cfg.outputMode === "auto" && isJsonByHeader && canParseJson);

  if (cfg.failOnError && (response.status < 200 || response.status >= 300)) {
    states.set(nodeId, "failed");
    ctx.status = "failed";
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `HTTP ${cfg.method} ${targetUrl.toString()} 返回 ${response.status}: ${responseText.slice(0, 200)}`,
      errorCode: "PROVIDER_ERROR",
    });
    return;
  }

  const output = asJson ? JSON.stringify(JSON.parse(responseText), null, 2) : responseText;
  const artifact: Artifact = asJson
    ? { id: `${nodeId}-json`, kind: "json", content: output, mimeType: "application/json" }
    : { id: `${nodeId}-text`, kind: "text", content: output, mimeType: "text/plain" };
  artifacts.set(nodeId, [artifact]);
  emit({ type: "artifact.produced", nodeId, attempt, artifact });
  states.set(nodeId, "done");
  emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
  sendPackets(nodeId, output.slice(0, 120), artifact.kind);
}
