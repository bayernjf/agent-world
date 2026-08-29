/**
 * Variable interpolation and light expression evaluation for node configs.
 *
 * Phase 1 P0 introduces dataflow variables: any string field in a node config
 * can reference upstream node outputs with `${nodeId}` or `${nodeId.path}`.
 * The engine builds a context map from upstream artifacts and resolves these
 * placeholders before the node runs.
 */

export function getByPath(obj: unknown, path: string): unknown {
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

/**
 * Recursively transform a JSON template: string values get `${...}` placeholders
 * resolved against `ctx`. A string that is a *pure* placeholder (e.g.
 * `"${item.address}"`) keeps the referenced type — objects, arrays, numbers and
 * booleans are embedded as-is — so whole fields can be carried over without
 * double-encoding. All other strings go through `evaluateTemplate`.
 */
export function transformJson(node: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof node === "string") {
    const pure = node.match(/^\$\{\s*([^}]+)\s*\}$/);
    if (pure) {
      const value = resolveExpression(pure[1]!.trim(), ctx);
      if (value !== undefined && typeof value !== "string") return value;
    }
    return evaluateTemplate(node, ctx);
  }
  if (Array.isArray(node)) return node.map((v) => transformJson(v, ctx));
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = transformJson(v, ctx);
    }
    return out;
  }
  return node;
}

export function primaryValue(nodeValue: unknown): unknown {
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

/** Render a value as a safe literal embedded into a condition expression. */
function literal(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Objects / arrays become JSON strings so they compare deterministically
  // without object identity; member access is not supported in conditions.
  return JSON.stringify(JSON.stringify(value));
}

/** JS-like truthiness for condition results. */
function truthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  return true;
}

/**
 * A tiny safe expression parser (no eval) used by branch nodes. Supports:
 * - `${nodeId.path}` placeholders (injected as literals)
 * - arithmetic: `+ - * / %`
 * - comparison: `== != === !== > >= < <=`
 * - logic: `&& || !`
 * - parentheses, numbers, `'...'` / `"..."` strings, `true` / `false` / `null`
 */
class CondParser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parse(): unknown {
    const v = this.parseOr();
    this.skipWs();
    return v;
  }

  private skipWs(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }

  private match(...ops: string[]): string | null {
    this.skipWs();
    for (const op of ops) {
      if (this.src.startsWith(op, this.pos)) {
        this.pos += op.length;
        return op;
      }
    }
    return null;
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.match("||")) left = truthy(left) || truthy(this.parseAnd());
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseCmp();
    while (this.match("&&")) left = truthy(left) && truthy(this.parseCmp());
    return left;
  }

  private parseCmp(): unknown {
    let left = this.parseAdd();
    for (;;) {
      const op = this.match("===", "!==", "==", "!=", ">=", "<=", ">", "<");
      if (!op) return left;
      const right = this.parseAdd();
      left = applyCmp(op, left, right);
    }
  }

  private parseAdd(): unknown {
    let left = this.parseMul();
    for (;;) {
      const op = this.match("+", "-");
      if (!op) return left;
      const right = this.parseMul();
      left = applyArith(op, left, right);
    }
  }

  private parseMul(): unknown {
    let left = this.parseUnary();
    for (;;) {
      const op = this.match("*", "/", "%");
      if (!op) return left;
      const right = this.parseUnary();
      left = applyArith(op, left, right);
    }
  }

  private parseUnary(): unknown {
    if (this.match("!")) return !truthy(this.parseUnary());
    if (this.match("-")) return -(Number(this.parseUnary()) || 0);
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    this.skipWs();
    const c = this.src[this.pos];
    if (c === "(") {
      this.pos++;
      const v = this.parseOr();
      this.skipWs();
      if (this.src[this.pos] === ")") this.pos++;
      return v;
    }
    if (c === "'" || c === '"') return this.parseString();
    const num = this.src.slice(this.pos).match(/^\d+(\.\d+)?/);
    if (num) {
      this.pos += num[0].length;
      return Number(num[0]);
    }
    const kw = this.src.slice(this.pos).match(/^(true|false|null)\b/);
    if (kw) {
      this.pos += kw[0].length;
      return kw[0] === "true" ? true : kw[0] === "false" ? false : null;
    }
    return undefined;
  }

  private parseString(): unknown {
    const quote = this.src[this.pos]!;
    this.pos++;
    let out = "";
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]!;
      if (ch === "\\") {
        const n = this.src[this.pos + 1];
        if (n === "n") out += "\n";
        else if (n === "t") out += "\t";
        else if (n === "r") out += "\r";
        else if (n === quote) out += quote;
        else if (n === "\\") out += "\\";
        else out += n ?? "";
        this.pos += 2;
      } else if (ch === quote) {
        this.pos++;
        return out;
      } else {
        out += ch;
        this.pos++;
      }
    }
    return out;
  }
}

function applyArith(op: string, a: unknown, b: unknown): unknown {
  const x = Number(a);
  const y = Number(b);
  switch (op) {
    case "+":
      // Preserve string concatenation when either side is a non-numeric string.
      if (typeof a === "string" && !/^\s*[-+]?[\d.]+(\s*$)/.test(a)) return String(a) + String(b);
      return x + y;
    case "-":
      return x - y;
    case "*":
      return x * y;
    case "/":
      return y === 0 ? NaN : x / y;
    case "%":
      return y === 0 ? NaN : x % y;
    default:
      return NaN;
  }
}

function applyCmp(op: string, a: unknown, b: unknown): unknown {
  switch (op) {
    case "===":
      return a === b;
    case "!==":
      return a !== b;
    case "==":
      // eslint-disable-next-line eqeqeq -- deliberate loose comparison for config expressions
      return (a as never) == (b as never);
    case "!=":
      // eslint-disable-next-line eqeqeq -- deliberate loose comparison for config expressions
      return (a as never) != (b as never);
    case ">":
      return Number(a) > Number(b);
    case ">=":
      return Number(a) >= Number(b);
    case "<":
      return Number(a) < Number(b);
    case "<=":
      return Number(a) <= Number(b);
    default:
      return false;
  }
}

/**
 * Evaluate a condition expression (see `CondParser`) against a variable context.
 * `${...}` placeholders are resolved first; the whole expression must be truthy
 * for the branch to match. Malformed expressions evaluate to false.
 */
export function evaluateCondition(expr: string, context: Record<string, unknown>): boolean {
  const interpolated = expr.replace(/\$\{\s*([^}]+)\s*\}/g, (_, raw: string) =>
    literal(resolveExpression(raw.trim(), context)),
  );
  try {
    return truthy(new CondParser(interpolated).parse());
  } catch {
    return false;
  }
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
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  // Flow predecessors carry normal data; error predecessors carry the failure
  // cause (a json artifact) so catch nodes can read `${failedNode.error}`.
  const flowIn = graph.edges.filter((e) => e.to === nodeId && (e.kind === "flow" || e.kind === "error"));
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
  if (extra) Object.assign(ctx, extra);
  return ctx;
}
