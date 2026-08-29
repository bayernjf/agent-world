import http from "node:http";
import type { AgentWorldClient } from "./client.js";
import { handleMessage, type JsonRpcMessage } from "./server.js";
import { TOOLS, type McpToolDef } from "./tools.js";

/**
 * Streamable HTTP transport for the MCP server (zero dependencies, Node http).
 *
 * Endpoints:
 *   - `POST /mcp`   single JSON-RPC message. If the client sends
 *                   `Accept: text/event-stream`, the reply is streamed back as
 *                   SSE (`event: message`); otherwise it is plain JSON.
 *   - `GET /mcp`    SSE stream for server-initiated events. The first event
 *                   (`event: endpoint`) tells the client where to POST.
 *
 * Authentication: optional `Authorization: Bearer <token>` (or `?token=` query)
 * is passed through to the agent-world REST API by AgentWorldClient; this layer
 * stays transport-only.
 */

export const MCP_HTTP_PATH = "/mcp";

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "mcp-protocol-version": "2024-11-05",
  });
  res.end(json);
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createMcpHttpHandler(client: AgentWorldClient, tools: McpToolDef[] = TOOLS) {
  return async function mcpHttpHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== MCP_HTTP_PATH) {
      sendJson(res, 404, { error: `not found: ${url.pathname}` });
      return;
    }

    // GET → SSE stream for server push; announce the POST endpoint first.
    if (req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "mcp-protocol-version": "2024-11-05",
      });
      res.write(sseFrame("endpoint", { url: MCP_HTTP_PATH }));
      // Keep the connection alive; drop it when the client goes away.
      const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
      req.on("close", () => clearInterval(keepAlive));
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: `method not allowed: ${req.method}` });
      return;
    }

    let msg: unknown;
    try {
      msg = await parseBody(req);
    } catch {
      sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    if (msg === null) {
      sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    const wantsSse = (req.headers.accept ?? "").includes("text/event-stream");
    // Notifications (no id) → 202 Accepted, no body.
    const rpc = msg as JsonRpcMessage;
    if (rpc.id === undefined || rpc.id === null) {
      res.writeHead(202, { "mcp-protocol-version": "2024-11-05" });
      res.end();
      return;
    }

    const reply = await handleMessage(rpc, client, tools);

    if (wantsSse) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "mcp-protocol-version": "2024-11-05",
      });
      res.end(sseFrame("message", reply));
    } else {
      sendJson(res, 200, reply);
    }
  };
}

/** Start the HTTP transport on the given port (0 → ephemeral). */
export function startHttpServer(
  client: AgentWorldClient,
  port = Number(process.env.AGENT_WORLD_MCP_PORT ?? 3100),
  tools: McpToolDef[] = TOOLS,
): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    void createMcpHttpHandler(client, tools)(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
