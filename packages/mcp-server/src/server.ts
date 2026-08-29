import type { AgentWorldClient } from "./client.js";
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
          capabilities: { tools: {} },
          serverInfo: { name: "agent-world", version: "0.1.0" },
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

    default:
      return rpcError(id, -32601, `不支持的方法: ${String(msg.method)}`);
  }
}

function asStringParam(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
