import { z } from "zod";

/**
 * Skills are equippable capability cards mounted on a node (plant). They are the
 * ONLY sanctioned extension point for varying what a node can do — node types
 * themselves are fixed (source/agent/gate/sink). A skill is never a paywall:
 * it is a capability toggle and configuration preset with no unlock cost.
 *
 * The permission model below is declared now (Phase 1) so skill cards carry a
 * stable contract by Phase 2. Phase 2 records and displays permissions; the
 * runtime does not enforce them until process/container isolation lands in
 * Phase 4/5. Restrictions must live in code, never in prompts.
 */

export const SkillKind = z.enum(["tool", "prompt-module", "output-contract", "judge"]);
export type SkillKind = z.infer<typeof SkillKind>;

/**
 * What a skill is allowed to touch. Omitted fields mean "not granted".
 * This is the phone-app-style permission grant shown when equipping a card.
 */
export const SkillPermissions = z
  .object({
    /** Egress allowlist. Omit/empty = no network. */
    network: z
      .object({
        domains: z.array(z.string()).default([]),
      })
      .optional(),
    /** Filesystem access. Omit = no fs. */
    fs: z
      .object({
        paths: z.array(z.string()).default([]),
        read: z.boolean().default(false),
        write: z.boolean().default(false),
      })
      .optional(),
    /** May spawn a subprocess. */
    subprocess: z.boolean().default(false),
    /** Names of environment variables this skill may read. */
    env: z.array(z.string()).default([]),
  })
  .default({});
export type SkillPermissions = z.infer<typeof SkillPermissions>;

export const Skill = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  kind: SkillKind,
  permissions: SkillPermissions,
  /** Where the skill came from — controls trust and isolation level. */
  source: z.enum(["builtin", "local", "mcp"]).default("builtin"),
  /**
   * Tool skills invoke a named capability; the runtime resolves it via the
   * tool registry. Prompt-module skills contribute text to the system prompt.
   * Output-contract skills carry a schema id; judge skills carry a judge id.
   */
  config: z.record(z.unknown()).default({}),
});
export type Skill = z.infer<typeof Skill>;

/**
 * A reference to a skill mounted on a node. `agent.skills` is currently a
 * string[] (ids). This richer reference lets the node carry per-mount config
 * (e.g. a tool's arguments, a prompt module's variables) without mutating the
 * shared skill definition. Phase 2 migrates the string[] to this shape.
 */
export const SkillMount = z.object({
  id: z.string().min(1),
  /** Per-mount overrides merged over Skill.config. */
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});
export type SkillMount = z.infer<typeof SkillMount>;
