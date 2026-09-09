#!/usr/bin/env node
import { AgentWorldClient } from "./client.js";
import { loadConfig } from "./config.js";
import { startHttpServer } from "./http.js";
import { handleMessage } from "./server.js";
import { filterTools } from "./tools.js";

/**
 * agent-world MCP server.
 *
 * Transports (env `AGENT_WORLD_MCP_TRANSPORT`, default `stdio`):
 *   - stdio (default): run by an MCP client (Claude Desktop / Cursor / …) as a
 *     subprocess. Point it at a running agent-world server with env vars:
 *       AGENT_WORLD_URL=http://localhost:8791  AGENT_WORLD_TOKEN=<jwt>
 *   - http: standalone Streamable HTTP server on 127.0.0.1:3100
 *     (override with AGENT_WORLD_MCP_PORT). POST /mcp for JSON-RPC,
 *     GET /mcp for server-sent events.
 */

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new AgentWorldClient(config);
  const tools = filterTools(config.readonly);
  const transport = (process.env.AGENT_WORLD_MCP_TRANSPORT ?? "stdio").toLowerCase();
  const forceHttp = process.argv.includes("--http");

  if (transport === "http" || forceHttp) {
    const server = await startHttpServer(client, config.mcpHttpPort, tools, undefined, config.allowedOrigins);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : config.mcpHttpPort;
    console.error(`agent-world MCP server (HTTP) listening on http://127.0.0.1:${port}/mcp`);
    return;
  }

  // ---- stdio transport ----
  // MCP stdio framing: messages are newline-delimited JSON — one JSON-RPC
  // message per line, no embedded newlines. (The LSP-style Content-Length
  // framing used earlier is NOT what Claude Desktop / official MCP SDK
  // clients speak, so the server never actually connected end-to-end.)
  let buffer = "";

  // L16: the client may close its stdout while we still have frames to send —
  // swallow EPIPE so it doesn't crash the process.
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(0);
  });

  function send(msg: unknown): void {
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  }

  async function onData(chunk: string): Promise<void> {
    buffer += chunk;
    for (;;) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) return;
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      const reply = await handleMessage(msg as never, client, tools);
      if (reply) send(reply);
    }
  }

  process.stdin.setEncoding("utf8");
  // L15: serialize async message handling so concurrent chunks can't race on
  // the shared `buffer`.
  let pending = Promise.resolve();
  process.stdin.on("data", (chunk: string) => {
    pending = pending.then(() => onData(chunk));
  });
  process.stdin.on("error", () => process.exit(1));
  process.stdin.resume();
}

void main();
