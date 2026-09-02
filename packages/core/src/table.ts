import type { TableRow, TableStep } from "./graph.js";

export type Cell = string | number | boolean | null;

/** The two shapes a `table` node accepts as input. */
export type TableInput = { rows: TableRow[] } | { text: string };

export interface TableResult {
  rows: TableRow[];
  output: "json" | "csv";
}

/** Coerce a scalar cell from a raw CSV/JSON value. */
function coerce(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    if (t === "true") return true;
    if (t === "false") return false;
    const n = Number(t);
    if (t !== "" && Number.isFinite(n)) return n;
    return v;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Split CSV text into cells, honouring double-quoted fields with embedded delimiters/newlines. */
function parseCsvCells(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // CRLF: swallow the CR and let the LF close the row; lone CR closes too.
      if (text[i + 1] !== "\n") pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  // Drop trailing blank rows.
  while (rows.length > 0 && rows[rows.length - 1]!.every((f) => f === "")) rows.pop();
  return rows;
}

/** Parse CSV text into rows keyed by column name (or `columnN` when headerless). */
export function parseCsv(
  text: string,
  opts: { hasHeader?: boolean; delimiter?: string } = {},
): TableRow[] {
  const delimiter = opts.delimiter ?? ",";
  const hasHeader = opts.hasHeader ?? true;
  const cells = parseCsvCells(text, delimiter);
  if (cells.length === 0) return [];
  if (!hasHeader) {
    const width = Math.max(...cells.map((r) => r.length));
    return cells.map((r) => {
      const out: TableRow = {};
      for (let i = 0; i < width; i++) out[`column${i + 1}`] = coerce(r[i] ?? null);
      return out;
    });
  }
  const header = (cells[0] ?? []).map((h, i) => (h.trim() === "" ? `column${i + 1}` : h.trim()));
  return cells.slice(1).map((r) => {
    const out: TableRow = {};
    header.forEach((h, i) => {
      out[h] = coerce(r[i] ?? null);
    });
    return out;
  });
}

/** Collect the union of column names across rows, preserving first-seen order. */
export function collectColumns(rows: TableRow[]): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

/** Serialize rows back to CSV (RFC-style quoting). */
export function rowsToCsv(rows: TableRow[], columns?: string[]): string {
  const cols = columns ?? collectColumns(rows);
  const esc = (v: Cell) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(esc).join(",")];
  for (const row of rows) lines.push(cols.map((c) => esc(row[c] ?? null)).join(","));
  return lines.join("\n");
}

function cellText(v: Cell): string {
  return v == null ? "" : String(v);
}

/** Numeric-aware comparison: both sides numeric → number compare, else string compare. */
function compareCells(a: Cell, b: Cell): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number" && b != null && b !== "" && Number.isFinite(Number(b))) {
    return a - Number(b);
  }
  if (typeof b === "number" && a != null && a !== "" && Number.isFinite(Number(a))) {
    return Number(a) - b;
  }
  return cellText(a).localeCompare(cellText(b));
}

function toComparable(v: Cell): string | number {
  if (typeof v === "number") return v;
  if (v == null) return "";
  const t = String(v).trim();
  if (t === "") return "";
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

function matchesFilter(row: TableRow, step: Extract<TableStep, { op: "filter" }>): boolean {
  const { column, operator, value } = step;
  const v: Cell = row[column] ?? null;
  switch (operator) {
    case "eq":
      return toComparable(v) === toComparable(value);
    case "ne":
      return toComparable(v) !== toComparable(value);
    case "gt":
      return compareCells(v, value) > 0;
    case "gte":
      return compareCells(v, value) >= 0;
    case "lt":
      return compareCells(v, value) < 0;
    case "lte":
      return compareCells(v, value) <= 0;
    case "contains":
      return cellText(v).toLowerCase().includes(value.toLowerCase());
  }
}

export function filterRows(rows: TableRow[], step: Extract<TableStep, { op: "filter" }>): TableRow[] {
  return rows.filter((r) => matchesFilter(r, step));
}

export function sortRows(rows: TableRow[], step: Extract<TableStep, { op: "sort" }>): TableRow[] {
  const dir = step.direction === "desc" ? -1 : 1;
  // Missing cells sink to the bottom regardless of direction: a missing date
  // must not float to the top of an ascending timeline (dogfood
  // tpl-evidence-brief).
  return [...rows].sort((a, b) => {
    const va = a[step.column] ?? null;
    const vb = b[step.column] ?? null;
    const ea = cellIsEmpty(va);
    const eb = cellIsEmpty(vb);
    if (ea && eb) return 0;
    if (ea) return 1;
    if (eb) return -1;
    return compareCells(va, vb) * dir;
  });
}

function cellIsEmpty(v: Cell): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

function computeAgg(group: TableRow[], column: string, fn: "count" | "sum" | "avg" | "min" | "max"): Cell {
  const nums = group
    .map((r): Cell => r[column] ?? null)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  switch (fn) {
    case "count":
      return group.filter((r) => {
        const v = r[column] ?? null;
        return v != null && v !== "";
      }).length;
    case "sum":
      return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
    case "avg":
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case "min":
      return nums.length ? Math.min(...nums) : null;
    case "max":
      return nums.length ? Math.max(...nums) : null;
  }
}

export function aggregateRows(
  rows: TableRow[],
  step: Extract<TableStep, { op: "aggregate" }>,
): TableRow[] {
  const { groupBy, aggs } = step;
  const groups = new Map<string, TableRow[]>();
  if (!groupBy) {
    groups.set("__all__", rows);
  } else {
    for (const r of rows) {
      const key = cellText(r[groupBy] ?? null);
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
  }
  const out: TableRow[] = [];
  for (const [key, group] of groups) {
    const row: TableRow = groupBy ? { [groupBy]: key } : {};
    for (const agg of aggs) {
      const as = agg.as ?? `${agg.fn}_${agg.column}`;
      row[as] = computeAgg(group, agg.column, agg.fn);
    }
    out.push(row);
  }
  return out;
}

/** Turn an arbitrary upstream value into rows, throwing on unsupported shapes. */
export function tableInputFrom(raw: unknown): TableInput {
  if (Array.isArray(raw)) {
    return {
      rows: raw.map((r) => {
        if (r && typeof r === "object") {
          const out: TableRow = {};
          for (const [k, v] of Object.entries(r as Record<string, unknown>)) out[k] = coerce(v);
          return out;
        }
        throw new Error(`表格输入的元素必须是对象，当前是 ${typeof r}`);
      }),
    };
  }
  if (raw && typeof raw === "object" && "rows" in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (!Array.isArray(r)) throw new Error("表格输入对象缺少 rows 数组");
    return tableInputFrom(r);
  }
  if (typeof raw === "string") return { text: raw };
  throw new Error(`表格输入必须是数组 / {rows:[...]} / CSV 文本，当前是 ${raw == null ? String(raw) : typeof raw}`);
}

/**
 * Apply an ordered step list. `parse` converts `{ text }` input into rows;
 * every other step operates on the current row set. When no `parse` step is
 * present the `rows` input is used as-is. Empty rows are an error.
 */
export function applyTableSteps(input: TableInput, steps: TableStep[]): TableResult {
  let rows: TableRow[] | null = "rows" in input ? input.rows : null;
  let text = "text" in input ? input.text : null;
  let output: "json" | "csv" = "json";
  for (const step of steps) {
    switch (step.op) {
      case "parse": {
        if (text == null) throw new Error("parse 步骤需要文本输入（上游是 CSV 字符串）");
        rows =
          step.format === "csv"
            ? parseCsv(text, { hasHeader: step.hasHeader, delimiter: step.delimiter })
            : parseJsonRows(text);
        text = null;
        break;
      }
      case "filter":
        if (rows) rows = filterRows(rows, step);
        break;
      case "sort":
        if (rows) rows = sortRows(rows, step);
        break;
      case "aggregate":
        if (rows) rows = aggregateRows(rows, step);
        break;
      case "output":
        output = step.format;
        break;
    }
  }
  if (rows == null) rows = "rows" in input ? input.rows : [];
  return { rows, output };
}

/** Parse a JSON array of row objects (or a single object). */
export function parseJsonRows(text: string): TableRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("parse(json) 步骤：输入不是合法的 JSON");
  }
  const input = tableInputFrom(parsed);
  return "rows" in input ? input.rows : [];
}
