import { describe, expect, it, vi } from "vitest";
import type { AgentWorldClient } from "./client.js";
import { handleMessage, PROTOCOL_VERSION } from "./server.js";

function mockClient(): AgentWorldClient {
  return {
    listGraphs: vi.fn().mockResolvedValue([
      { id: "g1", name: "研究助手", version: 3, updated_at: "2026-08-28T10:00:00Z" },
    ]),
    getGraph: vi.fn().mockResolvedValue({ id: "g1", name: "研究助手" }),
    startRun: vi.fn().mockResolvedValue({ runId: "r1" }),
    runState: vi.fn().mockResolvedValue({
      state: { status: "done", artifacts: { out: [{ id: "a1", kind: "text", label: "x", mimeType: "text/plain" }] } },
    }),
    listArtifacts: vi.fn().mockResolvedValue([{ id: "a1", kind: "text", node_id: "out", run_id: "r1" }]),
    getArtifact: vi.fn().mockResolvedValue({ id: "a1", mimeType: "text/plain", content: "hello" }),
  } as unknown as AgentWorldClient;
}

function call(id: number, method: string, params?: unknown) {
  return { jsonrpc: "2.0" as const, id, method, params };
}

describe("MCP server JSON-RPC", () => {
  it("answers initialize with capabilities and server info", async () => {
    const reply = await handleMessage(call(1, "initialize", { protocolVersion: "2024-11-05" }), mockClient());
    expect(reply).toMatchObject({
      id: 1,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "agent-world" },
      },
    });
  });

  it("ignores notifications (no id)", async () => {
    const reply = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, mockClient());
    expect(reply).toBeNull();
  });

  it("lists the 6 tools with schema", async () => {
    const reply = await handleMessage(call(2, "tools/list"), mockClient());
    const tools = (reply?.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name)).toEqual([
      "list_graphs",
      "get_graph",
      "run_graph",
      "get_run_status",
      "list_artifacts",
      "get_artifact",
    ]);
    expect(tools[0]?.inputSchema).toBeTruthy();
  });

  it("calls a tool and returns formatted text content", async () => {
    const client = mockClient();
    const reply = await handleMessage(call(3, "tools/call", { name: "list_graphs", arguments: {} }), client);
    expect(reply?.result).toMatchObject({ isError: false });
    const content = (reply?.result as { content: Array<{ type: string; text: string }> }).content;
    expect(content[0]?.text).toContain('"name": "研究助手"');
  });

  it("reports unknown tools as JSON-RPC errors", async () => {
    const reply = await handleMessage(call(4, "tools/call", { name: "nope", arguments: {} }), mockClient());
    expect(reply?.error?.code).toBe(-32602);
  });

  it("returns tool failures as isError results", async () => {
    const client = {
      listGraphs: vi.fn().mockRejectedValue(new Error("主服务不可达")),
    } as unknown as AgentWorldClient;
    const reply = await handleMessage(call(5, "tools/call", { name: "list_graphs", arguments: {} }), client);
    expect(reply?.result).toMatchObject({ isError: true });
    const content = (reply?.result as { content: Array<{ text: string }> }).content;
    expect(content[0]?.text).toBe("主服务不可达");
  });

  it("rejects unsupported methods", async () => {
    const reply = await handleMessage(call(6, "resources/list"), mockClient());
    expect(reply?.error?.code).toBe(-32601);
  });
});
