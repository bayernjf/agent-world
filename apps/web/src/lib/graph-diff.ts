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

/**
 * Minimum length (either side, in characters) of a string field before the
 * version diff switches from whole-value old → new to inline highlighting.
 */
export const INLINE_DIFF_MIN_CHARS = 40;

/** One token-level segment of an inline free-text diff. */
export interface TextDiffSegment {
  type: "equal" | "added" | "removed";
  text: string;
}

/**
 * Split free text into diff tokens: latin words / numbers stay whole (so an
 * English prompt diffs by word), whitespace runs stay intact, and every other
 * character (CJK has no inter-word spaces) is its own token.
 */
function tokenizeText(s: string): string[] {
  return s.match(/[A-Za-z0-9_]+|\s+|./g) ?? [];
}

/**
 * Inline (word/character-level) diff for long free-text fields such as prompts.
 * English changes are highlighted by word, Chinese changes by character, and
 * adjacent same-kind segments are merged. Very large inputs (rare; prompts are
 * short) fall back to whole-delete + whole-insert to keep the O(n*m) LCS bounded.
 */
export function diffText(before: string, after: string): TextDiffSegment[] {
  const MAX_TOKENS = 4000;
  const a = tokenizeText(before);
  const b = tokenizeText(after);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    const out: TextDiffSegment[] = [];
    if (before) out.push({ type: "removed", text: before });
    if (after) out.push({ type: "added", text: after });
    return out;
  }

  // LCS length table over tokens, built bottom-up.
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  // Backtrack into raw segments. Ties report the removal first (deterministic).
  const raw: TextDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: "equal", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      raw.push({ type: "removed", text: a[i]! });
      i++;
    } else {
      raw.push({ type: "added", text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    raw.push({ type: "removed", text: a[i]! });
    i++;
  }
  while (j < m) {
    raw.push({ type: "added", text: b[j]! });
    j++;
  }

  // Merge adjacent same-type segments.
  const merged: TextDiffSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === seg.type) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}
