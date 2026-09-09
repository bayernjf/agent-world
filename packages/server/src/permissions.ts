import type { Skill } from "@agent-world/core";
import path from "node:path";
import { getSkill } from "./skills/registry.js";

/** True when `child` is `parent` itself or directly under it (path boundary). */
function isPathUnder(child: string, parent: string): boolean {
  if (child === parent) return true;
  if (!child.startsWith(parent)) return false;
  if (parent.endsWith("/")) return true;
  return child[parent.length] === "/";
}

/**
 * Tool-call permission governance (4D.7).
 *
 * Skills already *declare* what they may touch (`Skill.permissions`). This
 * module enforces those declarations at call time against an operator-defined
 * allowlist, turning the previously display-only model into a real gate.
 *
 * Trust boundary: built-in tools run in-process and are gated here. MCP tools
 * run in an external server and can only be governed at mount time (their
 * declared `permissions`); runtime network/fs interception of a remote server
 * is out of scope, so the operator should declare the narrowest permissions
 * when registering an MCP server.
 */

export interface PermissionConfig {
  /** Global egress allowlist (domain patterns). When set, ONLY hosts matching
   *  it are reachable — this overrides a skill's declared `network.domains`. */
  networkAllow?: string[];
  /** Global filesystem path-prefix allowlist. When set, overrides `fs.paths`. */
  fsAllow?: string[];
  /** Whether any tool may spawn a subprocess. Default true (legacy behaviour). */
  subprocessAllow?: boolean;
}

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  networkAllow: undefined,
  fsAllow: undefined,
  subprocessAllow: true,
};

/** What an operation wants to touch. Derived from a tool's name + arguments. */
export interface ToolOp {
  network?: string[];
  fs?: { path: string; write: boolean }[];
  subprocess?: boolean;
}

export class PermissionDenied extends Error {
  constructor(public readonly tool: string, reason: string) {
    super(`tool "${tool}" blocked: ${reason}`);
    this.name = "PermissionDenied";
  }
}

function hostOf(url?: unknown): string | undefined {
  if (typeof url !== "string" || !url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** True if `host` matches any of the domain patterns (`*` = everything,
 *  `*.foo.com` = foo.com and its subdomains). Hosts may include a port, which
 *  is ignored for matching. */
export function matchDomain(host: string, patterns: string[]): boolean {
  const h = host.split(":")[0]!.toLowerCase();
  return patterns.some((p) => {
    const pat = p.toLowerCase().trim();
    if (pat === "*" || pat === "**") return true;
    if (pat.startsWith("*.")) return h === pat.slice(2) || h.endsWith(pat.slice(1));
    return h === pat || h.endsWith("." + pat);
  });
}

/**
 * Returns `null` if the operation is permitted, otherwise a human-readable
 * reason string. The check combines the skill's declared permissions with the
 * operator allowlist (the latter wins when set).
 */
export function evaluateToolCall(
  skill: Skill | undefined,
  op: ToolOp,
  cfg: PermissionConfig,
): string | null {
  if (op.subprocess) {
    if (!skill?.permissions?.subprocess) return "subprocess is not granted to this skill";
    if (cfg.subprocessAllow === false) return "subprocess execution is disabled by server policy";
  }
  for (const host of op.network ?? []) {
    const declared = skill?.permissions?.network?.domains ?? [];
    const allowedBySkill = declared.length > 0 && matchDomain(host, declared);
    const allowedByServer = cfg.networkAllow ? matchDomain(host, cfg.networkAllow) : true;
    if (!allowedBySkill || !allowedByServer) return `network access to ${host} is not permitted`;
  }
  for (const f of op.fs ?? []) {
    const fsPerm = skill?.permissions?.fs;
    if (!fsPerm) return "filesystem access is not granted";
    if (f.write && !fsPerm.write) return "filesystem write is not granted";
    if (!f.write && !fsPerm.read) return "filesystem read is not granted";
    // An empty `paths` on a declared fs grant means "wherever the operator
    // allows" — the card claims filesystem access but names no root of its own,
    // so TOOL_FS_ALLOW is the only path authority.
    const declaredPaths = fsPerm.paths ?? [];
    const underSkill = declaredPaths.length === 0 || declaredPaths.some((p) => isPathUnder(f.path, p));
    const underServer = cfg.fsAllow ? cfg.fsAllow.some((p) => isPathUnder(f.path, p)) : true;
    if (!underSkill || !underServer) return `filesystem path ${f.path} is not permitted`;
  }
  return null;
}

/** Argument keys whose string value is treated as a filesystem path. */
const FS_ARG_KEYS = new Set(["path", "file", "filename", "filepath", "dir", "directory", "dest", "destination", "target"]);

/** Walk an arguments object, yielding [key, string-value] pairs up to a bounded depth. */
function* stringArgs(value: unknown, depth = 0): Generator<[string, string]> {
  if (depth > 4 || value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) yield* stringArgs(v, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") yield [key, v];
    else yield* stringArgs(v, depth + 1);
  }
}

/**
 * Derive the operation a tool call intends to perform, driven by what the skill
 * *declares* rather than by a hard-coded list of tool names. A card that
 * declares `network` has every URL-shaped argument checked against its own
 * `network.domains`; one that declares `fs` has every path-shaped argument
 * checked against `fs.paths`; one that declares `subprocess` is subject to the
 * operator kill switch.
 *
 * What this does NOT catch: a card whose implementation reaches out on its own
 * (a hard-coded `fetch`, a path built inside `execute`) leaves no trace in the
 * arguments, so the declaration cannot constrain it. Closing that hole needs
 * process/container isolation (design-skill.md §4), not a smarter derivation.
 */
function opForTool(skill: Skill | undefined, args: unknown, cfg: PermissionConfig): ToolOp {
  const perms = skill?.permissions;
  if (!perms) return {};
  const op: ToolOp = {};
  const wantsNetwork = (perms.network?.domains?.length ?? 0) > 0;
  const wantsFs = !!perms.fs;
  if (wantsNetwork || wantsFs) {
    const network: string[] = [];
    const fs: { path: string; write: boolean }[] = [];
    // A relative path argument means "inside the allowed root", which is how the
    // tools themselves resolve it — resolving against cwd instead would reject
    // every legitimate call whenever TOOL_FS_ALLOW points elsewhere.
    const fsRoot = cfg.fsAllow?.[0] ?? process.cwd();
    for (const [key, value] of stringArgs(args)) {
      if (wantsNetwork) {
        const host = hostOf(value);
        if (host) network.push(host);
      }
      if (wantsFs && FS_ARG_KEYS.has(key.toLowerCase())) {
        fs.push({ path: path.resolve(fsRoot, value), write: perms.fs?.write === true });
      }
    }
    if (network.length) op.network = network;
    if (fs.length) op.fs = fs;
  }
  if (perms.subprocess) op.subprocess = true;
  return op;
}

/**
 * Resolve the skill backing a tool, evaluate the operation, and throw
 * `PermissionDenied` when the call is not allowed. The operation is derived
 * from the skill's declared permissions — see `opForTool`.
 */
export function guardToolCall(name: string, args: unknown, cfg: PermissionConfig): void {
  const skill = getSkill(name);
  const op = opForTool(skill, args, cfg);
  const reason = evaluateToolCall(skill, op, cfg);
  if (reason) throw new PermissionDenied(name, reason);
}

/** True when the named tool is flagged dangerous (irreversible / externally
 *  mutating) and therefore requires human approval before execution (4D.7). */
export function isDangerousTool(name: string): boolean {
  return getSkill(name)?.danger === true;
}

/** Build the effective config from environment variables. */
export function loadPermissionConfig(): PermissionConfig {
  const split = (v?: string): string[] | undefined => {
    if (!v) return undefined;
    const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts : undefined;
  };
  const subprocessRaw = process.env.TOOL_SUBPROCESS_ALLOW;
  return {
    networkAllow: split(process.env.TOOL_NETWORK_ALLOW),
    fsAllow: split(process.env.TOOL_FS_ALLOW),
    subprocessAllow: subprocessRaw === undefined ? true : subprocessRaw !== "false" && subprocessRaw !== "0",
  };
}
