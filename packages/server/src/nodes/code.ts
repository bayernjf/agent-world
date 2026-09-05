import { CodeNodeConfig } from "@agent-world/core";
import type { Artifact, GraphNode } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { zeroUsage } from "./shared.js";
import { cleanupCodeWorkdir, createCodeWorkdir, resolveSandbox } from "../code-sandbox.js";
import type { CodeSandboxLimits } from "../code-sandbox.js";
import { loadPermissionConfig } from "../permissions.js";
import { childProxyEnv, getCodeProxyUrl, registerNetToken, unregisterNetToken } from "../code-proxy.js";
import { trimEnv } from "../isolation.js";
import { withRetry } from "../retry.js";
import { spawn } from "node:child_process";
import { sanitizeError } from "../sanitize.js";

/**
 * Code node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function codeNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, nodeCtx, opts, runId, sendPackets, states } = ctx;
  emit({ type: "node.started", nodeId, attempt });
  const cfg = CodeNodeConfig.parse(node.code ?? {});
  if (!cfg.code.trim()) {
    states.set(nodeId, "failed");
    ctx.status = "failed";
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: "代码节点脚本为空",
      errorCode: "VALIDATION",
    });
    return;
  }
  // net 策略：none = 不注入任何出口（子进程环境里没有代理变量）；
  // allowlist = rlimit/noop 后端下经本地 SSRF 校验代理放行 TOOL_NETWORK_ALLOW
  // 白名单（协作式：约束走 HTTP(S)_PROXY 的客户端，裸 socket 可绕过，
  // 见 design-code-sandbox.md §10）。bwrap / sandbox-exec 后端硬断网
  //（unshare-net / deny network*），代理不可达——诚实拒绝，绝不静默降级。
  let netToken: string | undefined;
  let netProxyEnv: Record<string, string> = {};
  if (cfg.net === "allowlist") {
    const backendName = resolveSandbox().name;
    if (backendName === "bwrap" || backendName === "sandbox-exec") {
      states.set(nodeId, "failed");
      ctx.status = "failed";
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `代码节点 net: "allowlist" 需要校验代理，但 ${backendName} 后端是硬断网（仅支持 net: "none"）`,
        errorCode: "VALIDATION",
      });
      return;
    }
    const netAllow = loadPermissionConfig().networkAllow;
    if (!netAllow || netAllow.length === 0) {
      states.set(nodeId, "failed");
      ctx.status = "failed";
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: '代码节点 net: "allowlist" 需要服务端配置 TOOL_NETWORK_ALLOW（逗号分隔的域名白名单）',
        errorCode: "VALIDATION",
      });
      return;
    }
    const proxyUrl = await getCodeProxyUrl();
    // Only 80/443 are reachable by default (audit L4: don't let code use
    // the proxy as an arbitrary-port jump host). TOOL_NETWORK_EXTRA_PORTS
    // is a comma-separated opt-in for non-standard ports (also the test
    // hook for loopback fixtures on ephemeral ports).
    const extraPorts = (process.env.TOOL_NETWORK_EXTRA_PORTS ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535);
    netToken = registerNetToken({ runId, nodeId, allowlist: netAllow, extraConnectPorts: extraPorts });
    netProxyEnv = childProxyEnv(netToken, proxyUrl);
  }
  // fs 策略：allowlist = 在 workdir 之外额外授予只读访问
  // （TOOL_FS_ALLOW 前缀）。写入仍然仅限 workdir。
  const extraFsReadPaths =
    cfg.fs === "allowlist" ? (loadPermissionConfig().fsAllow ?? []) : [];
  // P0 sandbox: isolate cwd (per-run temp dir) + env allowlist + absolute
  // interpreter path. The temp dir is removed even on failure/timeout.
  const workdir = await createCodeWorkdir(runId, nodeId, attempt);
  try {
    // Local stdin context (renamed from `ctx`, which now names the NodeRunContext).
    const stdinCtx = nodeCtx(nodeId);
    const inputJson = JSON.stringify({ inputs: stdinCtx });
    // 代理 env 由 sandbox 注入（含 token），不走 trimEnv 的声明白名单
    const childEnv = { ...trimEnv(cfg.env), ...netProxyEnv };
    // P1+P2 sandbox: backend selected via CODE_SANDBOX (rlimit default;
    // bwrap / sandbox-exec / noop opt-in with loud degrade warnings).
    const cfgLimits = (cfg as unknown as { limits?: CodeSandboxLimits }).limits;
    const plan = resolveSandbox().planSpawn({
      language: cfg.language,
      code: cfg.code,
      workdir,
      limits: cfgLimits,
      extraFsReadPaths,
    });
    const spawnStartedAt = Date.now();
    const { stdout, stderr, killed, code } = await withRetry(
      async () => {
        const child = spawn(plan.command, plan.args, {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: workdir,
          env: childEnv,
        });
        // If the interpreter dies before draining stdin (syntax error,
        // early exit), feeding it the input emits 'error' (EPIPE) on the
        // stream; with no listener that error event is unhandled and kills
        // the whole engine process (dogfood tpl-doc-ingest: a broken code
        // node took down the server). The failure is already reported via
        // the child's exit code + stderr, so swallow the pipe error here.
        child.stdin.on("error", () => {});
        child.stdin.end(inputJson);
        let stdout = "";
        let stderr = "";
        let killed = false;
        const cap = 1_000_000;
        child.stdout.on("data", (chunk: Buffer) => {
          if (stdout.length < cap) stdout += chunk.toString().slice(0, cap - stdout.length);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          if (stderr.length < cap) stderr += chunk.toString().slice(0, cap - stderr.length);
        });
        const r = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
          const timer = setTimeout(() => {
            killed = true;
            child.kill("SIGKILL");
            resolve({ code: null, signal: "timeout" });
          }, cfg.timeoutMs);
          child.on("error", (err) => {
            clearTimeout(timer);
            resolve({ code: -1, signal: err.message });
          });
          child.on("close", (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal });
          });
        });
        // Spawn failure (binary missing, etc.) → throw so withRetry can retry.
        // Non-zero exit and timeout are business errors, returned as-is.
        if (r.code === -1) throw new Error(`代码节点子进程启动失败: ${r.signal}`);
        return { stdout, stderr, killed, code: r.code };
      },
      cfg.retry,
      () => true,
      opts.sleep,
    );
    // 取证：单个 code 节点耗时超过 5 秒，几乎总是 CI 机器饥饿（2-vCPU
    // runner + 冷页缓存），而不是回归——2026-09-01 PR #98 就是在这一小段上
    // 把 vitest 的测试预算耗光的。打出来，让下一次红 CI 自己给出答案。
    const spawnWallMs = Date.now() - spawnStartedAt;
    if (spawnWallMs > 5000) {
      ctx.log.warn("code subprocess wall-clock slow", { nodeId, spawnWallMs });
    }
    if (killed) {
      states.set(nodeId, "failed");
      ctx.status = "failed";
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `代码执行超时（${cfg.timeoutMs}ms）${stderr.slice(0, 200)}`,
        errorCode: "TIMEOUT",
      });
      return;
    }
    if (code !== 0) {
      states.set(nodeId, "failed");
      ctx.status = "failed";
      emit({
        type: "node.failed",
        nodeId,
        attempt,
        error: `代码执行失败（退出码 ${code}）: ${(stderr || "无 stderr 输出").slice(0, 300)}`,
        errorCode: "SCRIPT_ERROR",
      });
      return;
    }
    const raw = stdout.trim();
    let output = raw;
    let asJson = false;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed !== null && typeof parsed === "object") asJson = true;
      } catch {
        // plain text output
      }
    }
    if (asJson) output = JSON.stringify(JSON.parse(raw), null, 2);
    const artifact: Artifact = asJson
      ? { id: `${nodeId}-code-json`, kind: "json", content: output, mimeType: "application/json" }
      : { id: `${nodeId}-code-text`, kind: "text", content: output, mimeType: "text/plain" };
    artifacts.set(nodeId, [artifact]);
    emit({ type: "artifact.produced", nodeId, attempt, artifact });
    states.set(nodeId, "done");
    emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
    sendPackets(nodeId, output.slice(0, 120), artifact.kind);
    return;
  } catch (err) {
    // 子进程根本起不来（解释器缺失、fork 被 EAGAIN 拒绝…）时 withRetry 会
    // 重试后抛错。必须落成诚实的 node.failed：裸抛会让节点停在 "ctx.running"，
    // 事件流里既没有 ctx.finished 也没有 failed，只留下一个查不出原因的缺失。
    states.set(nodeId, "failed");
    ctx.status = "failed";
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: `代码节点无法执行: ${sanitizeError(err instanceof Error ? err.message : String(err))}`,
      errorCode: "SUBPROCESS",
    });
    return;
  } finally {
    if (netToken) unregisterNetToken(netToken);
    await cleanupCodeWorkdir(workdir);
  }
}
