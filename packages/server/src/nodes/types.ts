import type { Artifact, DraftEvent, Graph, GraphNode, Plan, RunEvent } from "@agent-world/core";
import type { Worker } from "../worker.js";
import type { NodeState, SchedulerInit, SchedulerOptions, Status } from "../engine.js";

/**
 * Explicit execution context handed to node execution bodies in nodes/*.ts.
 *
 * Stage 2.1 of the engine refactor left the node bodies as closures inside
 * `runScheduler`, capturing ~40 shared locals implicitly. This interface makes
 * that state explicit: the scheduler builds one `NodeRunContext` per run and
 * passes it to every node handler, so the handlers can live in separate files
 * without importing the engine (no module cycles).
 *
 * Mutable scheduler scalars (`status`, `running`, …) are exposed through
 * getter/setter properties wired to the scheduler's locals, so both the
 * scheduler core (bare identifiers) and node handlers (`ctx.status`) read and
 * write the same state.
 */
export interface NodeRunContext {
  // --- scheduler options & derived values ---
  opts: SchedulerOptions;
  runId: string;
  graph: Graph;
  plan: Plan;
  worker: Worker;
  budgetUsd: number | null;
  fallbackModel: string;
  monthlyBudgetUsd: number | null;
  monthSpentUsd: number;
  /** Tools approved for execution this run (dangerous-action halt). */
  approved: Set<string>;

  // --- shared mutable maps (by reference) ---
  artifacts: Map<string, Artifact[]>;
  attempts: Map<string, number>;
  nodeCostUsd: Map<string, number>;
  states: Map<string, NodeState>;
  /** Last failure recorded per node, so error edges can carry the cause. */
  lastError: Map<string, { error: string; errorCode?: string }>;
  /** Rework feedback notes keyed by node id (gate rework edges). */
  reworkNotes: Map<string, string>;
  /** Loop plan by gate node id. */
  loopByGate: Map<string, Plan["loops"][number]>;
  /** Per-node loop-item context set while a loop body executes. */
  loopItemByNode: Map<string, unknown>;
  /** Graph variables (cross-run persisted state, shared with sub-runs). */
  variables: Map<string, unknown>;
  /** Response metadata of http nodes (ok/status/url/method). */
  httpMeta: Map<string, Record<string, unknown>>;
  /** Flow edges that actually carried a packet this run. */
  packetEdges: Set<string>;

  // --- mutable scheduler scalars (getter/setter wired to runScheduler locals) ---
  status: Status;
  running: number;
  aborted: boolean;
  finished: boolean;
  haltNodeId: string | undefined;
  haltReason: string | undefined;
  totalCostUsd: number;

  // --- shared operations (scheduler closures) ---
  emit: (e: DraftEvent) => RunEvent;
  inputFor: (node: GraphNode, includeNote?: boolean) => Promise<string>;
  nodeCtx: (nodeId: string) => Record<string, unknown>;
  interpCtx: (nodeId: string) => Record<string, unknown>;
  sendPackets: (nodeId: string, summary: string, artifactKind?: Artifact["kind"]) => void;
  artifactValue: (id: string) => unknown;
  produceArtifacts: (nodeId: string, output: string, attempt?: number) => Artifact["kind"];
  markBranchSkipped: (branchId: string, routedTarget?: string) => void;
  extractSubInit: (prefix: string, childGraph: Graph) => SchedulerInit | null;
  mergeSubInit: (prefix: string, childInit: SchedulerInit) => void;
  finish: () => void;

  // --- recursion entry points (subprocess/fanout spawn child schedulers, loop relaunches nodes) ---
  scheduler: (opts: SchedulerOptions) => Promise<AsyncGenerator<RunEvent>>;
  runNode: (nodeId: string) => Promise<void>;
}

/** Standard handler signature for node execution bodies in nodes/*.ts. */
export type NodeHandler = (
  ctx: NodeRunContext,
  node: GraphNode,
  nodeId: string,
  attempt: number,
) => Promise<void>;
