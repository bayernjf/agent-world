#!/usr/bin/env node
import { AgentWorldClient } from "./client.js";
import { loadConfig } from "./config.js";
import { handleMessage } from "./server.js";

/**
 * agent-world MCP server (stdio transport).
 *
 * Run by an MCP client (Claude Desktop / Cursor / etc.) as a subprocess:
 *   "mcpServers": { "agent-world": { "command": "npx", "args": ["-y", "@agent-world/mcp-server"] } }
 * and point it at a running agent-world server with env vars:
 *   AGENT_WORLD_URL=http://localhost:8791  AGENT_WORLD_TOKEN=<jwt>
 */

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

const config = loadConfig();
const client = new AgentWorldClient(config);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  void onData(chunk);
});
process.stdin.on("error", () => process.exit(1));
process.stdin.resume();
