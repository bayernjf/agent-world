/**
 * Derive a read-only state-machine view from graphs built with the
 * "state as graph variables + branch routing" pattern (see deferred-items
 * "状态机节点", plan A). A branch rule such as
 *
 *   when: "${var.orderState} == 'paid'"   target: "ship"
 *
 * is a state transition: state variable `orderState` equals `paid` → plant
 * `ship`. This module extracts those transitions statically so the canvas can
 * render the state flow explicitly without introducing any new execution
 * semantics — the engine still runs plain variables + branch nodes.
 *
 * Only equality comparisons (`==` / `===`) describe "entering a state", so
 * `!=` / `!==` / ordering operators are intentionally ignored.
 */
import type { Graph } from "./graph.js";
import { nodeById } from "./graph.js";

export interface StateTransition {
  variable: string;
  branchNodeId: string;
  branchName: string;
  ruleId: string;
  /** Literal state value compared for equality, e.g. "paid" / 3 / true. */
  value: unknown;
  targetNodeId: string;
  targetName: string;
}

export interface StateMachineView {
  variable: string;
  /** Distinct literal equality values compared against this variable, first-seen. */
  values: unknown[];
  /** Declared initial value from `graph.variables`, when present. */
  initial: unknown;
  hasDeclaration: boolean;
  transitions: StateTransition[];
}

const STRING_LIT = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;
const OTHER_LIT = String.raw`true|false|null|-?\d+(?:\.\d+)?`;
const LITERAL = `(?:${STRING_LIT}|${OTHER_LIT})`;
const VAR_HEAD = String.raw`[A-Za-z_$][\w$]*`;

/** Parse a condition literal token (quoted string / number / boolean / null). */
function parseLiteral(raw: string): unknown {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const quote = s[0];
  if ((quote === "'" || quote === '"') && s[s.length - 1] === quote) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return s;
}

/** Equality pairs found in one `when` expression: [variable, literalRaw]. */
function equalityPairs(when: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  // ${var.x} == literal  (also ===)
  const forward = new RegExp(
    String.raw`\$\{\s*var\.(${VAR_HEAD})\s*\}\s*(?:===|==)\s*(${LITERAL})`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = forward.exec(when))) pairs.push([m[1]!, m[2]!]);
  // literal == ${var.x}
  const reverse = new RegExp(
    String.raw`(${LITERAL})\s*(?:===|==)\s*\$\{\s*var\.(${VAR_HEAD})\s*\}`,
    "g",
  );
  while ((m = reverse.exec(when))) pairs.push([m[2]!, m[1]!]);
  return pairs;
}

function valueKey(v: unknown): string {
  return typeof v === "string" ? `s:${v}` : `j:${JSON.stringify(v)}`;
}

/**
 * Extract per-state-variable transition views from every branch node in the
 * graph. Variables appear in first-reference order; an empty array means the
 * graph does not use the state-variable routing pattern.
 */
export function deriveStateMachine(graph: Graph): StateMachineView[] {
  const views = new Map<string, StateMachineView>();
  const seen = new Map<string, Set<string>>();

  const ensure = (variable: string): StateMachineView => {
    let view = views.get(variable);
    if (!view) {
      const hasDeclaration = graph.variables != null && variable in graph.variables;
      view = {
        variable,
        values: [],
        initial: graph.variables?.[variable],
        hasDeclaration,
        transitions: [],
      };
      views.set(variable, view);
      seen.set(variable, new Set());
    }
    return view;
  };

  for (const n of graph.nodes) {
    if (n.kind !== "branch" || !n.branch) continue;
    for (const rule of n.branch.rules ?? []) {
      for (const [variable, litRaw] of equalityPairs(rule.when ?? "")) {
        const view = ensure(variable);
        const value = parseLiteral(litRaw);
        const key = valueKey(value);
        if (!seen.get(variable)!.has(key)) {
          seen.get(variable)!.add(key);
          view.values.push(value);
        }
        const dest = nodeById(graph, rule.target);
        view.transitions.push({
          variable,
          branchNodeId: n.id,
          branchName: n.name,
          ruleId: rule.id,
          value,
          targetNodeId: rule.target,
          targetName: dest?.name ?? rule.target,
        });
      }
    }
  }

  return [...views.values()];
}
