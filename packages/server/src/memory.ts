import { randomUUID } from "node:crypto";
import type { RunEvent } from "@agent-world/core";

/** Minimal db interface we need — matches openDb() return shape. */
interface MinimalDb {
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
}

/**
 * Knowledge base / archive (5.2).
 *
 * Stores extracted knowledge entries from runs with full-text search (FTS5).
 * Agent nodes can mount the `archive_search` skill card to query past knowledge
 * during a run, turning the system from a one-shot pipeline into one that
 * accumulates and reuses experience.
 */

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  source: string; // run_id / graph_id / "manual"
  tags: string[];
  created_at: number;
}

export interface MemoryBackend {
  add(entry: Omit<KnowledgeEntry, "id" | "created_at"> & { id?: string }): KnowledgeEntry;
  get(id: string): KnowledgeEntry | null;
  search(query: string, limit?: number): KnowledgeEntry[];
  list(limit?: number, offset?: number): KnowledgeEntry[];
  delete(id: string): boolean;
  count(): number;
}

/**
 * SQLite FTS5-backed memory. The `knowledge` table stores metadata; the
 * `knowledge_fts` virtual table provides full-text search over title+content+tags.
 */
export class SQLiteMemoryBackend implements MemoryBackend {
  constructor(private readonly db: MinimalDb) {
    this.init();
  }

  private init(): void {
    this.db.prepare(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        content    TEXT NOT NULL,
        source     TEXT NOT NULL DEFAULT 'manual',
        tags       TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      )
    `).run();
    // FTS5 virtual table for full-text search.
    try {
      this.db.prepare(`
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
          title, content, tags,
          content='knowledge', content_rowid='rowid'
        )
      `).run();
    } catch {
      this.ftsAvailable = false;
    }
    if (this.ftsAvailable) {
      try {
        this.db.prepare(`
          CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
            INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
          END
        `).run();
        this.db.prepare(`
          CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
            INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags);
          END
        `).run();
        this.db.prepare(`
          CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
            INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags);
            INSERT INTO knowledge_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
          END
        `).run();
      } catch {
        // degrade gracefully
      }
    }
  }

  private ftsAvailable = true;

  add(entry: Omit<KnowledgeEntry, "id" | "created_at"> & { id?: string }): KnowledgeEntry {
    const id = entry.id ?? randomUUID();
    const created_at = Date.now();
    const tags = JSON.stringify(entry.tags ?? []);
    this.db
      .prepare("INSERT INTO knowledge (id, title, content, source, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, entry.title, entry.content, entry.source ?? "manual", tags, created_at);
    return { id, title: entry.title, content: entry.content, source: entry.source ?? "manual", tags: entry.tags ?? [], created_at };
  }

  get(id: string): KnowledgeEntry | null {
    const row = this.db.prepare("SELECT * FROM knowledge WHERE id = ?").get(id) as any;
    return row ? this.rowToEntry(row) : null;
  }

  search(query: string, limit = 20): KnowledgeEntry[] {
    if (!query.trim()) return this.list(limit);
    if (this.ftsAvailable) {
      try {
        const rows = this.db
          .prepare(
            `SELECT k.* FROM knowledge k
             JOIN knowledge_fts f ON k.rowid = f.rowid
             WHERE knowledge_fts MATCH ?
             ORDER BY rank LIMIT ?`,
          )
          .all(query, limit) as any[];
        return rows.map((r) => this.rowToEntry(r));
      } catch {
        // Fall through to LIKE search.
      }
    }
    // LIKE fallback
    const like = `%${query}%`;
    const rows = this.db
      .prepare("SELECT * FROM knowledge WHERE title LIKE ? OR content LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT ?")
      .all(like, like, like, limit) as any[];
    return rows.map((r) => this.rowToEntry(r));
  }

  list(limit = 50, offset = 0): KnowledgeEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM knowledge ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as any[];
    return rows.map((r) => this.rowToEntry(r));
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM knowledge WHERE id = ?").run(id) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM knowledge").get() as { c: number };
    return row.c;
  }

  private rowToEntry(row: any): KnowledgeEntry {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags);
    } catch {
      tags = [];
    }
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      source: row.source,
      tags,
      created_at: row.created_at,
    };
  }
}

/**
 * Extract knowledge from a completed run's events. Picks the most valuable
 * outputs (agent final outputs, judge verdicts, depot artifacts) and stores
 * them as searchable knowledge entries.
 *
 * This is a best-effort extractor — it never throws, and skips entries that
 * are too short or empty.
 */
export function extractKnowledgeFromRun(
  events: RunEvent[],
  runId: string,
  graphName: string,
): Array<Omit<KnowledgeEntry, "id" | "created_at">> {
  const entries: Array<Omit<KnowledgeEntry, "id" | "created_at">> = [];
  try {
    for (const ev of events) {
      if (ev.type === "node.finished") {
        const output = ev.output ?? "";
        const nodeId = ev.nodeId ?? "unknown";
        if (typeof output === "string" && output.length > 50) {
          entries.push({
            title: `${graphName} — ${nodeId} 产出`,
            content: output.slice(0, 4000),
            source: runId,
            tags: ["run-output", graphName, nodeId],
          });
        }
      }
      if (ev.type === "gate.verdict") {
        const reason = ev.reason ?? "";
        const nodeId = ev.nodeId ?? "unknown";
        const passed = ev.passed ? "通过" : "未通过";
        if (typeof reason === "string" && reason.length > 20) {
          entries.push({
            title: `${graphName} — ${nodeId} 质检结论（${passed}）`,
            content: reason.slice(0, 4000),
            source: runId,
            tags: ["judge", graphName, nodeId],
          });
        }
      }
    }
  } catch {
    // Best-effort: never throw.
  }
  return entries;
}
