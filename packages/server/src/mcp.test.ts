import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  McpClient,
  connectMcpServer,
  registerMcpTools,
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
    const client = connectMcpServer(process.execPath, [script]);
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
