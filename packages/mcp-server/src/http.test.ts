import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWorldClient } from "./client.js";
import { startHttpServer, MCP_HTTP_PATH } from "./http.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

function mockClient(): AgentWorldClient {
  return {
    listGraphs: vi.fn().mockResolvedValue([
      { id: "g1", name: "研究助手", version: 3, updated_at: "2026-08-28T10:00:00Z" },
    ]),
    getGraph: vi.fn().mockResolvedValue({ id: "g1", name: "研究助手" }),
    startRun: vi.fn().mockResolvedValue({ runId: "r1" }),
    runState: vi.fn().mockResolvedValue({
      state: { status: "done", artifacts: { out: [{ id: "a1", kind: "text", label: "x" }] } },
    }),
    listArtifacts: vi.fn().mockResolvedValue([{ id: "a1", kind: "text", node_id: "out", run_id: "r1" }]),
    getArtifact: vi.fn().mockResolvedValue({ id: "a1", mimeType: "text/plain", content: "hello" }),
    createGraph: vi.fn().mockResolvedValue({ id: "g2", name: "新建产线", nodes: [] }),
    updateGraph: vi.fn().mockResolvedValue({ ok: true, version: 4 }),
    deleteGraph: vi.fn().mockResolvedValue({ ok: true }),
    cancelRun: vi.fn().mockResolvedValue({ ok: true }),
    searchKnowledge: vi.fn().mockResolvedValue({ entries: [{ id: "k1", title: "挂脖风扇" }] }),
  } as unknown as AgentWorldClient;
}

function rpc(id: number, method: string, params?: unknown) {
  return { jsonrpc: "2.0", id, method, params };
}

describe("MCP Streamable HTTP transport", () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    server = await startHttpServer(mockClient(), 0);
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("answers POST /mcp with JSON for a plain client", async () => {
    const res = await fetch(`${base}${MCP_HTTP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rpc(1, "initialize", { protocolVersion: "2024-11-05" })),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { result: { capabilities: unknown; serverInfo: { name: string } } };
    expect(body.result.capabilities).toMatchObject({ tools: {}, resources: {}, prompts: {} });
    expect(body.result.serverInfo.name).toBe("agent-world");
  });

  it("answers POST /mcp with SSE when the client asks for it", async () => {
    const res = await fetch(`${base}${MCP_HTTP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(rpc(2, "ping")),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: message");
    expect(text).toContain('"id":2');
  });

  it("accepts notifications with 202 and no body", async () => {
    const res = await fetch(`${base}${MCP_HTTP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("GET /mcp opens an SSE stream announcing the POST endpoint", async () => {
    const ac = new AbortController();
    const res = await fetch(`${base}${MCP_HTTP_PATH}`, { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("event: endpoint");
    expect(text).toContain(MCP_HTTP_PATH);
    await reader.cancel();
    ac.abort();
  });

  it("returns 404 for unknown paths and 405 for non-POST methods", async () => {
    const notFound = await fetch(`${base}/nope`);
    expect(notFound.status).toBe(404);
    const put = await fetch(`${base}${MCP_HTTP_PATH}`, { method: "PUT", body: "{}" });
    expect(put.status).toBe(405);
  });

  it("returns a parse error for malformed JSON bodies", async () => {
    const res = await fetch(`${base}${MCP_HTTP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });
});

describe("end-to-end HTTP smoke over the real wire", () => {
  it("runs initialize → tools → resources → prompts → tool call", async () => {
    const server = await startHttpServer(mockClient(), 0);
    const addr = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${addr.port}`;

    try {
      const post = (id: number, method: string, params?: unknown) =>
        fetch(`${base}${MCP_HTTP_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify(rpc(id, method, params)),
        }).then(async (r) => {
          const text = await r.text();
          const m = /event: message\ndata: (.+)\n\n/s.exec(text);
          expect(m, `missing SSE frame for ${method}: ${text}`).toBeTruthy();
          return JSON.parse(m![1]!) as { result?: unknown; error?: { code: number; message: string } };
        });

      const init = await post(1, "initialize", { protocolVersion: "2024-11-05" });
      expect((init.result as { capabilities: object }).capabilities).toMatchObject({
        tools: {},
        resources: {},
        prompts: {},
      });

      const tools = await post(2, "tools/list");
      expect((tools.result as { tools: unknown[] }).tools).toHaveLength(12);

      const resources = await post(3, "resources/list");
      expect((resources.result as { resources: unknown[] }).resources).toHaveLength(1);

      const prompts = await post(4, "prompts/list");
      expect((prompts.result as { prompts: unknown[] }).prompts).toHaveLength(3);

      const graph = await post(5, "resources/read", { uri: "graph://g1" });
      expect((graph.result as { contents: Array<{ uri: string }> }).contents[0]?.uri).toBe("graph://g1");

      const run = await post(6, "tools/call", { name: "run_graph", arguments: { graphId: "g1", input: "hi" } });
      expect((run.result as { isError?: boolean }).isError).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
