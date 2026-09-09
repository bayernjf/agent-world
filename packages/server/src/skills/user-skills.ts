import { userSkillToSkill } from "@agent-world/core";
import type { AppConfig } from "../config.js";
import { ensureUserMcpServers, userMcpSkills } from "../mcp-pool.js";
import type { BuiltinSkill, UserSkillMap } from "./registry.js";

/**
 * Build the extra skills for one run from its owner's settings: the data cards
 * they authored plus the tools of the MCP servers they connected.
 *
 * Deliberately per-run rather than registered globally — see resolveSkill. An
 * unreachable MCP server contributes nothing and does not fail the run, since
 * a third-party outage should not stop a pipeline whose other cards are fine.
 */
export async function loadUserSkills(userId: string, cfg: AppConfig): Promise<UserSkillMap> {
  const out: UserSkillMap = new Map();
  for (const card of cfg.skillCards ?? []) {
    out.set(card.id, userSkillToSkill(card) as BuiltinSkill);
  }
  await ensureUserMcpServers(userId, cfg.mcpServers);
  for (const [id, skill] of userMcpSkills(userId)) out.set(id, skill);
  return out;
}
