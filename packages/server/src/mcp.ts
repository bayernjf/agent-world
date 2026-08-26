import { type ChildProcess, spawn } from "node:child_process";
import type { SkillPermissions } from "@agent-world/core";
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

/**
 * How to reach an MCP server. `stdio` spawns a local process; `http` and `sse`
 * talk to a remote server over the network (Streamable HTTP / legacy SSE).
 */
export type McpServerSpec =
  | { transport: "stdio"; command: string; args?: string[]; env?: Record<string, string>; danger?: boolean }
  | { transport: "http" | "sse"; url: string; headers?: Record<string, string>; danger?: boolean };

/** Parse a raw text/event-stream body into JSON-RPC messages. */
function parseSse(raw: string): JsonRpcMessage[] {
  const out: JsonRpcMessage[] = [];
  for (const ev of raw.split(/\r?\n\r?\n/)) {
    let data = "";
    for (const line of ev.split(/\r?\n/)) {
      if (line.startsWith("data:")) data += line.slice(5).replace(/^\s/, "");
    }
    if (!data) continue;
    try {
      out.push(JSON.parse(data));
    } catch {
      // keep-alive comments / partial frames: skip
    }
  }
  return out;
}

function resolveUrl(base: string, target: string): string {
  try {
    return new URL(target, base).toString();
  } catch {
    return target;
  }
}

/**
 * Streamable HTTP transport (MCP 2025-03-26). Every request is a POST carrying
 * a JSON-RPC body; the server responds with `application/json` *or*
 * `text/event-stream`. The client captures the `Mcp-Session-Id` header so
 * follow-up requests stay on the same session.
 */
export class StreamableHttpMcpTransport implements McpTransport {
  private sessionId?: string;
  private seq = 1;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  private async post(payload: JsonRpcMessage): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream")) {
      const msgs = parseSse(await res.text());
      const m = msgs.find((x) => x.id === payload.id);
      if (!m) throw new Error("MCP stream ended without a response");
      if (m.error) throw new Error(`MCP error ${m.error.code}: ${m.error.message}`);
      return m.result;
    }
    const json = (await res.json()) as JsonRpcMessage;
    if (json.error) throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    return json.result;
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.seq++;
    return this.post({ jsonrpc: "2.0", id, method, params } satisfies JsonRpcMessage);
  }

  notify(method: string, params?: unknown): void {
    void this.post({ jsonrpc: "2.0", method, params } satisfies JsonRpcMessage);
  }

  close(): void {}
}

/**
 * Legacy SSE transport: a long-lived GET stream carries server→client messages
 * (the first `endpoint` event tells us where to POST client→server messages).
 * Used by older MCP servers that have not adopted Streamable HTTP.
 */
export class SseMcpTransport implements McpTransport {
  private seq = 1;
  private opened = false;
  private postUrl?: string;
  private postUrlReady: Promise<string> | null = null;
  private postUrlResolve?: (url: string) => void;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  private ensureStream(): void {
    if (this.opened) return;
    this.opened = true;
    this.postUrlReady = new Promise<string>((resolve) => (this.postUrlResolve = resolve));
    void (async () => {
      const res = await fetch(this.url, {
        headers: { Accept: "text/event-stream", ...this.headers },
        signal: AbortSignal.timeout(30000),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          this.handleEvent(buf.slice(0, idx));
          buf = buf.slice(idx + 2);
        }
      }
    })();
  }

  private handleEvent(ev: string): void {
    let event = "message";
    let data = "";
    for (const line of ev.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).replace(/^\s/, "");
    }
    if (event === "endpoint") {
      this.postUrl = resolveUrl(this.url, data);
      this.postUrlResolve?.(this.postUrl);
      return;
    }
    if (!data) return;
    try {
      const msg = JSON.parse(data) as JsonRpcMessage;
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } catch {
      // ignore malformed frames
    }
  }

  request(method: string, params?: unknown): Promise<unknown> {
    this.ensureStream();
    return (async () => {
      const postUrl = await this.postUrlReady!;
      const id = this.seq++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        fetch(postUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.headers },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          signal: AbortSignal.timeout(30000),
        }).catch((e) => {
          this.pending.delete(id);
          reject(e as Error);
        });
      });
    })();
  }

  notify(method: string, params?: unknown): void {
    void (async () => {
      this.ensureStream();
      const postUrl = await this.postUrlReady!;
      fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
        signal: AbortSignal.timeout(30000),
      }).catch(() => {});
    })();
  }

  close(): void {}
}

/** Connect to an MCP server and return a client (handshake not yet done). */
export function connectMcpServer(spec: McpServerSpec): McpClient {
  switch (spec.transport) {
    case "stdio":
      return new McpClient(new StdioMcpTransport(spec.command, spec.args ?? [], spec.env));
    case "http":
      return new McpClient(new StreamableHttpMcpTransport(spec.url, spec.headers));
    case "sse":
      return new McpClient(new SseMcpTransport(spec.url, spec.headers));
  }
}

/**
 * Connect to an MCP server, list its tools, and register each as a skill card
 * so it can be mounted and called inside a pipeline like any built-in tool.
 * `permissions` lets the operator declare what the remote tools may touch
 * (see 4D.7 — tool-call permission governance); it defaults to nothing
 * granted, which is the safe stance for an untrusted remote server.
 * Returns the discovered tools.
 */
export async function registerMcpTools(
  serverId: string,
  client: McpClient,
  register: (skill: BuiltinSkill) => void,
  permissions?: SkillPermissions,
  danger?: boolean,
): Promise<McpTool[]> {
  await client.initialize();
  const tools = await client.listTools();
  const perms: SkillPermissions = permissions ?? { subprocess: false, env: [] };
  for (const t of tools) {
    const skillId = `mcp:${serverId}:${t.name}`;
    register({
      id: skillId,
      name: t.name,
      description: t.description ?? "",
      kind: "tool",
      source: "mcp",
      danger,
      permissions: perms,
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
