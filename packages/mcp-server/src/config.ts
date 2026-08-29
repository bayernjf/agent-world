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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  return {
    url: (env.AGENT_WORLD_URL ?? "http://localhost:8791").replace(/\/+$/, ""),
    token: env.AGENT_WORLD_TOKEN ?? "",
    requestTimeoutMs: Number(env.AGENT_WORLD_REQUEST_TIMEOUT_MS ?? 120_000),
  };
}
