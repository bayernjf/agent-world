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
  {
    name: "batch_run",
    description:
      "批量运行产线（多组输入）。wait=false 立即返回各 runId（异步）；wait=true 等待全部完成并聚合结果，受 maxConcurrency 限流，超时自动降级为 runId 列表",
    inputSchema: {
      type: "object",
      properties: {
        graphId: { type: "string", description: "产线 id" },
        inputs: { type: "array", items: { type: "string" }, description: "多组输入，每组启动一次运行" },
        wait: { type: "boolean", description: "可选：是否等待完成，默认 false（异步）" },
        maxConcurrency: { type: "number", description: "可选：并发上限，默认 3，范围 1–10" },
      },
      required: ["graphId", "inputs"],
    },
    handler: async (args, client) => {
      const graphId = requireString(args, "graphId");
      if (!Array.isArray(args.inputs) || args.inputs.length === 0) {
        throw new Error('缺少必填参数 "inputs"（非空数组）');
      }
      const wait = args.wait === true;
      const maxConcurrency = clampInt(args.maxConcurrency, 1, 10, 3);

      const started = await mapWithConcurrency(
        args.inputs as unknown[],
        maxConcurrency,
        async (input, index) => {
          const value = typeof input === "string" ? input : String(input);
          try {
            const { runId } = await client.startRun(graphId, value);
            return { index, input: value, runId };
          } catch (e) {
            return { index, input: value, error: (e as Error).message };
          }
        },
      );

      const runs = started.map((s) => {
        if (s.runId !== undefined) {
          return { index: s.index, input: s.input, runId: s.runId };
        }
        return { index: s.index, input: s.input, error: s.error };
      });

      if (!wait) {
        return { runs, note: "已并行启动（异步）。wait=true 可等待全部完成并聚合结果" };
      }

      const runIds = started.flatMap((s) => (s.runId !== undefined ? [s.runId] : []));
      const awaited = await waitForRuns(client, runIds, BATCH_WAIT_TIMEOUT_MS, BATCH_POLL_INTERVAL_MS);
      if (awaited.completed) {
        return {
          runs,
          results: awaited.results,
          note: `全部 ${awaited.results.length} 次运行已完成`,
        };
      }
      return {
        runs,
        results: awaited.results,
        note: `等待超时（${Math.round(BATCH_WAIT_TIMEOUT_MS / 1000)}s），未完成运行请用 get_run_status 轮询`,
      };
    },
  },
  {
    name: "compare_runs",
    description:
      "对比两次运行的产出差异：成本/Token/节点数 + 按节点分组的产物数量与文本相似度，输出结构化节点级 diff",
    inputSchema: {
      type: "object",
      properties: {
        runIdA: { type: "string", description: "运行 id（基准）" },
        runIdB: { type: "string", description: "运行 id（对比）" },
      },
      required: ["runIdA", "runIdB"],
    },
    handler: async (args, client) => {
      const runIdA = requireString(args, "runIdA");
      const runIdB = requireString(args, "runIdB");
      const [statsA, statsB, artsA, artsB] = await Promise.all([
        client.runStats(runIdA),
        client.runStats(runIdB),
        client.listArtifacts(runIdA),
        client.listArtifacts(runIdB),
      ]);
      return {
        runA: { runId: runIdA, stats: statsA },
        runB: { runId: runIdB, stats: statsB },
        statsDiff: diffStats(statsA, statsB),
        nodes: await compareArtifacts(artsA, artsB, client),
      };
    },
  },
];

/** Wait deadline / poll cadence for batch_run(wait=true). Exported for tests. */
export const BATCH_WAIT_TIMEOUT_MS = 30_000;
export const BATCH_POLL_INTERVAL_MS = 1_000;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

/** Run `fn` over items with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

const TERMINAL_STATUSES = new Set(["done", "failed", "halted", "cancelled"]);

function runStatus(body: Record<string, unknown>): { status: string; artifacts: Record<string, unknown[]> } {
  const state = (body.state ?? {}) as { status?: string; artifacts?: Record<string, unknown[]> };
  return { status: state.status ?? "unknown", artifacts: state.artifacts ?? {} };
}

/**
 * Poll all runIds until every one reaches a terminal status, or the deadline
 * passes (returning `completed: false` so the caller can degrade to polling).
 */
async function waitForRuns(
  client: AgentWorldClient,
  runIds: string[],
  timeoutMs: number,
  pollMs: number,
): Promise<{ completed: boolean; results: Array<Record<string, unknown>> }> {
  const results: Array<Record<string, unknown>> = [];
  const done = new Set<string>();
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    for (const runId of runIds) {
      if (done.has(runId)) continue;
      try {
        const body = await client.runState(runId);
        const { status, artifacts } = runStatus(body);
        if (TERMINAL_STATUSES.has(status)) {
          done.add(runId);
          const total = Object.values(artifacts).reduce((n, list) => n + list.length, 0);
          results.push({ runId, status, artifactCount: total });
        }
      } catch {
        done.add(runId);
        results.push({ runId, status: "error", artifactCount: 0 });
      }
    }
    if (done.size === runIds.length) return { completed: true, results };
    if (Date.now() >= deadline) return { completed: false, results };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function diffStats(
  a: { nodes: number; tokensIn: number; tokensOut: number; costUsd: number },
  b: { nodes: number; tokensIn: number; tokensOut: number; costUsd: number },
): Record<string, { a: number; b: number; delta: number }> {
  const diff = (x: number, y: number) => ({ a: x, b: y, delta: Math.round((y - x) * 1e6) / 1e6 });
  return {
    nodes: diff(a.nodes, b.nodes),
    tokensIn: diff(a.tokensIn, b.tokensIn),
    tokensOut: diff(a.tokensOut, b.tokensOut),
    costUsd: diff(a.costUsd, b.costUsd),
  };
}

function nodeIdOf(a: Record<string, unknown>): string {
  return String(a.nodeId ?? a.node_id ?? "");
}

function isTextLike(a: Record<string, unknown>): boolean {
  const mime = String(a.mimeType ?? "").toLowerCase();
  return /text|json|xml|markdown|javascript|svg/.test(mime);
}

/**
 * Group artifacts by node and diff the two runs: nodes present in only one run,
 * plus per-node artifact counts and (for text artifacts) content similarity.
 */
async function compareArtifacts(
  artsA: Array<Record<string, unknown>>,
  artsB: Array<Record<string, unknown>>,
  client: AgentWorldClient,
): Promise<{
  onlyInA: string[];
  onlyInB: string[];
  both: Array<Record<string, unknown>>;
}> {
  const byNodeA = new Map<string, Array<Record<string, unknown>>>();
  const byNodeB = new Map<string, Array<Record<string, unknown>>>();
  for (const a of artsA) {
    const id = nodeIdOf(a);
    if (!id) continue;
    byNodeA.set(id, [...(byNodeA.get(id) ?? []), a]);
  }
  for (const a of artsB) {
    const id = nodeIdOf(a);
    if (!id) continue;
    byNodeB.set(id, [...(byNodeB.get(id) ?? []), a]);
  }
  const idsA = new Set(byNodeA.keys());
  const idsB = new Set(byNodeB.keys());
  const onlyInA = [...idsA].filter((id) => !idsB.has(id)).sort();
  const onlyInB = [...idsB].filter((id) => !idsA.has(id)).sort();

  const both = await Promise.all(
    [...idsA]
      .filter((id) => idsB.has(id))
      .sort()
      .map(async (nodeId) => {
        const listA = byNodeA.get(nodeId) ?? [];
        const listB = byNodeB.get(nodeId) ?? [];
        const textA = listA.find(isTextLike);
        const textB = listB.find(isTextLike);
        let textSimilarity: number | undefined;
        if (textA && textB) {
          const [a, b] = await Promise.all([
            client.getArtifact(String(textA.id)).catch(() => null),
            client.getArtifact(String(textB.id)).catch(() => null),
          ]);
          if (a?.content !== undefined && b?.content !== undefined) {
            textSimilarity = textSimilarityOf(a.content, b.content);
          }
        }
        const countA = listA.length;
        const countB = listB.length;
        return {
          nodeId,
          artifactsInA: countA,
          artifactsInB: countB,
          artifactDelta: countB - countA,
          ...(textSimilarity !== undefined ? { textSimilarity } : {}),
          ...(countA !== countB ? { note: `产物数量不同（A:${countA} / B:${countB}）` } : {}),
        };
      }),
  );

  return { onlyInA, onlyInB, both };
}

/** Normalized bigram Dice coefficient in [0, 1] — cheap text similarity. */
function textSimilarityOf(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  const dice = (2 * shared) / (ga.size + gb.size);
  return Math.round(dice * 10_000) / 10_000;
}

/** Tool names that mutate state; hidden & rejected in readonly mode. */
const WRITE_TOOLS = new Set([
  "run_graph",
  "create_graph",
  "update_graph",
  "delete_graph",
  "cancel_run",
  "batch_run",
]);

/**
 * Filter tools for readonly mode (`AGENT_WORLD_MCP_READONLY=1`): only read-only
 * tools are exposed, write tools are dropped from `tools/list` entirely.
 */
export function filterTools(readonly: boolean): McpToolDef[] {
  return readonly ? TOOLS.filter((t) => !WRITE_TOOLS.has(t.name)) : TOOLS;
}
