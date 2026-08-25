import {
  incoming,
  nodeById,
  outgoing,
  type Graph,
  type GraphEdge,
} from "./graph.js";

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ReworkLoop {
  gateId: string;
  edge: GraphEdge;
  /** Entry node the rework edge lands on. */
  entryId: string;
  /** Nodes re-run on a failed verdict, in topological order. */
  body: string[];
  maxAttempts: number;
}

export interface Plan {
  graphId: string;
  /** Forward execution order, ignoring rework edges. */
  order: string[];
  loops: ReworkLoop[];
}

export interface CompileResult {
  plan: Plan | null;
  diagnostics: Diagnostic[];
}

/** Topological order over flow edges only. Returns null when a flow cycle exists. */
function topoSort(graph: Graph): string[] | null {
  const indeg = new Map<string, number>();
  for (const n of graph.nodes) indeg.set(n.id, 0);
  const flow = graph.edges.filter((e) => e.kind === "flow");
  for (const e of flow) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);

  const queue = graph.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of flow) {
      if (e.from !== id) continue;
      const left = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, left);
      if (left === 0) queue.push(e.to);
    }
  }
  return order.length === graph.nodes.length ? order : null;
}

/** Find one cycle made of flow edges and return the node ids on it. */
function findFlowCycle(graph: Graph): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of graph.nodes) color.set(n.id, WHITE);
  const parent = new Map<string, string | null>();

  const dfs = (start: string): string[] | null => {
    const stack: { id: string; i: number }[] = [{ id: start, i: 0 }];
    color.set(start, GRAY);
    parent.set(start, null);
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const outs = graph.edges.filter((e) => e.kind === "flow" && e.from === frame.id);
      if (frame.i < outs.length) {
        const next = outs[frame.i++]!.to;
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) {
          const cycle = [next];
          let cur: string | undefined = frame.id;
          while (cur && cur !== next) {
            cycle.push(cur);
            cur = parent.get(cur) ?? undefined;
          }
          cycle.push(next);
          return cycle.reverse();
        }
        if (c === WHITE) {
          color.set(next, GRAY);
          parent.set(next, frame.id);
          stack.push({ id: next, i: 0 });
        }
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
      }
    }
    return null;
  };

  for (const n of graph.nodes) {
    if (color.get(n.id) === WHITE) {
      const cycle = dfs(n.id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** Ancestors of `id` following flow edges backwards. */
function ancestorsOf(graph: Graph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of incoming(graph, cur, "flow")) {
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      stack.push(e.from);
    }
  }
  return seen;
}

export function compile(graph: Graph): CompileResult {
  const diagnostics: Diagnostic[] = [];

  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) {
      diagnostics.push({ severity: "error", message: `Duplicate node id "${n.id}"`, nodeId: n.id });
    }
    ids.add(n.id);
  }

  for (const e of graph.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      diagnostics.push({ severity: "error", message: "Edge references a missing plant", edgeId: e.id });
    }
    if (e.from === e.to) {
      diagnostics.push({ severity: "error", message: "A plant cannot feed itself", edgeId: e.id });
    }
  }

  if (!graph.nodes.some((n) => n.kind === "source")) {
    diagnostics.push({ severity: "error", message: "The line needs an intake" });
  }
  if (!graph.nodes.some((n) => n.kind === "sink")) {
    diagnostics.push({ severity: "warning", message: "Nothing collects the output — add a depot" });
  }

  const order = topoSort(graph);
  if (!order) {
    const cycle = findFlowCycle(graph);
    const names = cycle
      ?.map((id) => graph.nodes.find((n) => n.id === id)?.name ?? id)
      .join(" → ");
    diagnostics.push({
      severity: "error",
      message: names
        ? `正向管道形成了环（${names}）。需要往回传的工作请用质检站引出的「返工线」，不要用普通连线。`
        : "正向管道形成了环。需要往回传的工作请用质检站引出的「返工线」，不要用普通连线。",
    });
  }

  const loops: ReworkLoop[] = [];
  for (const e of graph.edges) {
    if (e.kind !== "rework") continue;

    const gate = nodeById(graph, e.from);
    if (gate && gate.kind !== "gate") {
      diagnostics.push({
        severity: "error",
        message: "Only a gate can start a rework line",
        edgeId: e.id,
      });
      continue;
    }
    if (!order) continue;

    const ancestors = ancestorsOf(graph, e.from);
    if (!ancestors.has(e.to)) {
      diagnostics.push({
        severity: "error",
        message: "A rework line must run back to a plant upstream of the gate",
        edgeId: e.id,
      });
      continue;
    }

    const rank = new Map(order.map((id, i) => [id, i]));
    const lo = rank.get(e.to)!;
    const hi = rank.get(e.from)!;
    const body = order.filter((id) => {
      const r = rank.get(id)!;
      return r >= lo && r <= hi && (id === e.to || ancestors.has(id) || id === e.from);
    });

    loops.push({
      gateId: e.from,
      edge: e,
      entryId: e.to,
      body,
      maxAttempts: gate?.gate?.maxAttempts ?? 3,
    });
  }

  for (const n of graph.nodes) {
    if (n.kind !== "gate") continue;
    if (outgoing(graph, n.id, "rework").length === 0) {
      diagnostics.push({
        severity: "warning",
        message: `Gate "${n.name}" has no rework line, so failures cannot be retried`,
        nodeId: n.id,
      });
    }
  }

  const fatal = diagnostics.some((d) => d.severity === "error");
  return {
    plan: fatal || !order ? null : { graphId: graph.id, order, loops },
    diagnostics,
  };
}
