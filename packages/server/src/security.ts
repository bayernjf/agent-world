import { Hono } from "hono";
import { cors } from "hono/cors";

/**
 * Resolve the CORS `origin` option from the `CORS_ORIGINS` env var.
 *
 * - unset      → `undefined`, which Hono treats as allow-all (`*`). Convenient
 *                for local dev, but any shared/staging/prod deployment should set
 *                an explicit allowlist.
 * - "*"        → allow every origin.
 * - "a,b,c"    → explicit allowlist; Hono echoes the request `Origin` only when
 *                it is present in the list, otherwise sends no ACAO header.
 */
export function resolveCorsOrigins(env?: string): string | string[] | undefined {
  if (!env) return undefined;
  const trimmed = env.trim();
  if (trimmed === "" || trimmed === "*") return "*";
  const list = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 1 ? list[0] : list;
}

/** Basic hardening headers applied to every response. */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

/** Attach CORS middleware configured from `CORS_ORIGINS`. */
export function applyCors(app: Hono, originsEnv?: string): void {
  const origins = resolveCorsOrigins(originsEnv);
  // When unset, pass no option so Hono keeps its allow-all (`*`) default — the
  // right convenience for local dev. An explicit value (string or list) is
  // forwarded to restrict origins in shared deployments.
  app.use("/*", cors(origins === undefined ? {} : { origin: origins }));
}

/** Attach a middleware that sets the basic security response headers. */
export function applySecurityHeaders(app: Hono): void {
  app.use("/*", async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      c.header(k, v);
    }
  });
}
