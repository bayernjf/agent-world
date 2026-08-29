/**
 * Variable interpolation and light expression evaluation for node configs.
 *
 * Phase 1 P0 introduces dataflow variables: any string field in a node config
 * can reference upstream node outputs with `${nodeId}` or `${nodeId.path}`.
 * The engine builds a context map from upstream artifacts and resolves these
 * placeholders before the node runs.
 */

function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(/\.(?![^\[]*\])/); // naive dot split, supports brackets later
  let cur = obj;
  for (const part of parts) {
    const m = part.match(/^([^\[]+)\[(\d+)]$/);
    if (m) {
      const key = m[1]!;
      const idx = Number(m[2]);
      const container = (cur as Record<string, unknown> | undefined)?.[key];
      cur = Array.isArray(container) ? container[idx] : undefined;
    } else {
      cur = (cur as Record<string, unknown> | undefined)?.[part];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

function primaryValue(nodeValue: unknown): unknown {
  if (nodeValue === null || nodeValue === undefined) return "";
  if (typeof nodeValue === "string") return nodeValue;
  if (typeof nodeValue === "number" || typeof nodeValue === "boolean") return String(nodeValue);
  if (Array.isArray(nodeValue)) return nodeValue.map((v) => primaryValue(v)).join("\n");
  if (typeof nodeValue === "object") {
    const obj = nodeValue as Record<string, unknown>;
    if ("content" in obj) return primaryValue(obj.content);
    return JSON.stringify(nodeValue);
  }
  return String(nodeValue);
}

/**
 * Resolve a simple expression like `nodeId` or `nodeId.field[0].name` against
 * the provided context. Returns undefined when the path is missing.
 */
export function resolveExpression(
  expr: string,
  context: Record<string, unknown>,
): unknown {
  const [head, ...rest] = expr.split(/\.(?![^\[]*\])/);
  if (!head) return undefined;
  let value = context[head];
  if (value === undefined) return undefined;
  if (rest.length > 0) {
    value = getByPath(value, rest.join("."));
  }
  return value;
}

/**
 * Replace `${expr}` placeholders in a template string.
 * Missing values become empty strings.
 */
export function evaluateTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\$\{\s*([^}]+)\s*\}/g, (_, raw: string) => {
    const expr = raw.trim();
    const value = resolveExpression(expr, context);
    return value === undefined ? "" : String(primaryValue(value));
  });
}

/**
 * Build a variable context for a node from the upstream artifact map.
 * - Each upstream node's id maps to its primary value.
 * - For JSON artifacts, the parsed object is exposed (so `${nodeId.field}` works).
 */
export function buildNodeContext(
  nodeId: string,
  artifacts: Map<string, import("./artifact.js").Artifact[]>,
  graph: { nodes: { id: string }[]; edges: { from: string; to: string; kind: string }[] },
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  const flowIn = graph.edges.filter((e) => e.to === nodeId && e.kind === "flow");
  for (const edge of flowIn) {
    const arts = artifacts.get(edge.from) ?? [];
    const jsonArt = arts.find((a) => a.kind === "json");
    const textArt = arts.find((a) => a.kind === "text");
    if (jsonArt && jsonArt.content) {
      try {
        ctx[edge.from] = JSON.parse(jsonArt.content);
      } catch {
        ctx[edge.from] = jsonArt.content;
      }
    } else if (textArt) {
      ctx[edge.from] = textArt.content ?? "";
    } else {
      ctx[edge.from] = "";
    }
  }
  return ctx;
}
