import { randomUUID } from "node:crypto";
import { compile, type Graph } from "@agent-world/core";
import { openDb } from "./db.js";
import { execute } from "./engine.js";
import { dispatchGate } from "./dispatch-gate.js";
import { loadConfig } from "./config.js";
import { resolveModelSlots } from "./model-slots.js";
import { drainRun, RunStartError } from "./run.js";
import { validateModels } from "./validate-models.js";
import { log } from "./logger.js";
import type { ArtifactStore } from "./artifact-store.js";
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
    /** 媒体产物落库（storeBinary）。实验也会出图/出视频，不给就没有产物。 */
    artifacts: ArtifactStore;
    /** 产物 URI 绝对化，与 startRun 同一口径。 */
    publicUrl?: string;
  },
): Promise<{ abGroup: string; arms: Array<{ arm: string; runId: string; prompt: string }> }> {
  const abGroup = randomUUID();
  // A/B 不经 startRun，所以「跟随当前默认」的解析要在这里自己做一遍：否则一条
  // 模板产线（节点 model 为空）进了实验，快照里存的还是空串，评测 byPrompt 指纹
  // 会把换内置默认前后的 run 并进同一个版本。顺带把 defaultModel 真正传给引擎——
  // 以前没传，引擎落到 engine.ts:1653 那个 `?? "agnes-2.0-flash"` 字面量上，
  // 等于实验永远用写死的模型跑，与用户配置的默认无关。
  const cfg = await loadConfig(opts.userId);
  // buildABVariants deep-clones the source per arm, so resolving once here is
  // enough — every variant inherits the filled-in names.
  const built = buildABVariants(resolveModelSlots(opts.graph, cfg), opts.targetNodeId, opts.variants);
  // 模型可派发性兜底：AB 不经 startRun，run.ts 里那条 422 兜底覆盖不到这里；
  // 不补的话媒体节点模型配错会软跳过（run 报 done、无产物），实验白跑还占配额。
  // 一次实验 N 条 arm 共享同一份模型字段（buildABVariants 只替换 prompt），验一份即可。
  const modelErrors = validateModels(built[0]!.graph, cfg).filter((d) => d.severity === "error");
  if (modelErrors.length > 0) {
    throw new RunStartError(
      `${modelErrors.length} 个节点未配置可用模型：${modelErrors.map((d) => d.message).join("；")}`,
      422,
      modelErrors,
    );
  }
  // 一次实验会建 N 条 run，闸门按「这一次用户动作」评估一次就够：放在循环里会让
  // 第一条 arm 的活跃 run 把后面的 arm 按并发超额拦掉。ab.ts 不经 startRun，
  // 所以要显式补，否则实验是绕过配额的一条路。
  await dispatchGate({ db, graph: opts.graph, userId: opts.userId, trigger: "ab" });
  const arms: Array<{ arm: string; runId: string; prompt: string }> = [];

  for (const { arm, graph } of built) {
    const { plan } = compile(graph);
    if (!plan) throw new Error(`A/B 变体 ${arm} 未通过编译`);
    const runId = randomUUID();
    const startedAt = Date.now();
    const targetNode = graph.nodes.find((n) => n.id === opts.targetNodeId)!;
    const prompt = targetNode.textGen!.prompt;

    await db.createRun({
      id: runId,
      userId: opts.userId,
      graph,
      budgetUsd: opts.budgetUsd ?? null,
      at: startedAt,
      trigger: "ab",
      input: opts.input ?? "",
      abGroup,
      abArm: arm,
      abTarget: opts.targetNodeId,
    });

    // 与 startRun / resumeRun / forkRun 共用 drainRun：合规词表、用户技能、搜索
    // 配置、媒体落库、月度预算、G4 远程任务、子流程、用量归集、告警、指标一次配齐。
    // 此前这一条路只传了 defaultModel/budget，等于实验绕过了所有这些跨切面——
    // 合规词不生效、媒体产物不入库、用量不进账，而 run 照样报 done。
    // 图变量刻意不回写（persistVariables:false）：N 条 arm 并发写同一份跨 run 状态
    // 会互相覆盖，也会把实验状态写进产线的正式状态。
    void drainRun({
      db,
      artifacts: opts.artifacts,
      userId: opts.userId,
      graph,
      runId,
      startedAt,
      budgetUsd: opts.budgetUsd ?? null,
      plan,
      worker,
      runLog: log.child({ runId, graphId: graph.id, abGroup, arm }),
      signal: opts.signal,
      publicUrl: opts.publicUrl,
      spawn: (c) => execute({ ...c, input: opts.input ?? "" }),
      crashMessage: "ab run crashed",
      persistVariables: false,
    });

    arms.push({ arm, runId, prompt });
  }

  return { abGroup, arms };
}
