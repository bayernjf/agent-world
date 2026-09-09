import type { AgentWorldClient } from "./client.js";
import type { NotificationsHub } from "./notifications.js";
import {
  cacheable,
  complete,
  declaredVersion,
  LATEST_PROTOCOL_VERSION,
  negotiateVersion,
  PRIVATE_CACHE,
  PUBLIC_CACHE,
  removedMethodError,
  SUPPORTED_PROTOCOL_VERSIONS,
  unknownDeclaredVersion,
  unsupportedProtocolVersionError,
  type ServerIdentity,
} from "./protocol.js";
import { listResources, readResource, RESOURCE_TEMPLATES } from "./resources.js";
import { getPrompt, PROMPTS } from "./prompts.js";
import { TOOLS, type McpToolDef } from "./tools.js";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** The newest revision this server speaks; see protocol.ts for the full set. */
export const PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;
export const SERVER_VERSION = "0.3.0";

const SERVER_INFO: ServerIdentity = { name: "agent-world", version: SERVER_VERSION };

const CAPABILITIES = {
  tools: { listChanged: false },
  resources: { subscribe: true, listChanged: false },
  prompts: { listChanged: false },
  extensions: {},
} as const;

function rpcError(id: JsonRpcMessage["id"], code: number, message: string, data?: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function textContent(text: string): unknown[] {
  return [{ type: "text", text }];
}

/** Methods 2026-07-28 removed, mapped to what replaced them. */
const REMOVED_IN_LATEST: Record<string, string> = {
  initialize: "server/discover（版本改由每个请求的 _meta 携带）",
  "notifications/initialized": "server/discover（协议已无握手）",
  ping: "server/discover",
  "logging/setLevel": "_meta 里的 io.modelcontextprotocol/logLevel",
  "resources/subscribe": "subscriptions/listen",
  "resources/unsubscribe": "关闭 subscriptions/listen 的响应流",
};

/**
 * Handle one inbound JSON-RPC message. Returns the reply to send back, or
 * `null` for notifications (no id) that need no response.
 */
export async function handleMessage(
  msg: JsonRpcMessage,
  client: AgentWorldClient,
  tools: McpToolDef[] = TOOLS,
  hub?: NotificationsHub,
): Promise<JsonRpcMessage | null> {
  const id = msg.id ?? null;
  if (id === null || id === undefined) return null; // notification

  const unknownVersion = unknownDeclaredVersion(msg);
  if (unknownVersion) return unsupportedProtocolVersionError(id, unknownVersion);

  const method = String(msg.method);
  if (declaredVersion(msg) === LATEST_PROTOCOL_VERSION && REMOVED_IN_LATEST[method]) {
    return removedMethodError(id, method, REMOVED_IN_LATEST[method]!);
  }

  const ok = (result: object): JsonRpcMessage => ({
    jsonrpc: "2.0",
    id,
    result: complete(result, SERVER_INFO),
  });

  switch (msg.method) {
    // 2026-07-28 (SEP-2575): the stateless replacement for `initialize`.
    // Servers MUST implement it; clients MAY call it first to pick a version,
    // or use it on stdio as a backward-compatibility probe.
    case "server/discover":
      return ok({
        protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
      });

    case "initialize":
      return ok({
        protocolVersion: negotiateVersion(asRecord(msg.params).protocolVersion),
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
      return null;

    case "ping":
      return ok({});

    case "tools/list":
      return ok(
        cacheable(
          {
            // 2026-07-28 SHOULD: deterministic order so client prompt caches hit.
            // Declaration order in tools.ts already is one, and it groups read
            // tools before writes — so it is kept rather than sorted.
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
          PUBLIC_CACHE,
        ),
      );

    case "tools/call": {
      const params = asRecord(msg.params);
      const name = asStringParam(params.name);
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        return rpcError(id, -32602, `未知工具: ${String(name)}`);
      }
      try {
        const result = await tool.handler(asRecord(params.arguments), client);
        return ok({ content: textContent(JSON.stringify(result, null, 2)), isError: false });
      } catch (e) {
        return ok({ content: textContent((e as Error).message), isError: true });
      }
    }

    case "resources/list": {
      try {
        const resources = await listResources(client);
        return ok(cacheable({ resources }, PRIVATE_CACHE));
      } catch (e) {
        return rpcError(id, -32603, (e as Error).message);
      }
    }

    // `resources/templates` was the 2024-11-05 spelling; newer revisions name it
    // `resources/templates/list`. Both stay wired so either client works.
    case "resources/templates":
    case "resources/templates/list":
      return ok(cacheable({ resourceTemplates: RESOURCE_TEMPLATES }, PUBLIC_CACHE));

    case "resources/read": {
      const params = asRecord(msg.params);
      const uri = asStringParam(params.uri);
      if (!uri) return rpcError(id, -32602, "缺少必填参数 \"uri\"");
      try {
        const result = await readResource(uri, client);
        return ok(cacheable(result, PRIVATE_CACHE));
      } catch (e) {
        return rpcError(id, -32602, (e as Error).message);
      }
    }

    case "resources/subscribe": {
      const params = asRecord(msg.params);
      const uri = asStringParam(params.uri);
      if (!uri) return rpcError(id, -32602, "缺少必填参数 \"uri\"");
      if (!hub) return rpcError(id, -32601, "当前传输不支持资源订阅（仅 HTTP/SSE 传输支持）");
      try {
        await hub.subscribe(uri, client);
        return ok({});
      } catch (e) {
        return rpcError(id, -32602, (e as Error).message);
      }
    }

    case "prompts/list":
      return ok(cacheable({ prompts: PROMPTS }, PUBLIC_CACHE));

    case "prompts/get": {
      const params = asRecord(msg.params);
      const name = asStringParam(params.name);
      if (!name) return rpcError(id, -32602, "缺少必填参数 \"name\"");
      try {
        const messages = getPrompt(name, asRecord(params.arguments));
        return ok({ messages });
      } catch (e) {
        return rpcError(id, -32602, (e as Error).message);
      }
    }

    default:
      return rpcError(id, -32601, `不支持的方法: ${String(msg.method)}`);
  }
}

function asStringParam(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
