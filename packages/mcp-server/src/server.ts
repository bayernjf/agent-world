import type { AgentWorldClient } from "./client.js";
import type { NotificationsHub } from "./notifications.js";
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

export const PROTOCOL_VERSION = "2024-11-05";
export const SERVER_VERSION = "0.2.0";

function rpcError(id: JsonRpcMessage["id"], code: number, message: string, data?: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function textContent(text: string): unknown[] {
  return [{ type: "text", text }];
}

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

  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: "agent-world", version: SERVER_VERSION },
        },
      };

    case "notifications/initialized":
      return null;

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };

    case "tools/call": {
      const params = asRecord(msg.params);
      const name = asStringParam(params.name);
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        return rpcError(id, -32602, `未知工具: ${String(name)}`);
      }
      try {
        const result = await tool.handler(asRecord(params.arguments), client);
        return {
          jsonrpc: "2.0",
          id,
          result: { content: textContent(JSON.stringify(result, null, 2)), isError: false },
        };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: textContent((e as Error).message),
            isError: true,
          },
        };
      }
    }

    case "resources/list": {
      try {
        const resources = await listResources(client);
        return { jsonrpc: "2.0", id, result: { resources } };
      } catch (e) {
        return rpcError(id, -32603, (e as Error).message);
      }
    }

    case "resources/templates":
      return { jsonrpc: "2.0", id, result: { resourceTemplates: RESOURCE_TEMPLATES } };

    case "resources/read": {
      const params = asRecord(msg.params);
      const uri = asStringParam(params.uri);
      if (!uri) return rpcError(id, -32602, "缺少必填参数 \"uri\"");
      try {
        const result = await readResource(uri, client);
        return { jsonrpc: "2.0", id, result };
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
        return { jsonrpc: "2.0", id, result: {} };
      } catch (e) {
        return rpcError(id, -32602, (e as Error).message);
      }
    }

    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: PROMPTS } };

    case "prompts/get": {
      const params = asRecord(msg.params);
      const name = asStringParam(params.name);
      if (!name) return rpcError(id, -32602, "缺少必填参数 \"name\"");
      try {
        const messages = getPrompt(name, asRecord(params.arguments));
        return { jsonrpc: "2.0", id, result: { messages } };
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
