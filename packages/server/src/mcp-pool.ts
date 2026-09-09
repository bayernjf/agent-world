import { connectMcpServer, registerMcpTools, type McpClient } from "./mcp.js";
import type { BuiltinSkill } from "./skills/registry.js";
import type { UserMcpServer } from "./config.js";

/**
 * Per-user MCP connections.
 *
 * The process-global registry stays untouched: a user's remote tools live in a
 * map keyed by their own userId, handed to the run through run context. Two
 * users can therefore configure the same server id without seeing each other's
 * endpoint or credentials.
 *
 * Lookups consult the global registry FIRST (see resolveUserSkill), so a user
 * cannot shadow an operator-configured tool id with their own endpoint.
 *
 * Nothing here retries on its own. A failed server reports why and waits for an
 * explicit reconnect — a background retry loop against a third-party endpoint
 * with the user's credentials is not something to start without being asked.
 */

const HANDSHAKE_TIMEOUT_MS = 10_000;

export interface McpServerStatus {
  id: string;
  name?: string;
  transport: "http" | "sse";
  url: string;
  connected: boolean;
  toolCount: number;
  toolNames: string[];
  /** Present when the last connect attempt failed. */
  error?: string;
  connectedAt?: number;
}

interface PoolEntry {
  client: McpClient;
  skills: Map<string, BuiltinSkill>;
  status: McpServerStatus;
  /** Changes when the user edits the url, headers or transport — forces a reconnect. */
  fingerprint: string;
}

const pool = new Map<string, Map<string, PoolEntry>>();

function fingerprintOf(server: UserMcpServer): string {
  return JSON.stringify([server.transport, server.url, server.headers ?? {}]);
}

function entriesFor(userId: string): Map<string, PoolEntry> {
  let m = pool.get(userId);
  if (!m) {
    m = new Map();
    pool.set(userId, m);
  }
  return m;
}

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${HANDSHAKE_TIMEOUT_MS}ms`)),
      HANDSHAKE_TIMEOUT_MS,
    );
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function failureStatus(server: UserMcpServer, error: unknown): McpServerStatus {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    url: server.url,
    connected: false,
    toolCount: 0,
    toolNames: [],
    error: error instanceof Error ? error.message : String(error),
  };
}

function recordFailure(userId: string, server: UserMcpServer, error: unknown): McpServerStatus {
  const status = failureStatus(server, error);
  entriesFor(userId).set(server.id, {
    client: { close: () => {} } as McpClient,
    skills: new Map(),
    status,
    fingerprint: fingerprintOf(server),
  });
  return status;
}

/**
 * Connect (or reconnect) one server and discover its tools. Never throws:
 * a failure is reported as a status with `error` so the settings UI can show
 * the reason instead of a stack trace.
 */
export async function connectUserMcpServer(userId: string, server: UserMcpServer): Promise<McpServerStatus> {
  disconnectUserMcpServer(userId, server.id);
  let client: McpClient;
  try {
    client = connectMcpServer({ transport: server.transport, url: server.url, headers: server.headers });
  } catch (e) {
    return recordFailure(userId, server, e);
  }
  const skills = new Map<string, BuiltinSkill>();
  try {
    const tools = await withTimeout(
      registerMcpTools(server.id, client, (s) => skills.set(s.id, s)),
      `mcp handshake with ${server.id}`,
    );
    const status: McpServerStatus = {
      id: server.id,
      name: server.name,
      transport: server.transport,
      url: server.url,
      connected: true,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      connectedAt: Date.now(),
    };
    entriesFor(userId).set(server.id, { client, skills, status, fingerprint: fingerprintOf(server) });
    return status;
  } catch (e) {
    client.close();
    return recordFailure(userId, server, e);
  }
}

/**
 * Bring the pool in line with the user's saved config: connect enabled servers
 * that are missing or whose endpoint changed, and drop the ones they removed or
 * disabled. Called at run start, so an already-connected server costs nothing.
 */
export async function ensureUserMcpServers(userId: string, servers: UserMcpServer[] | undefined): Promise<void> {
  const wanted = (servers ?? []).filter((s) => s.enabled !== false);
  const entries = entriesFor(userId);
  const keep = new Set(wanted.map((s) => s.id));
  for (const id of [...entries.keys()]) {
    if (!keep.has(id)) disconnectUserMcpServer(userId, id);
  }
  await Promise.all(
    wanted.map(async (server) => {
      const existing = entries.get(server.id);
      if (existing?.status.connected && existing.fingerprint === fingerprintOf(server)) return;
      await connectUserMcpServer(userId, server);
    }),
  );
}

/** Every remote tool this user currently has connected, keyed by skill id. */
export function userMcpSkills(userId: string): Map<string, BuiltinSkill> {
  const out = new Map<string, BuiltinSkill>();
  for (const entry of pool.get(userId)?.values() ?? []) {
    for (const [id, skill] of entry.skills) out.set(id, skill);
  }
  return out;
}

export function userMcpStatus(userId: string): McpServerStatus[] {
  return [...(pool.get(userId)?.values() ?? [])].map((e) => e.status);
}

export function disconnectUserMcpServer(userId: string, serverId: string): void {
  const entry = pool.get(userId)?.get(serverId);
  if (!entry) return;
  try {
    entry.client.close();
  } catch {
    // Already dead — the point was to release it.
  }
  pool.get(userId)!.delete(serverId);
}

/** Release every pooled transport. Called on graceful shutdown. */
export function closeAllUserMcpServers(): void {
  for (const [userId, entries] of pool) {
    for (const id of [...entries.keys()]) disconnectUserMcpServer(userId, id);
  }
  pool.clear();
}
