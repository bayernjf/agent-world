import type { JsonRpcMessage } from "./server.js";

/**
 * Protocol version negotiation across three MCP revisions.
 *
 * 2026-07-28 deleted the `initialize` handshake outright: every request now
 * carries its own version in `_meta`, and `server/discover` replaces the
 * handshake for up-front version selection. The methods it removed
 * (`initialize`, `ping`, `resources/subscribe`) are disjoint from the methods
 * it added (`server/discover`, `subscriptions/listen`), so one dispatcher can
 * serve both — which revision a request gets is decided by what it declares.
 * Today's clients (Claude Desktop et al.) still open with `initialize`, so the
 * old path has to stay.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2024-11-05"] as const;
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export const LATEST_PROTOCOL_VERSION: ProtocolVersion = "2026-07-28";

/** `_meta` keys defined by the spec (SEP-2575, SEP-414). */
export const META = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  clientInfo: "io.modelcontextprotocol/clientInfo",
  serverInfo: "io.modelcontextprotocol/serverInfo",
  logLevel: "io.modelcontextprotocol/logLevel",
  subscriptionId: "io.modelcontextprotocol/subscriptionId",
} as const;

/** Change types a client may opt into via `subscriptions/listen`. */
export const SUBSCRIPTION_TYPES = [
  "toolsListChanged",
  "promptsListChanged",
  "resourcesListChanged",
  "resourceSubscriptions",
] as const;
export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number];

function isSupported(v: string): v is ProtocolVersion {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v);
}

/**
 * Handshake negotiation: echo the client's version when we speak it, otherwise
 * answer with our newest and let the client decide whether to continue.
 */
export function negotiateVersion(requested: unknown): ProtocolVersion {
  return typeof requested === "string" && isSupported(requested) ? requested : LATEST_PROTOCOL_VERSION;
}

/**
 * The version a single request declares in `_meta`. `null` means the request
 * predates SEP-2575 and belongs on the `initialize` path.
 */
export function declaredVersion(msg: JsonRpcMessage): ProtocolVersion | null {
  const meta = (msg.params as { _meta?: Record<string, unknown> } | undefined)?._meta;
  const raw = meta?.[META.protocolVersion];
  return typeof raw === "string" && isSupported(raw) ? raw : null;
}

/** A declared-but-unknown version, which must be rejected rather than guessed at. */
export function unknownDeclaredVersion(msg: JsonRpcMessage): string | null {
  const meta = (msg.params as { _meta?: Record<string, unknown> } | undefined)?._meta;
  const raw = meta?.[META.protocolVersion];
  if (typeof raw !== "string") return null;
  return isSupported(raw) ? null : raw;
}

/** Per-request log level (2026-07-28 replaced `logging/setLevel` with this). */
export function declaredLogLevel(msg: JsonRpcMessage): string | null {
  const meta = (msg.params as { _meta?: Record<string, unknown> } | undefined)?._meta;
  const raw = meta?.[META.logLevel];
  return typeof raw === "string" ? raw : null;
}

export function unsupportedProtocolVersionError(id: JsonRpcMessage["id"], requested: string): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32602,
      message: `UnsupportedProtocolVersionError: 不支持的协议版本 "${requested}"`,
      data: { supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS] },
    },
  };
}

export function removedMethodError(
  id: JsonRpcMessage["id"],
  method: string,
  replacement: string,
): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `方法 "${method}" 已在 MCP 2026-07-28 移除，请改用 ${replacement}`,
    },
  };
}

export interface ServerIdentity {
  name: string;
  version: string;
}

/**
 * Stamp a result with `resultType` and `_meta.serverInfo`.
 *
 * Applied unconditionally rather than per-version: the spec requires clients to
 * ignore unknown fields, and a 2026-07-28 client must read a missing
 * `resultType` as `"complete"` — so one code path is both correct and cheaper
 * than branching on the negotiated revision.
 */
export function complete<T extends object>(result: T, serverInfo: ServerIdentity): T & Record<string, unknown> {
  return { ...result, resultType: "complete", _meta: { [META.serverInfo]: serverInfo } };
}

/** Cache hints required on list/read results by SEP-2549. */
export interface CacheHints {
  ttlMs: number;
  cacheScope: "public" | "private";
}

export function cacheable<T extends object>(result: T, hints: CacheHints): T & CacheHints {
  return { ...result, ...hints };
}

/** Per-user data: cacheable, but never shared across tokens. */
export const PRIVATE_CACHE: CacheHints = { ttlMs: 5_000, cacheScope: "private" };
/** Static catalogs (tools, prompts, resource templates) are identical for everyone. */
export const PUBLIC_CACHE: CacheHints = { ttlMs: 300_000, cacheScope: "public" };
