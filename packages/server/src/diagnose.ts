import { TextGenConfig, type Graph, type GraphNode, type RunEvent } from "@agent-world/core";
import { runAsUser, currentUserId } from "./user-context.js";
import { loadConfig } from "./config.js";
import type { Worker } from "./worker.js";

/** One failed node, distilled from the run's event log. */
export interface NodeFailure {
  nodeName: string;
  nodeKind: string;
  attempt: number;
  errorCode: string | null;
  error: string;
}

/** Everything the diagnosis prompt needs, independent of the database. */
export interface FailureInfo {
  graphName: string;
  status: string;
  trigger: string;
  failures: NodeFailure[];
  /** Compact, human-readable node lifecycle trail (most recent events kept). */
  trail: string[];
}

const MAX_TRAIL = 40;
const MAX_FAILURES = 10;
const MAX_ERROR_CHARS = 600;

/** Pull node identity out of a run snapshot, tolerating a corrupt snapshot. */
function nodeIndex(snapshot: unknown): Map<string, GraphNode> {
  const map = new Map<string, GraphNode>();
  try {
    const graph = snapshot as Graph | null;
    if (graph && Array.isArray(graph.nodes)) {
      for (const n of graph.nodes) map.set(n.id, n);
    }
  } catch {
    /* snapshot unreadable — fall back to raw node ids */
  }
  return map;
}

/**
 * Distil a failed run's event log + snapshot into the structured failure
 * information the LLM diagnosis is built from. Pure and deterministic so it
 * can be unit-tested without a database or provider.
 */
export function buildFailureInfo(input: {
  graphName: string;
  status: string;
  trigger: string;
  events: RunEvent[];
  snapshot: unknown;
}): FailureInfo {
  const nodes = nodeIndex(input.snapshot);
  const nameOf = (nodeId: string): GraphNode | undefined => nodes.get(nodeId);

  const failures: NodeFailure[] = [];
  const trail: string[] = [];

  for (const ev of input.events) {
    if (ev.type === "node.started") {
      const n = nameOf(ev.nodeId);
      trail.push(`▶ ${n?.name ?? ev.nodeId}`);
    } else if (ev.type === "node.finished") {
      const n = nameOf(ev.nodeId);
      trail.push(`✓ ${n?.name ?? ev.nodeId}`);
    } else if (ev.type === "node.failed") {
      const n = nameOf(ev.nodeId);
      const label = n?.name ?? ev.nodeId;
      const code = ev.errorCode ?? null;
      trail.push(`✗ ${label}${code ? ` [${code}]` : ""}`);
      failures.push({
        nodeName: label,
        nodeKind: n?.kind ?? "unknown",
        attempt: ev.attempt ?? 1,
        errorCode: code,
        error: ev.error.slice(0, MAX_ERROR_CHARS),
      });
    } else if (ev.type === "node.skipped") {
      const n = nameOf(ev.nodeId);
      trail.push(`⤼ ${n?.name ?? ev.nodeId}`);
    } else if (ev.type === "gate.exhausted") {
      trail.push("⊘ 质量门重试耗尽");
    } else if (ev.type === "power.tripped") {
      trail.push("⚡ 预算熔断");
    } else if (ev.type === "run.finished") {
      trail.push(`■ 运行结束（${ev.status}）`);
    }
  }

  // Keep the last occurrence of each failed node (final attempt wins).
  const deduped = new Map<string, NodeFailure>();
  for (const f of failures) deduped.set(f.nodeName, f);

  return {
    graphName: input.graphName,
    status: input.status,
    trigger: input.trigger,
    failures: [...deduped.values()].slice(-MAX_FAILURES),
    trail: trail.slice(-MAX_TRAIL),
  };
}

/** Build the Chinese diagnosis prompt. Server-side LLM prompt, not UI copy. */
export function buildDiagnosisPrompt(info: FailureInfo): string {
  const failureLines =
    info.failures.length > 0
      ? info.failures
          .map(
            (f) =>
              `- 节点「${f.nodeName}」（类型 ${f.nodeKind}）${f.errorCode ? `，错误码 ${f.errorCode}` : ""}：${f.error}`,
          )
          .join("\n")
      : "- 运行未到达任何节点的失败事件（可能是被中断、取消或启动失败）";

  return [
    "你是 Agent World 产线运行故障诊断专家。请根据下面一次运行的信息，判断最可能的根因，并给出用户可以直接照做的修复建议。",
    "",
    `产线名称：${info.graphName}`,
    `运行状态：${info.status}`,
    `触发方式：${info.trigger}`,
    "",
    "失败节点：",
    failureLines,
    "",
    "节点执行轨迹（按时间，→ 表示推进）：",
    info.trail.join(" → ") || "（无节点事件）",
    "",
    "请用简洁中文按以下结构输出，不要编造未提供的细节：",
    "1. 根因判断：一句话说明最可能的原因；",
    "2. 修复步骤：分条给出具体操作（精确到要修改哪个节点的什么配置，或需要补充什么外部条件）；",
    "3. 若是外部服务限流（HTTP 429）、鉴权失败（401/403）、超时或预算熔断等外部原因，请明确指出并说明是平台侧还是用户配置侧的问题。",
  ].join("\n");
}

/**
 * Run the failure diagnosis through the user's own model provider.
 * Runs inside the user's async context so the routing worker resolves their
 * saved provider keys; `model` can be injected for tests.
 */
export async function diagnoseRun(
  worker: Worker,
  userId: string,
  info: FailureInfo,
  opts: { model?: string } = {},
): Promise<{ diagnosis: string; model: string }> {
  const prompt = buildDiagnosisPrompt(info);
  let diagnosis = "";
  let model = opts.model ?? "";
  await runAsUser(userId, async () => {
    if (!model) model = (await loadConfig(currentUserId())).defaultModel;
    const node: GraphNode = {
      id: "diagnose",
      kind: "textGen",
      name: "failure-diagnose",
      x: 0,
      y: 0,
      textGen: TextGenConfig.parse({ model, prompt, temperature: 0.3 }),
    };
    const gen = worker.runTextGen({ node, config: node.textGen!, attempt: 1, input: prompt });
    let next = await gen.next();
    while (!next.done) next = await gen.next();
    diagnosis = next.value.output;
  });
  if (!diagnosis.trim()) throw new Error("诊断模型未返回内容");
  return { diagnosis, model };
}
