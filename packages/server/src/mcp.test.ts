import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  McpClient,
  connectMcpServer,
  registerMcpTools,
  resolveSsePostUrl,
  type McpTransport,
} from "./mcp.js";
import { executeBuiltinTool, listBuiltinSkills, registerSkill } from "./skills/registry.js";

/** In-memory stand-in for an MCP server (no subprocess). */
class LoopbackMcpTransport implements McpTransport {
  notify(): void {}
  close(): void {}
  request(method: string, params?: unknown): Promise<unknown> {
    if (method === "initialize") return Promise.resolve({ protocolVersion: "2024-11-05" });
    if (method === "tools/list") {
      return Promise.resolve({
        tools: [{ name: "t1", description: "d", inputSchema: { type: "object" } }],
      });
    }
    if (method === "tools/call") {
      return Promise.resolve({
        content: [{ type: "text", text: JSON.stringify({ ok: true, name: (params as { name?: string }).name }) }],
      });
    }
    return Promise.resolve({});
  }
}

describe("McpClient (transport-agnostic)", () => {
  it("initializes, lists tools, and calls a tool", async () => {
    const client = new McpClient(new LoopbackMcpTransport(), "loop");
    await client.initialize();
    const tools = await client.listTools();
    expect(tools[0]!.name).toBe("t1");
    const res = await client.callTool("t1", { x: 1 });
    expect(res).toEqual({ ok: true, name: "t1" });
  });
});

describe("registerMcpTools", () => {
  it("registers each tool as a skill card with a working execute", async () => {
    const client = new McpClient(new LoopbackMcpTransport(), "s1");
    const registered: { id: string }[] = [];
    const tools = await registerMcpTools("s1", client, (s) => registered.push(s));
    expect(tools[0]!.name).toBe("t1");
    expect(registered[0]!.id).toBe("mcp:s1:t1");
    const out = await (registered[0] as { tool: { execute: (a: unknown) => Promise<unknown> } }).tool.execute({ a: 1 });
    expect(out).toEqual({ ok: true, name: "t1" });
  });

  it("tools become callable through the global skill registry", async () => {
    const client = new McpClient(new LoopbackMcpTransport(), "s2");
    const tools = await registerMcpTools("s2", client, registerSkill);
    expect(tools.length).toBeGreaterThan(0);
    expect(listBuiltinSkills().some((s) => s.id === "mcp:s2:t1")).toBe(true);
    const out = await executeBuiltinTool("mcp:s2:t1", { x: 2 });
    expect(out).toEqual({ ok: true, name: "t1" });
  });
});

describe("StdioMcpTransport (end-to-end against the sample server)", () => {
  it("spawns the sample server, lists and calls its echo tool", async () => {
    const script = fileURLToPath(new URL("../scripts/sample-mcp-server.mjs", import.meta.url));
    const client = connectMcpServer({ transport: "stdio", command: process.execPath, args: [script] });
    try {
      await client.initialize();
      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("echo");
      const res = await client.callTool("echo", { message: "hi" });
      expect(res).toEqual({ message: "hi" });
    } finally {
      client.close();
    }
  }, 15000);
});

/** Minimal in-process MCP server used to exercise the HTTP/SSE transports. */
function startMcpHttpServer(kind: "streamable" | "sse"): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const http = require("node:http") as typeof import("node:http");
    let sseRes: import("node:http").ServerResponse | null = null;
    const computeResult = (body: Record<string, unknown>): unknown => {
      if (body.method === "initialize") return { protocolVersion: "2024-11-05" };
      if (body.method === "tools/list")
        return { tools: [{ name: "echo", description: "d", inputSchema: { type: "object" } }] };
      if (body.method === "tools/call")
        return { content: [{ type: "text", text: JSON.stringify({ message: (body.params as { arguments?: { message?: string } }).arguments?.message }) }] };
      return {};
    };
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const sendJson = (obj: unknown) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(obj));
      };
      const sendResult = (id: unknown, result: unknown, asSse: boolean) => {
        if (asSse) {
          res.setHeader("Content-Type", "text/event-stream");
          res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`);
        } else {
          sendJson({ jsonrpc: "2.0", id, result });
        }
      };
      if (req.method === "GET" && url.pathname === "/sse") {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.flushHeaders();
        sseRes = res;
        res.write(`event: endpoint\ndata: http://localhost:${server.address().port}/messages\n\n`);
        return;
      }
      if (req.method === "POST" && url.pathname === "/messages") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const body = JSON.parse(raw) as Record<string, unknown>;
          if (sseRes) {
            // Legacy SSE server pushes responses back over the GET stream.
            sseRes.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: computeResult(body) })}\n\n`);
            res.statusCode = 202;
            res.end();
          } else {
            sendJson({ jsonrpc: "2.0", id: body.id, result: computeResult(body) });
          }
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/mcp") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          const body = JSON.parse(raw) as Record<string, unknown>;
          sendResult(body.id, computeResult(body), kind === "streamable");
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.listen(0, () => {
      const port = server.address().port;
      resolve({
        url: `http://localhost:${port}`,
        close: () => server.close(),
      });
    });
  });
}

describe("StreamableHttpMcpTransport (4D.7)", () => {
  it("talks to a remote MCP server over HTTP", async () => {
    const srv = await startMcpHttpServer("streamable");
    const client = connectMcpServer({ transport: "http", url: `${srv.url}/mcp` });
    try {
      await client.initialize();
      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("echo");
      const res = await client.callTool("echo", { message: "remote" });
      expect(res).toEqual({ message: "remote" });
    } finally {
      client.close();
      srv.close();
    }
  }, 15000);
});

describe("resolveSsePostUrl (audit L7)", () => {
  const stream = "https://mcp.example.com/sse";
  it("keeps a same-origin relative or absolute endpoint", () => {
    expect(resolveSsePostUrl(stream, "/messages")).toBe("https://mcp.example.com/messages");
    expect(resolveSsePostUrl(stream, "https://mcp.example.com/msg")).toBe("https://mcp.example.com/msg");
  });
  it("falls back to the stream URL for a cross-origin or non-http endpoint", () => {
    expect(resolveSsePostUrl(stream, "https://evil.example.com/x")).toBe(stream);
    expect(resolveSsePostUrl(stream, "http://mcp.example.com/x")).toBe(stream); // scheme differs
    expect(resolveSsePostUrl(stream, "file:///etc/passwd")).toBe(stream);
    expect(resolveSsePostUrl(stream, "http://169.254.169.254/latest/meta-data")).toBe(stream); // cross-origin IP
  });
});

describe("SseMcpTransport (4D.7)", () => {
  it("talks to a legacy SSE MCP server", async () => {
    const srv = await startMcpHttpServer("sse");
    const client = connectMcpServer({ transport: "sse", url: `${srv.url}/sse` });
    try {
      await client.initialize();
      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("echo");
      const res = await client.callTool("echo", { message: "sse" });
      expect(res).toEqual({ message: "sse" });
    } finally {
      client.close();
      srv.close();
    }
  }, 15000);
});
