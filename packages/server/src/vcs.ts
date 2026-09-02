import type { VcsConfig } from "@agent-world/core";
import { withRetry } from "./retry.js";
import { GuardedFetchError, guardedFetch } from "./ssrf.js";

/**
 * Version-control actions for the `vcs` node: GitHub and GitLab REST adapters
 * for the four actions that cover the bulk of automation needs — create PR/MR,
 * comment on an issue/PR, trigger a workflow/pipeline, list issues.
 *
 * Credentials resolve **node first, env as fallback**: `vcs.token` over
 * GITHUB_TOKEN / GITLAB_TOKEN, `vcs.baseUrl` over GITLAB_API_URL. A token typed
 * into the Inspector works on the next run without restarting the server, and
 * two graphs can act under two accounts; a node token is encrypted before it
 * reaches disk (see at-rest.ts). Missing in both places throws VcsAuthError
 * before any request goes out.
 *
 * Non-retryable errors (matching the notify node's split):
 * - VcsAuthError: missing/invalid token, 401/403 (→ AUTH)
 * - VcsProviderError: the API rejected the action, e.g. 422 PR-already-exists
 *   or branch-not-found (→ PROVIDER_ERROR)
 * Transient faults (network reject, 5xx) are retried per `cfg.retry`.
 *
 * All requests go through guardedFetch (dogfood tpl-release-pr): the bare
 * global fetch bypassed the outbound proxy (AGENT_WORLD_PROXY) and the SSRF
 * boundary every other outbound node honors, so on proxy-only networks every
 * provider call died with ECONNREFUSED while http/notify nodes worked fine.
 * That guard is also what makes a node-controlled `baseUrl` acceptable — a
 * self-hosted GitLab host is validated like any other outbound target.
 */

export interface VcsResult {
  provider: string;
  action: string;
  /** Human-readable handle (PR #42, issue #7, workflow name, N issues). */
  detail: string;
  /** Raw API response payload, surfaced as the node's json artifact. */
  data: unknown;
}

export class VcsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VcsAuthError";
  }
}

export class VcsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VcsProviderError";
  }
}

function requireProviderFields(provider: string, cfg: VcsConfig, fields: (keyof VcsConfig)[]): void {
  const missing = fields.filter((f) => !cfg[f]);
  if (missing.length) {
    throw new VcsAuthError(`${provider} ${cfg.action} 缺少必填字段：${missing.join(", ")}`);
  }
}

/** Node value wins; the env var is the deployment-wide fallback. */
function resolveCredential(nodeValue: string | undefined, envName: string, field: string): string {
  const fromNode = nodeValue?.trim();
  if (fromNode) return fromNode;
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  throw new VcsAuthError(
    `缺少访问凭证：节点的 ${field} 未填写，环境变量 ${envName} 也未配置（填在节点里无需重启 server）`,
  );
}

async function ghRequest(method: string, url: string, cfg: VcsConfig, body?: unknown): Promise<unknown> {
  const token = resolveCredential(cfg.token, "GITHUB_TOKEN", "token");
  const res = await guardedFetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body != null ? { "content-type": "application/json" } : {}),
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  return readJson(res, "github", cfg, method, url);
}

async function glRequest(method: string, path: string, cfg: VcsConfig, body?: unknown): Promise<unknown> {
  const token = resolveCredential(cfg.token, "GITLAB_TOKEN", "token");
  const base =
    cfg.baseUrl?.trim() || process.env.GITLAB_API_URL || "https://gitlab.com/api/v4";
  const url = `${base}${path}`;
  const res = await guardedFetch(url, {
    method,
    headers: {
      "private-token": token,
      ...(body != null ? { "content-type": "application/json" } : {}),
    },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  return readJson(res, "gitlab", cfg, method, url);
}

async function readJson(
  res: Response,
  provider: string,
  cfg: VcsConfig,
  method: string,
  url: string,
): Promise<unknown> {
  if (res.status === 401 || res.status === 403) {
    throw new VcsAuthError(`${provider} 鉴权失败（${res.status}），请检查 token 权限`);
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (!res.ok) {
    const apiMsg = (json as {
      message?: string;
      error?: string;
      errors?: Array<{ message?: string; code?: string }>;
    } | string | null);
    let msg: string;
    if (typeof apiMsg === "string") {
      msg = apiMsg;
    } else {
      msg = apiMsg?.message ?? apiMsg?.error ?? `HTTP ${res.status}`;
      // GitHub 422 bodies carry the actionable reason in errors[] (e.g. "A
      // pull request already exists for …") — without it the node failure
      // only said "Validation Failed" (dogfood tpl-release-pr recheck).
      const details = (apiMsg?.errors ?? [])
        .map((e) => e.message ?? e.code)
        .filter((d): d is string => Boolean(d));
      if (details.length) msg += `（${details.join("; ")}）`;
    }
    throw new VcsProviderError(`${provider} ${cfg.action} 失败（${method} ${url}）: ${msg}`);
  }
  return json;
}

async function githubAction(cfg: VcsConfig, body: string, title: string): Promise<VcsResult> {
  // Audit L5: encode every user-supplied path segment so values cannot smuggle
  // extra path/query components into the GitHub URL.
  const owner = encodeURIComponent(cfg.owner!);
  const repo = encodeURIComponent(cfg.repo!);
  const api = (p: string) => `https://api.github.com/repos/${owner}/${repo}${p}`;
  switch (cfg.action) {
    case "create_pr": {
      requireProviderFields("github", cfg, ["owner", "repo", "head", "base"]);
      const data = (await ghRequest("POST", api("/pulls"), cfg, {
        title,
        head: cfg.head,
        base: cfg.base,
        body: body || undefined,
      })) as { number: number; html_url: string };
      return { provider: "github", action: "create_pr", detail: `PR #${data.number}`, data };
    }
    case "comment_issue": {
      requireProviderFields("github", cfg, ["owner", "repo", "number"]);
      const data = await ghRequest("POST", api(`/issues/${cfg.number}/comments`), cfg, { body });
      return { provider: "github", action: "comment_issue", detail: `issue #${cfg.number}`, data };
    }
    case "trigger_workflow": {
      requireProviderFields("github", cfg, ["owner", "repo", "workflowId", "ref"]);
      // GitHub returns 204 No Content on success.
      await ghRequest("POST", api(`/actions/workflows/${encodeURIComponent(cfg.workflowId!)}/dispatches`), cfg, {
        ref: cfg.ref,
        inputs: cfg.inputs ?? {},
      });
      return { provider: "github", action: "trigger_workflow", detail: `${cfg.workflowId} @ ${cfg.ref}`, data: { dispatched: true } };
    }
    case "list_issues": {
      requireProviderFields("github", cfg, ["owner", "repo"]);
      const state = encodeURIComponent(cfg.state ?? "open");
      const data = (await ghRequest("GET", `${api("/issues")}?state=${state}&per_page=30`, cfg)) as Array<{ number: number; title: string }>;
      return { provider: "github", action: "list_issues", detail: `${data.length} issues`, data };
    }
  }
}

async function gitlabAction(cfg: VcsConfig, body: string, title: string): Promise<VcsResult> {
  const pid = encodeURIComponent(cfg.projectId!);
  switch (cfg.action) {
    case "create_pr": {
      requireProviderFields("gitlab", cfg, ["projectId", "head", "base"]);
      const data = (await glRequest("POST", `/projects/${pid}/merge_requests`, cfg, {
        title,
        source_branch: cfg.head,
        target_branch: cfg.base,
        description: body || undefined,
      })) as { iid: number; web_url: string };
      return { provider: "gitlab", action: "create_pr", detail: `MR !${data.iid}`, data };
    }
    case "comment_issue": {
      requireProviderFields("gitlab", cfg, ["projectId", "number"]);
      const data = await glRequest("POST", `/projects/${pid}/issues/${cfg.number}/notes`, cfg, { body });
      return { provider: "gitlab", action: "comment_issue", detail: `issue #${cfg.number}`, data };
    }
    case "trigger_workflow": {
      requireProviderFields("gitlab", cfg, ["projectId", "ref"]);
      const data = await glRequest("POST", `/projects/${pid}/pipeline`, cfg, {
        ref: cfg.ref,
        variables: cfg.inputs ?? {},
      });
      return { provider: "gitlab", action: "trigger_workflow", detail: `pipeline @ ${cfg.ref}`, data };
    }
    case "list_issues": {
      requireProviderFields("gitlab", cfg, ["projectId"]);
      const state = cfg.state ?? "opened";
      const data = (await glRequest("GET", `/projects/${pid}/issues?state=${state}&per_page=30`, cfg)) as Array<{ iid: number; title: string }>;
      return { provider: "gitlab", action: "list_issues", detail: `${data.length} issues`, data };
    }
  }
}

/** Execute a VCS action, retrying transient faults. Throws VcsAuthError / VcsProviderError. */
export async function executeVcs(cfg: VcsConfig, body: string, title: string): Promise<VcsResult> {
  return withRetry(
    () => (cfg.provider === "gitlab" ? gitlabAction(cfg, body, title) : githubAction(cfg, body, title)),
    cfg.retry,
    // GuardedFetchError is a deterministic guard refusal (internal target,
    // bad URL/redirect) — retrying can never change the outcome.
    (err) => !(err instanceof VcsAuthError || err instanceof VcsProviderError || err instanceof GuardedFetchError),
  );
}
