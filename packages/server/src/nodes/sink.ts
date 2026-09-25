import { incoming, type GraphNode, type NodeKind } from "@agent-world/core";
import type { NodeRunContext } from "./types.js";
import { setTextArtifact, zeroUsage } from "./shared.js";

/**
 * Kinds whose `node.finished` text output is metadata or empty because the
 * product is not text: branch emits only a routing notice, a gate approved by
 * a human carries no verdict reason, and media nodes produce artifacts instead
 * of text. A sink fed ONLY by these receives an empty string structurally —
 * "route/produce, then end" — which is not a broken upstream. Measured
 * 2026-09-25 across the resume/degraded suites: branch ×7, gate ×3,
 * videoGen ×1 (the un-narrowed guard turned exactly those runs from done into
 * failed; see PR #429's CI run 36125520374).
 */
const NON_TEXT_PRODUCER: ReadonlySet<NodeKind> = new Set([
  "branch",
  "gate",
  "videoGen",
  "imageGen",
  "audioGen",
]);

/**
 * Sink node execution body (migrated from engine.ts runScheduler).
 * Behaviour is byte-identical to the former closure; shared scheduler state
 * arrives via the explicit NodeRunContext.
 */
export async function sinkNode(ctx: NodeRunContext, node: GraphNode, nodeId: string, attempt: number): Promise<void> {
  const { artifacts, emit, inputFor, produceArtifacts, sendPackets, states, graph } = ctx;
  const output = await inputFor(node);
  if (!output.trim()) {
    // 上游为空时终点不该静默产出一件空「成品」。但"空"有两种，处置不同：
    // ① 结构性为空——直接上游全部是不产正文的节点（分支/媒体），这是
    //    「路由/产出后收尾」的设计形状：节点照常 done（时间线/恢复语义不变），
    //    但**不归档**——没有正文就不进成品库、不发包；
    // ② 真故障——存在内容型上游却产出空（文该有而没有）：记 failed +
    //    VALIDATION，让错误边缘/页面能看到原因。
    // graph 缺席（部分单测只给最小 ctx）时无法分类，保守按故障处理。
    const structural =
      graph != null &&
      (() => {
        const upstreams = incoming(graph, nodeId, "flow");
        return (
          upstreams.length > 0 &&
          upstreams.every((e) => {
            const kind = graph.nodes.find((n) => n.id === e.from)?.kind;
            return kind != null && NON_TEXT_PRODUCER.has(kind);
          })
        );
      })();
    if (structural) {
      // 路由/媒体终点：确认收尾但不归档——没有正文就不进成品库、不往外发包，
      // 否则成品库里会躺着一件永远打不开的空「成品」。
      states.set(nodeId, "done");
      emit({ type: "node.started", nodeId, attempt });
      emit({ type: "node.finished", nodeId, attempt, output: "", usage: zeroUsage() });
      return;
    }
    states.set(nodeId, "failed");
    emit({
      type: "node.failed",
      nodeId,
      attempt,
      error: "成品库节点没有收到可整理的文本",
      errorCode: "VALIDATION",
    });
    return;
  }
  setTextArtifact(artifacts, nodeId, output);
  states.set(nodeId, "done");
  emit({ type: "node.started", nodeId, attempt });
  emit({ type: "node.finished", nodeId, attempt, output, usage: zeroUsage() });
  produceArtifacts(nodeId, output, attempt);
  sendPackets(nodeId, output.slice(0, 120), "text");
  return;
}
