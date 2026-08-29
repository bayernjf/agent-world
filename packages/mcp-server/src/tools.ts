import type { AgentWorldClient } from "./client.js";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, client: AgentWorldClient) => Promise<unknown>;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = asString(args[key]);
  if (!v) throw new Error(`缺少必填参数 "${key}"`);
  return v;
}

/** Pick a stable id/name/updatedAt shape out of whatever the API returned. */
function summarizeGraph(g: Record<string, unknown>): Record<string, unknown> {
  return {
    id: g.id,
    name: g.name,
    version: g.version,
    updatedAt: g.updated_at ?? g.updatedAt,
  };
}

export const TOOLS: McpToolDef[] = [
  {
    name: "list_graphs",
    description: "列出当前 agent-world 中的所有产线（id、名称、更新时间），不含节点配置详情",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, client) => {
      const graphs = await client.listGraphs();
      return graphs.map(summarizeGraph);
    },
  },
  {
    name: "get_graph",
    description: "获取指定产线的完整配置（节点、连接、参数）",
    inputSchema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "产线 id" },
      },
      required: ["graphId"],
    },
    handler: async (args, client) => client.getGraph(requireString(args, "graphId")),
  },
  {
    name: "run_graph",
    description: "运行指定产线并立即返回 runId（异步，不等待完成）；后续用 get_run_status 查询",
    inputSchema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "产线 id" },
        input: { type: "string", description: "可选：传给产线 Source 节点的初始输入" },
      },
      required: ["graphId"],
    },
    handler: async (args, client) => {
      const graphId = requireString(args, "graphId");
      const input = asString(args.input);
      const { runId } = await client.startRun(graphId, input);
      return { runId, note: "运行已启动，请用 get_run_status 查询结果" };
    },
  },
  {
    name: "get_run_status",
    description: "查询一次运行的状态（done / failed / running / halted…）、进度与产出摘要",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "运行 id" },
      },
      required: ["runId"],
    },
    handler: async (args, client) => {
      const runId = requireString(args, "runId");
      const body = (await client.runState(runId)) as {
        state?: { status?: string; artifacts?: Record<string, unknown[]> };
      };
      const state = body.state ?? {};
      const artifacts = state.artifacts ?? {};
      const total = Object.values(artifacts).reduce((n, list) => n + list.length, 0);
      return {
        runId,
        status: state.status ?? "unknown",
        artifactCount: total,
        artifactsByNode: Object.fromEntries(
          Object.entries(artifacts).map(([nodeId, list]) => [
            nodeId,
            list.map((raw) => {
              const a = raw as { id?: unknown; kind?: unknown; label?: unknown; mimeType?: unknown };
              return { id: a.id, kind: a.kind, label: a.label, mimeType: a.mimeType };
            }),
          ]),
        ),
      };
    },
  },
  {
    name: "list_artifacts",
    description: "列出一次运行产生的全部产物（id、类型、标签、mimeType）",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "运行 id" },
      },
      required: ["runId"],
    },
    handler: async (args, client) => {
      const runId = requireString(args, "runId");
      const artifacts = await client.listArtifacts(runId);
      return artifacts.map((a) => ({
        id: a.id,
        kind: a.kind,
        label: a.label,
        mimeType: a.mimeType,
        nodeId: a.nodeId ?? a.node_id,
        runId: a.runId ?? a.run_id,
      }));
    },
  },
  {
    name: "get_artifact",
    description: "获取单个产物的内容（文本类直接返回全文；图片/音视频等二进制返回下载地址）",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "产物 id" },
      },
      required: ["artifactId"],
    },
    handler: async (args, client) => {
      const artifactId = requireString(args, "artifactId");
      const art = await client.getArtifact(artifactId);
      if (art.content !== undefined) {
        return { id: art.id, mimeType: art.mimeType, content: art.content };
      }
      return {
        id: art.id,
        mimeType: art.mimeType,
        note: "二进制产物（图片/音视频），请通过下载地址获取",
        downloadUrl: art.downloadUrl,
      };
    },
  },
  {
    name: "create_graph",
    description: "创建新产线：从模板创建（template 传模板 id）、复制现有产线（from 传产线 id）或空白创建",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "可选：新产线名称" },
        template: { type: "string", description: "可选：模板 id（见主服务 GET /api/templates）" },
        from: { type: "string", description: "可选：要复制的现有产线 id" },
      },
    },
    handler: async (args, client) => {
      const input: { name?: string; template?: string; from?: string } = {};
      const name = asString(args.name);
      if (name) input.name = name;
      const template = asString(args.template);
      if (template) input.template = template;
      const from = asString(args.from);
      if (from) input.from = from;
      const graph = await client.createGraph(input);
      return {
        id: graph.id,
        name: graph.name,
        nodeCount: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
      };
    },
  },
  {
    name: "update_graph",
    description: "更新产线配置：改名称/节点/连接（只覆盖传入的字段，其余保持；nodes/edges 需为完整数组）",
    inputSchema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "产线 id" },
        name: { type: "string", description: "可选：新名称" },
        nodes: { type: "array", description: "可选：完整节点数组（覆盖）" },
        edges: { type: "array", description: "可选：完整连接数组（覆盖）" },
      },
      required: ["graphId"],
    },
    handler: async (args, client) => {
      const graphId = requireString(args, "graphId");
      const current = (await client.getGraph(graphId)) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...current };
      const name = asString(args.name);
      if (name) merged.name = name;
      if (Array.isArray(args.nodes)) merged.nodes = args.nodes;
      if (Array.isArray(args.edges)) merged.edges = args.edges;
      const result = await client.updateGraph(graphId, merged);
      return { ok: true, graphId, version: result.version };
    },
  },
  {
    name: "delete_graph",
    description: "删除产线。必须显式传 confirm: true 以防误删",
    inputSchema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "产线 id" },
        confirm: { type: "boolean", description: "必须为 true 才会执行删除" },
      },
      required: ["graphId", "confirm"],
    },
    handler: async (args, client) => {
      const graphId = requireString(args, "graphId");
      if (args.confirm !== true) throw new Error("删除产线需要 confirm: true 确认");
      await client.deleteGraph(graphId);
      return { ok: true, deletedGraphId: graphId };
    },
  },
  {
    name: "cancel_run",
    description: "取消运行中的产线（仅对 running/halted 状态有效）",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string", description: "运行 id" },
      },
      required: ["runId"],
    },
    handler: async (args, client) => {
      const runId = requireString(args, "runId");
      const result = await client.cancelRun(runId);
      return { ...result, runId };
    },
  },
  {
    name: "download_artifact",
    description: "下载产物：文本类返回完整内容，二进制（图片/音视频）返回下载地址",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "产物 id" },
      },
      required: ["artifactId"],
    },
    handler: async (args, client) => {
      const artifactId = requireString(args, "artifactId");
      const art = await client.getArtifact(artifactId);
      if (art.content !== undefined) {
        return { id: art.id, mimeType: art.mimeType, content: art.content };
      }
      return {
        id: art.id,
        mimeType: art.mimeType,
        note: "二进制产物（图片/音视频），请通过下载地址获取",
        downloadUrl: art.downloadUrl,
      };
    },
  },
  {
    name: "search_knowledge",
    description: "全文检索知识库（历史产出/素材/笔记），返回匹配条目",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词" },
        limit: { type: "number", description: "可选：返回条数上限，默认 10，最大 50" },
      },
      required: ["query"],
    },
    handler: async (args, client) => {
      const query = requireString(args, "query");
      const limit = typeof args.limit === "number" ? args.limit : 10;
      const body = await client.searchKnowledge(query, limit);
      return { count: body.entries.length, entries: body.entries };
    },
  },
];

/** Tool names that mutate state; hidden & rejected in readonly mode. */
const WRITE_TOOLS = new Set(["run_graph", "create_graph", "update_graph", "delete_graph", "cancel_run"]);

/**
 * Filter tools for readonly mode (`AGENT_WORLD_MCP_READONLY=1`): only read-only
 * tools are exposed, write tools are dropped from `tools/list` entirely.
 */
export function filterTools(readonly: boolean): McpToolDef[] {
  return readonly ? TOOLS.filter((t) => !WRITE_TOOLS.has(t.name)) : TOOLS;
}
