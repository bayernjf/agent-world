import { type ChildProcess, spawn } from "node:child_process";
import type { BuiltinSkill } from "./skills/registry.js";

/**
 * Minimal MCP (Model Context Protocol) client.
 *
 * MCP rides on JSON-RPC 2.0. Over stdio the framing is
 * `Content-Length: N\r\n\r\n{json}` messages in both directions. The server
 * may also push notifications (no id); we ignore those and only correlate
 * request/response by `id`.
 *
 * The transport is abstracted so the client logic is unit-testable without
 * spawning a real subprocess (see McpClient tests).
 */

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpTransport {
  /** Send a request and resolve with its result (or reject on RPC error). */
  request(method: string, params?: unknown): Promise<unknown>;
  /** Send a notification (no response expected). */
  notify(method: string, params?: unknown): void;
  close(): void;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpClient {
  private nextId = 1;
  constructor(
    private readonly transport: McpTransport,
    private readonly serverName = "mcp",
  ) {}

  /** Perform the MCP handshake, then signal readiness with initialized. */
  async initialize(): Promise<void> {
    await this.transport.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agent-world", version: "1.0.0" },
    });
    this.transport.notify("notifications/initialized", {});
  }

  async listTools(): Promise<McpTool[]> {
    const res = (await this.transport.request("tools/list", {})) as { tools?: McpTool[] };
    return res.tools ?? [];
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const res = (await this.transport.request("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    if (res.isError) {
      throw new Error(`MCP tool ${name} failed: ${JSON.stringify(res.content ?? res)}`);
    }
    const text = (res.content ?? []).map((c) => c.text ?? "").join("");
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  close(): void {
    this.transport.close();
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    return this.transport.request(method, params);
  }
}

/** stdio transport: spawns an MCP server process and frames JSON-RPC. */
export class StdioMcpTransport implements McpTransport {
  private readonly proc: ChildProcess;
  private buffer = "";
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private seq = 1;

  constructor(command: string, args: string[] = [], env?: Record<string, string>) {
    this.proc = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "inherit"],
    });
    this.proc.stdout!.setEncoding("utf8");
    this.proc.stdout!.on("data", (chunk: string) => this.onData(chunk));
    this.proc.on("exit", () => {
      for (const p of this.pending.values()) p.reject(new Error("MCP server exited"));
      this.pending.clear();
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    // Parse as many complete `Content-Length: N\r\n\r\n{json}` messages as available.
    for (;;) {
      const sep = this.buffer.indexOf("\r\n\r\n");
      if (sep === -1) break;
      const header = this.buffer.slice(0, sep);
      const m = /content-length:\s*(\d+)/i.exec(header);
      if (!m) {
        this.buffer = this.buffer.slice(sep + 4);
        continue;
      }
      const len = Number(m[1]);
      const bodyStart = sep + 4;
      if (this.buffer.length < bodyStart + len) break; // wait for the rest of the body
      const body = this.buffer.slice(bodyStart, bodyStart + len);
      this.buffer = this.buffer.slice(bodyStart + len);
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    if (msg.id === undefined) return; // notification or server->client request: ignore
    if (msg.result === undefined && msg.error === undefined) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    else p.resolve(msg.result);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.seq++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params } satisfies JsonRpcMessage);
    const frame = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin!.write(frame);
    });
  }

  notify(method: string, params?: unknown): void {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params } satisfies JsonRpcMessage);
    this.proc.stdin!.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  }

  close(): void {
    try {
      this.proc.kill();
    } catch {
      // ignore
    }
  }
}

/** Spawn an MCP server and return a connected client (handshake not yet done). */
export function connectMcpServer(
  command: string,
  args: string[] = [],
  env?: Record<string, string>,
): McpClient {
  return new McpClient(new StdioMcpTransport(command, args, env));
}

/**
 * Connect to an MCP server, list its tools, and register each as a skill card
 * so it can be mounted and called inside a pipeline like any built-in tool.
 * Returns the discovered tools.
 */
export async function registerMcpTools(
  serverId: string,
  client: McpClient,
  register: (skill: BuiltinSkill) => void,
): Promise<McpTool[]> {
  await client.initialize();
  const tools = await client.listTools();
  for (const t of tools) {
    const skillId = `mcp:${serverId}:${t.name}`;
    register({
      id: skillId,
      name: t.name,
      description: t.description ?? "",
      kind: "tool",
      source: "mcp",
      permissions: { subprocess: false, env: [] },
      config: {},
      tool: {
        name: skillId,
        description: t.description ?? "",
        parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
        async execute(args: unknown) {
          return client.callTool(t.name, args);
        },
      },
    });
  }
  return tools;
}
