/**
 * Configuration for the MCP server process. Everything comes from environment
 * variables injected by the MCP client (e.g. Claude Desktop's config):
 *
 * - `AGENT_WORLD_URL`    base URL of the main agent-world server (default http://localhost:8791)
 * - `AGENT_WORLD_TOKEN`  auth JWT sent as `?token=` on every request (needed
 *                        once the main server is secured)
 */
export interface McpServerConfig {
  url: string;
  token: string;
  requestTimeoutMs: number;
  mcpHttpPort: number;
  /** Readonly mode: only read-only tools are exposed (`AGENT_WORLD_MCP_READONLY=1`). */
  readonly: boolean;
}

/** Parse a positive integer with a default; invalid input falls back (M15). */
function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  return {
    url: (env.AGENT_WORLD_URL ?? "http://localhost:8791").replace(/\/+$/, ""),
    token: env.AGENT_WORLD_TOKEN ?? "",
    requestTimeoutMs: positiveInt(env.AGENT_WORLD_REQUEST_TIMEOUT_MS, 120_000),
    mcpHttpPort: positiveInt(env.AGENT_WORLD_MCP_PORT, 3100),
    readonly: env.AGENT_WORLD_MCP_READONLY === "1" || env.AGENT_WORLD_MCP_READONLY === "true",
  };
}
