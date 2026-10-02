/** Cross-route helpers shared by the route-domain modules (audit P2-2 split).
 *  Auth-cookie / rate-limiter / client-IP / demo-guard helpers were extracted
 *  verbatim from index.ts so route domains don't import the server entry.
 *  blockDemo closes over `db` and is passed via RouteContext. */
import { getConnInfo } from "@hono/node-server/conninfo";
import { RateLimiter } from "../rate-limit.js";
import { REMEMBER_MAX_AGE_SEC } from "../auth.js";
import { DEMO_QUOTA, type DemoFeature } from "../demo.js";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function isSafeRedirectUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

/**
 * Secure-cookie policy: the SECURE_COOKIES env var overrides; without it,
 * production builds enable Secure (they are expected to run behind TLS) while
 * everything else keeps it off so local HTTP development keeps working.
 * Loopback hosts are exempt even when enabled, since browsers accept Secure
 * cookies on http://localhost but many other clients (curl, Playwright) do not.
 */

export function secureCookiesEnabled(host?: string): boolean {
  const v = process.env.SECURE_COOKIES;
  const enabled =
    v !== undefined
      ? v === "1" || v.toLowerCase() === "true"
      : process.env.NODE_ENV === "production";
  if (!enabled) return false;
  const h = (host ?? "").toLowerCase();
  return !(
    h === "localhost" ||
    h.startsWith("localhost:") ||
    h === "127.0.0.1" ||
    h.startsWith("127.0.0.1:") ||
    h === "[::1]" ||
    h.startsWith("[::1]:")
  );
}


export const AUTH_COOKIE = "auth_token";


export function setAuthCookie(c: any, token: string, remember: boolean) {
  // Without Max-Age the browser treats it as a session cookie (dropped on close).
  const maxAge = remember ? `; Max-Age=${REMEMBER_MAX_AGE_SEC}` : "";
  const secure = secureCookiesEnabled(c.req.header("host")) ? "; Secure" : "";
  c.header("set-cookie", `${AUTH_COOKIE}=${token}; HttpOnly; Path=/${maxAge}${secure}; SameSite=Lax`);
}


export function clearAuthCookie(c: any) {
  const secure = secureCookiesEnabled(c.req.header("host")) ? "; Secure" : "";
  c.header("set-cookie", `${AUTH_COOKIE}=; HttpOnly; Path=/; Max-Age=0${secure}; SameSite=Lax`);
}

/** Direct peer address, or undefined when no real socket (in-process tests). */

export function peerIp(c: any): string | undefined {
  try {
    return getConnInfo(c)?.remote?.address;
  } catch {
    return undefined;
  }
}


export function isLoopback(addr: string | undefined): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

/**
 * Client IP for the audit trail. Only trusts X-Forwarded-For when it arrives
 * from a trusted proxy (L6): loopback (nginx co-hosted) or an explicit
 * `TRUSTED_PROXY_IPS` entry. A direct client's XFF is ignored so it cannot
 * spoof the audit IP.
 */

export function clientIp(c: any): string | undefined {
  const peer = peerIp(c);
  const fwd = c.req.header("x-forwarded-for");
  if (!fwd) return peer;
  const trusted = (process.env.TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (isLoopback(peer) || trusted.includes(peer ?? "")) {
    return fwd.split(",")[0]!.trim();
  }
  return peer;
}

// 全局限流（production-ops §6.2）：堵登录爆破 / 注册滥用 / API 滥用。参数为
// 保守默认值（防爆破不误伤正常使用）。key 维度：登录/注册按 IP，run 按用户。
export const LOGIN_RATE_LIMIT = 10; // 每 IP 每 15 分钟
export const LOGIN_RATE_WINDOW_MS = 15 * 60_000;
export const REGISTER_RATE_LIMIT = 30; // 每 IP 每小时（宽松：防批量注册，不误伤正常注册/测试造用户）
export const REGISTER_RATE_WINDOW_MS = 60 * 60_000;
export const RUN_RATE_LIMIT = 30; // 每用户每分钟
export const RUN_RATE_WINDOW_MS = 60_000;

export const loginLimiter = new RateLimiter(LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
export const registerLimiter = new RateLimiter(REGISTER_RATE_LIMIT, REGISTER_RATE_WINDOW_MS);
export const runLimiter = new RateLimiter(RUN_RATE_LIMIT, RUN_RATE_WINDOW_MS);
// Demo (try-before-signup) provisioning is tighter than register: each call
// creates a real account, so cap per IP per hour (design-demo-user §6.1).
// Overridable via DEMO_RATE_LIMIT for ops/tests; default 10/hour.
export const DEMO_RATE_LIMIT = (() => {
  const n = Number(process.env.DEMO_RATE_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 10;
})();
export const DEMO_RATE_WINDOW_MS = 60 * 60_000;
export const demoLimiter = new RateLimiter(DEMO_RATE_LIMIT, DEMO_RATE_WINDOW_MS);
// Seed every fresh demo with the simplest text-only pipeline so the canvas is
// not empty on first load. Chosen from TEMPLATES: source→textGen→…→sink, no
// image/video/audio nodes (those are blocked for demos).
export const DEMO_SEED_TEMPLATE_IDS = ["tpl-draft"] as const;

/** Demo mode is OFF by default; operators opt in with ALLOW_DEMO=1. */

export function demoEnabled(): boolean {
  const flag = (process.env.ALLOW_DEMO ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true";
}

/** Public demo-quota shape returned to the web client (numbers, no internals). */
export function demoPublicQuota() {
  return {
    tokens: DEMO_QUOTA.tokens,
    maxRunsTotal: DEMO_QUOTA.maxRunsTotal,
    concurrentRuns: DEMO_QUOTA.concurrentRuns,
    storageBytes: DEMO_QUOTA.storageBytes,
    videoSegments: DEMO_QUOTA.videoSegments,
  };
}

/** 403 for a capability a demo account may not use. The web opens the claim dialog. */

export function demoLocked(c: any, feature: DemoFeature) {
  return c.json(
    { error: "demo_forbidden", code: "DEMO_LOCKED", feature, claimUrl: "/login?claim=1" },
    403,
  );
}


export function rateLimitIp(c: any): string {
  return clientIp(c) ?? "unknown";
}

/** Shared by self-signup and owner provisioning — an address that passes one
 *  had better pass the other, or an invited account can't log in. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
