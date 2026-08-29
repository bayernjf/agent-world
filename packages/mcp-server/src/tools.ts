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
];
