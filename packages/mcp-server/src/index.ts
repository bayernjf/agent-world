#!/usr/bin/env node
import { AgentWorldClient } from "./client.js";
import { loadConfig } from "./config.js";
import { startHttpServer } from "./http.js";
import { handleMessage } from "./server.js";

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
  const transport = (process.env.AGENT_WORLD_MCP_TRANSPORT ?? "stdio").toLowerCase();
  const forceHttp = process.argv.includes("--http");

  if (transport === "http" || forceHttp) {
    const server = await startHttpServer(client);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : config.mcpHttpPort;
    console.error(`agent-world MCP server (HTTP) listening on http://127.0.0.1:${port}/mcp`);
    return;
  }

  // ---- stdio transport ----
  let buffer = "";

  function send(msg: unknown): void {
    const json = JSON.stringify(msg);
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
  }

  async function onData(chunk: string): Promise<void> {
    buffer += chunk;
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd);
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const len = Number(m[1]);
      if (buffer.length < headerEnd + 4 + len) return; // wait for the full body
      const body = buffer.slice(headerEnd + 4, headerEnd + 4 + len);
      buffer = buffer.slice(headerEnd + 4 + len);
      let msg: unknown;
      try {
        msg = JSON.parse(body);
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      const reply = await handleMessage(msg as never, client);
      if (reply) send(reply);
    }
  }

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    void onData(chunk);
  });
  process.stdin.on("error", () => process.exit(1));
  process.stdin.resume();
}

void main();
