import { describe, expect, it, vi } from "vitest";
import type { AgentWorldClient } from "./client.js";
import { handleMessage, PROTOCOL_VERSION } from "./server.js";
import { filterTools } from "./tools.js";

function mockClient(): AgentWorldClient {
  return {
    listGraphs: vi.fn().mockResolvedValue([
      { id: "g1", name: "研究助手", version: 3, updated_at: "2026-08-28T10:00:00Z" },
    ]),
    getGraph: vi.fn().mockResolvedValue({ id: "g1", name: "研究助手", nodes: [], edges: [], version: 3 }),
    startRun: vi.fn().mockResolvedValue({ runId: "r1" }),
    runState: vi.fn().mockResolvedValue({
      state: { status: "done", artifacts: { out: [{ id: "a1", kind: "text", label: "x", mimeType: "text/plain" }] } },
    }),
    listArtifacts: vi.fn().mockResolvedValue([{ id: "a1", kind: "text", node_id: "out", run_id: "r1" }]),
    getArtifact: vi.fn().mockResolvedValue({ id: "a1", mimeType: "text/plain", content: "hello" }),
    createGraph: vi.fn().mockResolvedValue({ id: "g2", name: "新建产线", nodes: [] }),
    updateGraph: vi.fn().mockResolvedValue({ ok: true, version: 4 }),
    deleteGraph: vi.fn().mockResolvedValue({ ok: true }),
    cancelRun: vi.fn().mockResolvedValue({ ok: true }),
    searchKnowledge: vi.fn().mockResolvedValue({
      entries: [{ id: "k1", title: "挂脖风扇", content: "..." }],
    }),
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
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: "agent-world", version: "0.2.0" },
      },
    });
  });

  it("ignores notifications (no id)", async () => {
    const reply = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, mockClient());
    expect(reply).toBeNull();
  });

  it("lists the 12 tools with schema", async () => {
    const reply = await handleMessage(call(2, "tools/list"), mockClient());
    const tools = (reply?.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
    expect(tools).toHaveLength(12);
    expect(tools.map((t) => t.name)).toEqual([
      "list_graphs",
      "get_graph",
      "run_graph",
      "get_run_status",
      "list_artifacts",
      "get_artifact",
      "create_graph",
      "update_graph",
      "delete_graph",
      "cancel_run",
      "download_artifact",
      "search_knowledge",
    ]);
    expect(tools[0]?.inputSchema).toBeTruthy();
  });

  it("exposes only read tools in readonly mode", async () => {
    const reply = await handleMessage(call(2, "tools/list"), mockClient(), filterTools(true));
    const tools = (reply?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      "list_graphs",
      "get_graph",
      "get_run_status",
      "list_artifacts",
      "get_artifact",
      "download_artifact",
      "search_knowledge",
    ]);
  });

  it("rejects write tools in readonly mode", async () => {
    const client = mockClient();
    const reply = await handleMessage(
      call(3, "tools/call", { name: "run_graph", arguments: { graphId: "g1" } }),
      client,
      filterTools(true),
    );
    expect(reply?.error?.code).toBe(-32602);
    expect(client.startRun).not.toHaveBeenCalled();
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
    const reply = await handleMessage(call(6, "something/else"), mockClient());
    expect(reply?.error?.code).toBe(-32601);
  });

  it("lists resources from the user's graphs", async () => {
    const reply = await handleMessage(call(7, "resources/list"), mockClient());
    const resources = (reply?.result as { resources: Array<{ uri: string; description: string }> }).resources;
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ uri: "graph://g1" });
    expect(resources[0]?.description).toContain("研究助手");
  });

  it("lists resource templates", async () => {
    const reply = await handleMessage(call(8, "resources/templates"), mockClient());
    const templates = (reply?.result as { resourceTemplates: Array<{ uriTemplate: string }> }).resourceTemplates;
    expect(templates.map((t) => t.uriTemplate)).toEqual([
      "graph://{id}",
      "run://{id}",
      "artifact://{id}",
    ]);
  });

  it("reads a graph resource as inline JSON text", async () => {
    const client = mockClient();
    const reply = await handleMessage(call(9, "resources/read", { uri: "graph://g1" }), client);
    const contents = (reply?.result as { contents: Array<{ uri: string; mimeType: string; text?: string }> }).contents;
    expect(contents[0]).toMatchObject({ uri: "graph://g1", mimeType: "application/json" });
    expect(contents[0]?.text).toContain('"name": "研究助手"');
    expect(client.getGraph).toHaveBeenCalledWith("g1");
  });

  it("rejects unknown resource URIs with a clear error", async () => {
    const reply = await handleMessage(call(10, "resources/read", { uri: "file:///etc/passwd" }), mockClient());
    expect(reply?.error?.code).toBe(-32602);
    expect(String(reply?.error?.message)).toContain("graph://{id}");
  });

  it("reports a missing uri parameter", async () => {
    const reply = await handleMessage(call(11, "resources/read", {}), mockClient());
    expect(reply?.error?.code).toBe(-32602);
  });

  it("lists prompts", async () => {
    const reply = await handleMessage(call(12, "prompts/list"), mockClient());
    const prompts = (reply?.result as { prompts: Array<{ name: string }> }).prompts;
    expect(prompts.map((p) => p.name)).toEqual([
      "run_pipeline",
      "analyze_pipeline",
      "create_from_template",
    ]);
  });

  it("gets a prompt and interpolates arguments", async () => {
    const reply = await handleMessage(
      call(13, "prompts/get", { name: "run_pipeline", arguments: { graphId: "g1" } }),
      mockClient(),
    );
    const messages = (reply?.result as { messages: Array<{ role: string; content: { text: string } }> }).messages;
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content.text).toContain("g1");
    expect(messages[0]?.content.text).toContain("run_graph");
  });

  it("rejects unknown prompts", async () => {
    const reply = await handleMessage(call(14, "prompts/get", { name: "nope" }), mockClient());
    expect(reply?.error?.code).toBe(-32602);
  });
});

describe("MCP management tools (P2-①)", () => {
  it("create_graph creates from template and returns a summary", async () => {
    const client = mockClient();
    const reply = await handleMessage(
      call(20, "tools/call", { name: "create_graph", arguments: { template: "copywriting", name: "种草" } }),
      client,
    );
    expect(reply?.result).toMatchObject({ isError: false });
    expect(client.createGraph).toHaveBeenCalledWith({ template: "copywriting", name: "种草" });
    const text = (reply?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(text).toContain('"id": "g2"');
    expect(text).toContain('"nodeCount": 0');
  });

  it("update_graph merges partial fields onto the current graph", async () => {
    const client = mockClient();
    client.getGraph = vi.fn().mockResolvedValue({ id: "g1", name: "旧名", nodes: [{ id: "n1" }], edges: [] });
    const reply = await handleMessage(
      call(21, "tools/call", { name: "update_graph", arguments: { graphId: "g1", name: "新名" } }),
      client,
    );
    expect(reply?.result).toMatchObject({ isError: false });
    expect(client.updateGraph).toHaveBeenCalledWith("g1", {
      id: "g1",
      name: "新名",
      nodes: [{ id: "n1" }],
      edges: [],
    });
    const text = (reply?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(text).toContain('"version": 4');
  });

  it("update_graph requires graphId", async () => {
    const client = mockClient();
    const reply = await handleMessage(
      call(22, "tools/call", { name: "update_graph", arguments: { name: "x" } }),
      client,
    );
    expect(reply?.result).toMatchObject({ isError: true });
    expect(client.updateGraph).not.toHaveBeenCalled();
  });

  it("delete_graph refuses without confirm", async () => {
    const client = mockClient();
    const reply = await handleMessage(
      call(23, "tools/call", { name: "delete_graph", arguments: { graphId: "g1" } }),
      client,
    );
    expect(reply?.result).toMatchObject({ isError: true });
    expect(client.deleteGraph).not.toHaveBeenCalled();
  });

  it("delete_graph removes the graph when confirmed", async () => {
    const client = mockClient();
    const reply = await handleMessage(
      call(24, "tools/call", { name: "delete_graph", arguments: { graphId: "g1", confirm: true } }),
      client,
    );
    expect(reply?.result).toMatchObject({ isError: false });
    expect(client.deleteGraph).toHaveBeenCalledWith("g1");
  });

  it("cancel_run cancels a live run", async () => {
    const client = mockClient();
    const reply = await handleMessage(
      call(25, "tools/call", { name: "cancel_run", arguments: { runId: "r1" } }),
      client,
    );
    expect(reply?.result).toMatchObject({ isError: false });
    expect(client.cancelRun).toHaveBeenCalledWith("r1");
  });

  it("download_artifact returns inline text for text artifacts", async () => {
    const client = mockClient();
    const reply = await handleMessage(
      call(26, "tools/call", { name: "download_artifact", arguments: { artifactId: "a1" } }),
      client,
    );
    expect(reply?.result).toMatchObject({ isError: false });
    const text = (reply?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(text).toContain('"content": "hello"');
  });

  it("search_knowledge forwards query and limit", async () => {
    const client = mockClient();
    const reply = await handleMessage(
      call(27, "tools/call", { name: "search_knowledge", arguments: { query: "挂脖风扇", limit: 5 } }),
      client,
    );
    expect(reply?.result).toMatchObject({ isError: false });
    expect(client.searchKnowledge).toHaveBeenCalledWith("挂脖风扇", 5);
    const text = (reply?.result as { content: Array<{ text: string }> }).content[0]?.text;
    expect(text).toContain('"count": 1');
  });

  it("search_knowledge defaults limit to 10", async () => {
    const client = mockClient();
    await handleMessage(call(28, "tools/call", { name: "search_knowledge", arguments: { query: "x" } }), client);
    expect(client.searchKnowledge).toHaveBeenCalledWith("x", 10);
  });
});
