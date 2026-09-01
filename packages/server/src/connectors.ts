import { promises as fs } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ConnectorConfig } from "@agent-world/core";
import { guardedFetch } from "./ssrf.js";

/** Raw material pulled from a connector, ready to feed a source node. */
export interface ResolvedMaterial {
  text: string;
  images: string[];
}

const TEXT_SEP = "\n\n---\n\n";

/** Reads a dot-path (e.g. "items.0.name") out of an arbitrary JSON value. */
function getPath(root: unknown, p: string): unknown {
  return p.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) return acc[Number(key)];
    if (typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, root);
}

async function safeReaddir(dir: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function walkAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await safeReaddir(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkAll(p)));
    else out.push(p);
  }
  return out;
}

function matchSeg(name: string, seg: string): boolean {
  let re = "";
  for (const ch of seg) {
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`).test(name);
}

/** Recursive glob matcher supporting `*`, `?` and `**` (cross-directory). */
async function matchGlob(baseDir: string, segs: string[]): Promise<string[]> {
  if (segs.length === 0) {
    try {
      const st = await fs.stat(baseDir);
      return st.isFile() ? [baseDir] : [];
    } catch {
      return [];
    }
  }
  const [head, ...tail] = segs;
  if (head === undefined) return [];
  if (head === "**") {
    const results = await matchGlob(baseDir, tail); // match at this level (zero descent)
    for (const e of await safeReaddir(baseDir)) {
      if (e.isDirectory()) results.push(...(await matchGlob(path.join(baseDir, e.name), segs)));
    }
    return results;
  }
  const out: string[] = [];
  for (const e of await safeReaddir(baseDir)) {
    if (matchSeg(e.name, head)) out.push(...(await matchGlob(path.join(baseDir, e.name), tail)));
  }
  return out;
}

/** Expands a pattern into absolute file paths (single file, directory, or glob). */
async function expandPaths(pattern: string): Promise<string[]> {
  const abs = path.resolve(pattern);
  if (!/[*?]/.test(abs)) {
    try {
      const st = await fs.stat(abs);
      return st.isDirectory() ? walkAll(abs) : [abs];
    } catch {
      return [];
    }
  }
  const segs = abs.split(path.sep);
  let rootIdx = 0;
  while (rootIdx < segs.length && !/[*?]/.test(segs[rootIdx] ?? "")) rootIdx++;
  const root = rootIdx === 0 ? path.sep : segs.slice(0, rootIdx).join(path.sep) || path.sep;
  return matchGlob(root, segs.slice(rootIdx));
}

/**
 * Resolves a source node's declarative {@link ConnectorConfig} into raw text +
 * image paths. Network/file failures throw so the caller can retry or surface a
 * clear error. `formValues` supplies answers for a `form` connector (filled at
 * run time by the UI or a webhook payload).
 */
export async function resolveConnector(
  config: ConnectorConfig,
  formValues?: Record<string, string>,
): Promise<ResolvedMaterial> {
  switch (config.type) {
    case "manual":
      return { text: "", images: [] };

    case "file": {
      const c = config.file;
      if (!c) throw new Error("file connector missing 'file' config");
      const files = await expandPaths(c.path);
      const textParts: string[] = [];
      const images: string[] = [];
      for (const f of files) {
        if (c.asImages) {
          images.push(f);
          continue;
        }
        const content = await fs.readFile(f, c.encoding === "base64" ? "base64" : "utf8");
        textParts.push(`# ${path.basename(f)}\n${content}`);
      }
      return { text: textParts.join(TEXT_SEP), images };
    }

    case "http": {
      const c = config.http;
      if (!c) throw new Error("http connector missing 'http' config");
      const headers: Record<string, string> = { ...(c.headers ?? {}) };
      if (c.auth) {
        headers.Authorization =
          c.auth.type === "bearer"
            ? `Bearer ${c.auth.token}`
            : `Basic ${Buffer.from(c.auth.token).toString("base64")}`;
      }
      const body =
        c.method === "POST" && c.body !== undefined
          ? typeof c.body === "string"
            ? c.body
            : JSON.stringify(c.body)
          : undefined;
      // User-controlled URL/method/headers — must leave through the guarded
      // egress (internal targets refused, redirects re-checked per hop).
      const res = await guardedFetch(c.url, {
        method: c.method,
        headers,
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const ct = res.headers.get("content-type") ?? "";
      let bodyText: string;
      if (ct.includes("application/json")) {
        const json: unknown = await res.json();
        if (c.extract && c.extract.length) {
          bodyText = c.extract
            .map((p) => getPath(json, p))
            .filter((v) => v != null)
            .map(String)
            .join("\n");
        } else {
          bodyText = JSON.stringify(json, null, 2);
        }
      } else {
        bodyText = await res.text();
      }
      return { text: bodyText, images: [] };
    }

    case "form": {
      const c = config.form;
      if (!c) return { text: "", images: [] };
      if (!formValues) return { text: "", images: [] };
      const lines = c.fields.map((f) => `${f.label ?? f.name}: ${formValues[f.name] ?? ""}`);
      return { text: lines.join("\n"), images: [] };
    }

    case "database": {
      const c = config.database;
      if (!c) throw new Error("database connector missing 'database' config");
      const trimmed = c.query.trim();
      // Read-only by contract: only a single SELECT / WITH…SELECT is allowed.
      // The driver's readOnly:true open is the hard backstop for any slip.
      if (!/^(select|with)\b/i.test(trimmed)) {
        throw new Error("database connector 只允许 SELECT 查询，拒绝写语句");
      }
      if (/;\s*\S/.test(trimmed)) {
        throw new Error("database connector 不支持多语句");
      }
      let db: DatabaseSync;
      try {
        db = new DatabaseSync(c.path, { readOnly: true });
      } catch (err) {
        throw new Error(
          `无法打开数据库 ${c.path}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      try {
        const rows = db.prepare(trimmed).all(...(c.params ?? []));
        const text =
          c.format === "csv" ? rowsToCsv(rows) : JSON.stringify(rows, null, 2);
        return { text, images: [] };
      } finally {
        db.close();
      }
    }
  }
}

/** Serializes query rows to a simple CSV (header row + quoted value rows). */
function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0] ?? {});
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(",");
  const body = rows.map((r) => cols.map((col) => esc(r[col])).join(",")).join("\n");
  return `${header}\n${body}`;
}
