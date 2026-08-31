import { randomUUID } from "node:crypto";
import { compile, type Graph } from "@agent-world/core";
import { openDb } from "./db.js";
import { execute } from "./engine.js";
import type { Worker } from "./worker.js";

type DB = ReturnType<typeof openDb>;

export interface ABVariant {
  /** Arm label, e.g. "A", "B", "C". */
  arm: string;
  graph: Graph;
}

/**
 * Clones the graph once per variant and substitutes the target agent node's
 * prompt. The original graph is never mutated. Throws if the target is missing
 * or is not an agent (factory) node.
 */
export function buildABVariants(graph: Graph, targetNodeId: string, variants: string[]): ABVariant[] {
  return variants.map((variant, i) => {
    const arm = String.fromCharCode(65 + (i % 26));
    const g = JSON.parse(JSON.stringify(graph)) as Graph;
    const node = g.nodes.find((n) => n.id === targetNodeId);
    if (!node) throw new Error(`A/B 目标节点不存在：${targetNodeId}`);
    if (node.kind !== "textGen") {
      throw new Error(`A/B 目标必须是厂房(agent)节点，但「${node.name}」是 ${node.kind} 节点`);
    }
    node.textGen!.prompt = variant;
    return { arm, graph: g };
  });
}

/**
 * Launches an A/B experiment: each variant is compiled into its own run, tagged
 * with a shared ab_group and a per-arm ab_arm, then executed in the background.
 * Returns the group id and the per-arm run ids so the caller can poll results.
 */
export async function startABExperiment(
  db: DB,
  worker: Worker,
  opts: {
    userId: string;
    graph: Graph;
    targetNodeId: string;
    variants: string[];
    budgetUsd?: number | null;
    input?: string;
    signal?: AbortSignal;
  },
): Promise<{ abGroup: string; arms: Array<{ arm: string; runId: string; prompt: string }> }> {
  const abGroup = randomUUID();
  const built = buildABVariants(opts.graph, opts.targetNodeId, opts.variants);
  const arms: Array<{ arm: string; runId: string; prompt: string }> = [];

  for (const { arm, graph } of built) {
    const { plan } = compile(graph);
    if (!plan) throw new Error(`A/B 变体 ${arm} 未通过编译`);
    const runId = randomUUID();
    const targetNode = graph.nodes.find((n) => n.id === opts.targetNodeId)!;
    const prompt = targetNode.textGen!.prompt;

    db.createRun({
      id: runId,
      userId: opts.userId,
      graph,
      budgetUsd: opts.budgetUsd ?? null,
      at: Date.now(),
      trigger: "ab",
      input: opts.input ?? "",
      abGroup,
      abArm: arm,
      abTarget: opts.targetNodeId,
    });

    void (async () => {
      try {
        for await (const event of execute({
          runId,
          graph,
          plan,
          worker,
          input: opts.input ?? "",
          budgetUsd: opts.budgetUsd ?? null,
          signal: opts.signal,
        })) {
          db.record(runId, event);
          if (event.type === "run.finished") db.finishRun(runId, opts.userId, event.status, Date.now());
        }
      } catch {
        db.finishRun(runId, opts.userId, "failed", Date.now());
      }
    })();

    arms.push({ arm, runId, prompt });
  }

  return { abGroup, arms };
}
