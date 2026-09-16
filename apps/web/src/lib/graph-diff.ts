import type { Graph, GraphNode } from "@agent-world/core";

/** A single leaf-level value change. */
export interface FieldChange {
  /** Dot-separated path inside the node, e.g. `textGen.model` or `x`. */
  path: string;
  before: unknown;
  after: unknown;
}

export interface NodeDelta {
  id: string;
  name: string;
  kind: string;
  changes: FieldChange[];
}

export interface EdgeDelta {
  from: string;
  to: string;
  edgeKind: string;
}

export interface GraphDiff {
  nodesAdded: GraphNode[];
  nodesRemoved: GraphNode[];
  nodesChanged: NodeDelta[];
  edgesAdded: EdgeDelta[];
  edgesRemoved: EdgeDelta[];
  triggersChanged: boolean;
  variablesChanged: boolean;
  /** True when the two graphs are byte-for-byte equivalent in structure. */
  identical: boolean;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively collect leaf-level differences between two JSON values. */
function deepDiff(before: unknown, after: unknown, path: string, out: FieldChange[]): void {
  if (before === after) return;
  // NaN-safe / primitive comparison (also covers null vs undefined gaps).
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      deepDiff(before[key], after[key], childPath, out);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    // Node config arrays (e.g. steps, tools) are compared positionally up to
    // the longer length; a changed length naturally surfaces as leaf diffs.
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i++) {
      deepDiff(before[i], after[i], `${path}[${i}]`, out);
    }
    return;
  }
  out.push({ path: path || "(root)", before, after });
}

const edgeKey = (e: { from: string; to: string; kind: string }) =>
  `${e.from}→${e.to}:${e.kind}`;

/**
 * Compute a structural diff between two graph snapshots.
 * Nodes are matched by id, edges by (from, to, kind).
 */
export function diffGraphs(base: Graph, target: Graph): GraphDiff {
  const baseNodes = new Map(base.nodes.map((n) => [n.id, n]));
  const targetNodes = new Map(target.nodes.map((n) => [n.id, n]));

  const nodesAdded: GraphNode[] = [];
  const nodesRemoved: GraphNode[] = [];
  const nodesChanged: NodeDelta[] = [];

  for (const [id, tn] of targetNodes) {
    const bn = baseNodes.get(id);
    if (!bn) {
      nodesAdded.push(tn);
      continue;
    }
    const changes: FieldChange[] = [];
    // Compare every field the node carries (kind/name/x/y + per-kind config).
    const keys = new Set([...Object.keys(bn), ...Object.keys(tn)]);
    keys.delete("id");
    for (const key of keys) {
      deepDiff((bn as Record<string, unknown>)[key], (tn as Record<string, unknown>)[key], key, changes);
    }
    if (changes.length) nodesChanged.push({ id, name: tn.name, kind: tn.kind, changes });
  }
  for (const [id, bn] of baseNodes) {
    if (!targetNodes.has(id)) nodesRemoved.push(bn);
  }

  const baseEdges = new Map(base.edges.map((e) => [edgeKey(e), e]));
  const targetEdges = new Map(target.edges.map((e) => [edgeKey(e), e]));
  const edgesAdded: EdgeDelta[] = [];
  const edgesRemoved: EdgeDelta[] = [];
  for (const [key, e] of targetEdges) {
    if (!baseEdges.has(key)) edgesAdded.push({ from: e.from, to: e.to, edgeKind: e.kind });
  }
  for (const [key, e] of baseEdges) {
    if (!targetEdges.has(key)) edgesRemoved.push({ from: e.from, to: e.to, edgeKind: e.kind });
  }

  const triggersChanged =
    JSON.stringify(base.triggers ?? []) !== JSON.stringify(target.triggers ?? []);
  const variablesChanged =
    JSON.stringify(base.variables ?? {}) !== JSON.stringify(target.variables ?? {});

  const identical =
    nodesAdded.length === 0 &&
    nodesRemoved.length === 0 &&
    nodesChanged.length === 0 &&
    edgesAdded.length === 0 &&
    edgesRemoved.length === 0 &&
    !triggersChanged &&
    !variablesChanged;

  return {
    nodesAdded,
    nodesRemoved,
    nodesChanged,
    edgesAdded,
    edgesRemoved,
    triggersChanged,
    variablesChanged,
    identical,
  };
}

/** Render a JSON-ish value compactly for the diff view. */
export function formatDiffValue(v: unknown): string {
  if (v === undefined) return "∅";
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 77)}...` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}
