import type { Graph, GraphEdge, GraphNode } from "@agent-world/core";

/** Flow descendants of `id` (excludes `id`). */
function descendants(graph: Graph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges) {
      if (e.kind !== "flow" || e.from !== cur || seen.has(e.to)) continue;
      seen.add(e.to);
      stack.push(e.to);
    }
  }
  return seen;
}

/** Flow ancestors of `id` (excludes `id`). */
function ancestors(graph: Graph, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges) {
      if (e.kind !== "flow" || e.to !== cur || seen.has(e.from)) continue;
      seen.add(e.from);
      stack.push(e.from);
    }
  }
  return seen;
}

/** The select node reconverging a fanout's lanes (first found downstream). */
function firstSelectDownstream(graph: Graph, fanoutId: string): string | null {
  for (const id of descendants(graph, fanoutId)) {
    if (graph.nodes.find((n) => n.id === id)?.kind === "select") return id;
  }
  return null;
}

/** Node ids strictly between a fanout and its select (exclusive). */
function laneIdsOf(graph: Graph, fanoutId: string, selectId: string): string[] {
  const down = descendants(graph, fanoutId);
  const up = ancestors(graph, selectId);
  return [...down].filter((id) => id !== fanoutId && id !== selectId && up.has(id));
}

/**
 * F10: auto-arrange a fanout's lanes into parallel, evenly spaced tracks. Lane
 * nodes are layered by BFS distance from the fanout (x = distance, y = track
 * index centered on the fanout), and the select node is pushed to the right.
 */
export function arrangeVariantLanes(graph: Graph, fanoutId: string): Graph {
  const fanout = graph.nodes.find((n) => n.id === fanoutId);
  if (!fanout) return graph;
  const selectId = firstSelectDownstream(graph, fanoutId);
  if (!selectId) return graph;

  const laneIds = new Set(laneIdsOf(graph, fanoutId, selectId));
  if (laneIds.size === 0) return graph;

  // BFS distance from the fanout, restricted to lane nodes.
  const dist = new Map<string, number>([[fanoutId, 0]]);
  const queue = [fanoutId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of graph.edges) {
      if (e.kind !== "flow" || e.from !== cur || !laneIds.has(e.to) || dist.has(e.to)) continue;
      dist.set(e.to, (dist.get(cur) ?? 0) + 1);
      queue.push(e.to);
    }
  }

  // Group lane nodes by layer (distance), preserving insertion order.
  const layers = new Map<number, string[]>();
  let maxLayer = 0;
  for (const id of laneIds) {
    const d = dist.get(id) ?? 0;
    maxLayer = Math.max(maxLayer, d);
    const bucket = layers.get(d);
    if (bucket) bucket.push(id);
    else layers.set(d, [id]);
  }

  const H_GAP = 260; // horizontal spacing between layers
  const V_GAP = 150; // vertical spacing between tracks within a layer
  const baseX = fanout.x + 260;

  const nodes = graph.nodes.map((n) => {
    if (n.id === selectId) {
      return { ...n, x: baseX + (maxLayer + 1) * H_GAP, y: fanout.y };
    }
    if (!laneIds.has(n.id)) return n;
    const d = dist.get(n.id) ?? 0;
    const layer = layers.get(d)!;
    const idx = layer.indexOf(n.id);
    const y = fanout.y + (idx - (layer.length - 1) / 2) * V_GAP;
    return { ...n, x: baseX + d * H_GAP, y };
  });

  return { ...graph, nodes };
}

/** Ids of lane nodes hidden by collapsed fanouts (F10 fold/expand). */
export function hiddenLaneNodeIds(
  graph: Graph,
  collapsedFans: Record<string, boolean>,
): Set<string> {
  const hidden = new Set<string>();
  for (const fanoutId of Object.keys(collapsedFans)) {
    if (!collapsedFans[fanoutId]) continue;
    const selectId = firstSelectDownstream(graph, fanoutId);
    if (!selectId) continue;
    for (const id of laneIdsOf(graph, fanoutId, selectId)) hidden.add(id);
  }
  return hidden;
}

/**
 * F10: duplicate a fanout's first lane structure `count - 1` times so every
 * variant has its own parallel branch (nodes + edges), each shifted vertically.
 * No-op when the fanout already fans out to more than one downstream node.
 */
export function duplicateLaneStructure(graph: Graph, fanoutId: string): Graph {
  const fanout = graph.nodes.find((n) => n.id === fanoutId);
  if (!fanout?.fanout) return graph;
  const count = fanout.fanout.count;
  if (count <= 1) return graph;
  const selectId = firstSelectDownstream(graph, fanoutId);
  if (!selectId) return graph;

  const direct = graph.edges.filter((e) => e.kind === "flow" && e.from === fanoutId).map((e) => e.to);
  if (direct.length > 1) return graph; // already duplicated

  const laneIds = laneIdsOf(graph, fanoutId, selectId);
  if (laneIds.length === 0) return graph;
  const laneSet = new Set(laneIds);

  const newNodes: GraphNode[] = [];
  const newEdges: GraphEdge[] = [];
  for (let i = 1; i < count; i++) {
    const offset = i * 160;
    const idMap = new Map<string, string>();
    for (const id of laneIds) {
      const n = graph.nodes.find((x) => x.id === id)!;
      const newId = `${id}-lane${i}`;
      idMap.set(id, newId);
      newNodes.push({ ...n, id: newId, name: `${n.name} #${i + 1}`, y: n.y + offset });
    }
    for (const e of graph.edges) {
      if (e.kind !== "flow" || !laneSet.has(e.from) || !laneSet.has(e.to)) continue;
      newEdges.push({ ...e, id: `${e.id}-lane${i}`, from: idMap.get(e.from)!, to: idMap.get(e.to)! });
    }
    for (const id of laneIds) {
      if (graph.edges.some((e) => e.kind === "flow" && e.from === fanoutId && e.to === id)) {
        newEdges.push({ id: `e-${fanoutId}-${idMap.get(id)!}`, from: fanoutId, to: idMap.get(id)!, kind: "flow" });
      }
      if (graph.edges.some((e) => e.kind === "flow" && e.from === id && e.to === selectId)) {
        newEdges.push({ id: `e-${idMap.get(id)!}-${selectId}`, from: idMap.get(id)!, to: selectId, kind: "flow" });
      }
    }
  }

  return { ...graph, nodes: [...graph.nodes, ...newNodes], edges: [...graph.edges, ...newEdges] };
}
