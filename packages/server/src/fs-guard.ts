import path from "node:path";

/**
 * Local filesystem access guard for user-supplied paths (file connector,
 * database connector, batch trigger CSV). These inputs are authored by any
 * logged-in user, so they must never reach the server's own secrets or
 * database (audit H1/H2/H3).
 */

/** The server's own database, which must never be opened by a user path. */
function serverDbPath(): string {
  return path.resolve(process.env.DB_FILE ?? "agent-world.sqlite");
}

/** Optional allowlist root — when set, nothing outside it is reachable. */
function fsRoot(): string | null {
  const raw = process.env.AGENT_WORLD_FS_ROOT?.trim();
  return raw ? path.resolve(raw) : null;
}

/**
 * Validate a user-supplied local path and return its resolved absolute form.
 * Throws on:
 *  - paths outside `AGENT_WORLD_FS_ROOT` (when the env var is set);
 *  - the server's own database file;
 *  - hidden dotfile/dotdir segments (`.jwt-secret`, `.encryption-keys`, `.env`…).
 */
export function assertSafeLocalPath(p: string): string {
  const abs = path.resolve(p);

  const root = fsRoot();
  if (root) {
    const rel = path.relative(root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`路径越界（仅允许访问 ${root} 内）: ${p}`);
    }
  }

  if (abs === serverDbPath()) {
    throw new Error(`禁止访问服务数据库: ${p}`);
  }

  for (const seg of abs.split(path.sep)) {
    if (seg && seg !== "." && seg.startsWith(".")) {
      throw new Error(`禁止访问隐藏路径: ${p}`);
    }
  }

  return abs;
}
