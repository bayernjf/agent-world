import http from "node:http";
import type { AgentWorldClient } from "./client.js";
import { NotificationsHub } from "./notifications.js";
import { LATEST_PROTOCOL_VERSION, declaredVersion, type SubscriptionType } from "./protocol.js";
import { handleMessage, type JsonRpcMessage } from "./server.js";
import { TOOLS, type McpToolDef } from "./tools.js";

/**
 * Streamable HTTP transport for the MCP server (zero dependencies, Node http).
 *
 * Endpoints:
 *   - `POST /mcp`   single JSON-RPC message. If the client sends
 *                   `Accept: text/event-stream`, the reply is streamed back as
 *                   SSE (`event: message`); otherwise it is plain JSON.
 *                   `subscriptions/listen` (2026-07-28) keeps its own response
 *                   open as the server→client notification stream.
 *   - `GET /mcp`    SSE stream for server-initiated events. The first event
 *                   (`event: endpoint`) tells the client where to POST.
 *                   Removed in 2026-07-28; kept for older clients.
 *
 * Authentication: optional `Authorization: Bearer <token>` (or `?token=` query)
 * is passed through to the agent-world REST API by AgentWorldClient; this layer
 * stays transport-only.
 */

export const MCP_HTTP_PATH = "/mcp";

/**
 * Echo the revision the caller declared. `MCP-Protocol-Version` became a
 * required response header in 2025-06-18, and pinning it to one revision (as
 * this transport used to) tells a newer client the wrong thing.
 */
function replyVersion(req: http.IncomingMessage, msg?: JsonRpcMessage): string {
  const declared = msg ? declaredVersion(msg) : null;
  const header = req.headers["mcp-protocol-version"];
  return declared ?? (typeof header === "string" ? header : LATEST_PROTOCOL_VERSION);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, version: string = LATEST_PROTOCOL_VERSION): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "mcp-protocol-version": version,
  });
  res.end(json);
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY_BYTES = 5 * 1024 * 1024; // M16: cap streaming bodies (DoS)
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
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

export function createMcpHttpHandler(
  client: AgentWorldClient,
  tools: McpToolDef[] = TOOLS,
  hub: NotificationsHub = new NotificationsHub(),
) {
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
        "mcp-protocol-version": replyVersion(req),
      });
      res.write(sseFrame("endpoint", { url: MCP_HTTP_PATH }));
      // Register this stream as a push sink, then keep it alive until the
      // client disconnects (which unregisters it inside NotificationsHub).
      hub.addSink(res);
      const keepAlive = setInterval(() => {
        if (!res.writableEnded) res.write(": keep-alive\n\n");
      }, 15_000);
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
    // H6: honor the caller's own credentials. The env token is the fallback;
    // a client-supplied `Authorization: Bearer` (or `?token=`) is forwarded to
    // the agent-world API instead, so a localhost caller can't ride the env
    // token to perform write operations it wasn't given access to.
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const reqToken = (bearer ?? url.searchParams.get("token") ?? "").trim();
    const effectiveClient = reqToken ? client.withToken(reqToken) : client;
    // Notifications (no id) → 202 Accepted, no body.
    const rpc = msg as JsonRpcMessage;
    const version = replyVersion(req, rpc);
    if (rpc.id === undefined || rpc.id === null) {
      res.writeHead(202, { "mcp-protocol-version": version });
      res.end();
      return;
    }

    const reply = await handleMessage(rpc, effectiveClient, tools, hub);

    // 2026-07-28: subscriptions/listen turns its own response into the
    // long-lived notification stream — ack first, then hold the socket open.
    if (rpc.method === "subscriptions/listen" && reply?.result) {
      const result = reply.result as { subscriptionId: string; types: SubscriptionType[]; uri?: string };
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "mcp-protocol-version": version,
      });
      res.write(sseFrame("message", reply));
      hub.addSubscriptionSink(res, result.types, result.subscriptionId);
      const keepAlive = setInterval(() => {
        if (!res.writableEnded) res.write(": keep-alive\n\n");
      }, 15_000);
      req.on("close", () => clearInterval(keepAlive));
      // Only now start the upstream bridge — the sink above must exist first.
      if (result.uri) await hub.subscribe(result.uri, effectiveClient);
      return;
    }

    if (wantsSse) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "mcp-protocol-version": version,
      });
      res.end(sseFrame("message", reply));
    } else {
      sendJson(res, 200, reply, version);
    }
  };
}

/** Start the HTTP transport on the given port (0 → ephemeral). */
export function startHttpServer(
  client: AgentWorldClient,
  port = Number(process.env.AGENT_WORLD_MCP_PORT ?? 3100),
  tools: McpToolDef[] = TOOLS,
  hub: NotificationsHub = new NotificationsHub(),
): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    void createMcpHttpHandler(client, tools, hub)(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
