import type { Skill } from "@agent-world/core";
import { getSkill } from "./skills/registry.js";

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
    const underSkill = (fsPerm.paths ?? []).some((p) => f.path.startsWith(p));
    const underServer = cfg.fsAllow ? cfg.fsAllow.some((p) => f.path.startsWith(p)) : true;
    if (!underSkill || !underServer) return `filesystem path ${f.path} is not permitted`;
  }
  return null;
}

/** Derive the operation a known built-in tool intends to perform. */
function opForTool(name: string, args: unknown): ToolOp {
  if (name === "web_fetch" || name === "web_search") {
    const host = hostOf((args as { url?: unknown } | undefined)?.url);
    return { network: host ? [host] : [] };
  }
  return {};
}

/**
 * Resolve the skill backing a tool, evaluate the operation, and throw
 * `PermissionDenied` when the call is not allowed. Network tools (web_fetch /
 * web_search) are checked against the target host.
 */
export function guardToolCall(name: string, args: unknown, cfg: PermissionConfig): void {
  const skill = getSkill(name);
  const op = opForTool(name, args);
  const reason = evaluateToolCall(skill, op, cfg);
  if (reason) throw new PermissionDenied(name, reason);
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
