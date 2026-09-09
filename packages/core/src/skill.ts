import { z } from "zod";

/**
 * Skills are equippable capability cards mounted on a node (plant). They are the
 * ONLY sanctioned extension point for varying what a node can do — node types
 * themselves are fixed (source/agent/gate/sink). A skill is never a paywall:
 * it is a capability toggle and configuration preset with no unlock cost.
 *
 * The permission model below is both displayed at mount time and enforced by
 * the runtime: the declaration is what `guardToolCall` checks a tool call
 * against, so an undeclared domain or path fails closed. Process/container
 * isolation is still pending, so enforcement bounds the tool's own declared
 * surface rather than sandboxing the process. Restrictions live in code, never
 * in prompts.
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
    /** True when the tool performs an irreversible / externally-mutating action
     *  (writing files, calling mutating external APIs). Such tools require a human
     *  approval before execution (4D.7 / dangerous-action halt). */
    danger: z.boolean().optional(),
  })
  .default({});
export type SkillPermissions = z.infer<typeof SkillPermissions>;

export const Skill = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  kind: SkillKind,
  permissions: SkillPermissions,
  /** Marks a tool that performs an irreversible / externally-mutating action and
   *  therefore requires human approval before execution (4D.7 dangerous-action halt). */
  danger: z.boolean().optional(),
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

/**
 * A skill card the user authored themselves, stored in their settings rather
 * than compiled into the registry.
 *
 * Only the three data kinds are accepted. Their payload IS the data — a prompt
 * string, a field table, a criterion clause — so nothing executes and no
 * sandbox is required. `tool` kind is deliberately absent: it would run
 * user-supplied code, which stays blocked on process isolation.
 *
 * Consequently these cards carry no permissions at all, and the server
 * normalizes rather than trusts: id prefix, `source`, and the empty permission
 * set are all forced server-side.
 */
export const USER_SKILL_ID_PREFIX = "local:";

const FieldType = z.enum(["string", "number", "boolean", "object", "array"]);

/** One row of the output-contract editor. `validateContract` only reads field
 *  names, their `type`, and which are required — so that is all we store. */
export const UserContractField = z.object({
  name: z.string().min(1),
  type: FieldType.default("string"),
  required: z.boolean().default(false),
});
export type UserContractField = z.infer<typeof UserContractField>;

const UserSkillCardBase = {
  id: z.string().min(1).startsWith(USER_SKILL_ID_PREFIX),
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(""),
};

export const UserSkillCard = z.discriminatedUnion("kind", [
  z.object({
    ...UserSkillCardBase,
    kind: z.literal("prompt-module"),
    prompt: z.string().min(1).max(8000),
  }),
  z.object({
    ...UserSkillCardBase,
    kind: z.literal("output-contract"),
    fields: z.array(UserContractField).min(1).max(50),
  }),
  z.object({
    ...UserSkillCardBase,
    kind: z.literal("judge"),
    criterion: z.string().min(1).max(2000),
  }),
]);
export type UserSkillCard = z.infer<typeof UserSkillCard>;

/**
 * Project a stored user card onto the `Skill` shape the runtime consumes.
 * Permissions stay empty and `danger` stays false — these cards cannot grant
 * anything, so there is nothing for the user to escalate.
 */
export function userSkillToSkill(card: UserSkillCard): Skill {
  const config: Record<string, unknown> =
    card.kind === "prompt-module"
      ? { prompt: card.prompt }
      : card.kind === "judge"
        ? { criterion: card.criterion }
        : { schema: contractFieldsToSchema(card.fields) };
  return {
    id: card.id,
    name: card.name,
    description: card.description,
    kind: card.kind,
    permissions: { subprocess: false, env: [] },
    danger: false,
    source: "local",
    config,
  };
}

/** Build the JSON-schema subset `validateContract` understands from the editor rows. */
export function contractFieldsToSchema(fields: UserContractField[]): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(fields.map((f) => [f.name, { type: f.type }])),
    required: fields.filter((f) => f.required).map((f) => f.name),
  };
}
