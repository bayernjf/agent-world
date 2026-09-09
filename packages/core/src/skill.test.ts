import { describe, expect, it } from "vitest";
import {
  USER_SKILL_ID_PREFIX,
  UserSkillCard,
  contractFieldsToSchema,
  userSkillToSkill,
} from "./skill.js";

describe("UserSkillCard", () => {
  it("accepts the three data kinds", () => {
    expect(UserSkillCard.safeParse({ id: "local:a", name: "A", kind: "prompt-module", prompt: "写得简洁" }).success).toBe(true);
    expect(UserSkillCard.safeParse({ id: "local:b", name: "B", kind: "judge", criterion: "无错别字" }).success).toBe(true);
    expect(
      UserSkillCard.safeParse({
        id: "local:c",
        name: "C",
        kind: "output-contract",
        fields: [{ name: "title", type: "string", required: true }],
      }).success,
    ).toBe(true);
  });

  it("rejects tool kind — it would run user code, which needs isolation first", () => {
    const r = UserSkillCard.safeParse({ id: "local:d", name: "D", kind: "tool", config: {} });
    expect(r.success).toBe(false);
  });

  it("requires the local: id prefix so user cards cannot shadow builtin or mcp ids", () => {
    expect(UserSkillCard.safeParse({ id: "web_fetch", name: "X", kind: "judge", criterion: "x" }).success).toBe(false);
    expect(UserSkillCard.safeParse({ id: "mcp:s:t", name: "X", kind: "judge", criterion: "x" }).success).toBe(false);
    expect(USER_SKILL_ID_PREFIX).toBe("local:");
  });

  it("rejects an empty payload for each kind", () => {
    expect(UserSkillCard.safeParse({ id: "local:a", name: "A", kind: "prompt-module", prompt: "" }).success).toBe(false);
    expect(UserSkillCard.safeParse({ id: "local:b", name: "B", kind: "judge", criterion: "" }).success).toBe(false);
    expect(UserSkillCard.safeParse({ id: "local:c", name: "C", kind: "output-contract", fields: [] }).success).toBe(false);
  });
});

describe("userSkillToSkill", () => {
  it("grants nothing regardless of input", () => {
    const skill = userSkillToSkill(
      UserSkillCard.parse({ id: "local:a", name: "A", kind: "prompt-module", prompt: "p" }),
    );
    expect(skill.source).toBe("local");
    expect(skill.danger).toBe(false);
    expect(skill.permissions.network).toBeUndefined();
    expect(skill.permissions.fs).toBeUndefined();
    expect(skill.permissions.subprocess).toBe(false);
    expect(skill.permissions.env).toEqual([]);
  });

  it("maps each kind onto the config key its collector reads", () => {
    const prompt = userSkillToSkill(UserSkillCard.parse({ id: "local:a", name: "A", kind: "prompt-module", prompt: "p" }));
    expect(prompt.config.prompt).toBe("p");
    const judge = userSkillToSkill(UserSkillCard.parse({ id: "local:b", name: "B", kind: "judge", criterion: "c" }));
    expect(judge.config.criterion).toBe("c");
    const contract = userSkillToSkill(
      UserSkillCard.parse({
        id: "local:c",
        name: "C",
        kind: "output-contract",
        fields: [{ name: "title", required: true }, { name: "score", type: "number" }],
      }),
    );
    expect(contract.config.schema).toEqual({
      type: "object",
      properties: { title: { type: "string" }, score: { type: "number" } },
      required: ["title"],
    });
  });
});

describe("contractFieldsToSchema", () => {
  it("produces only what validateContract reads: properties[].type and required[]", () => {
    expect(contractFieldsToSchema([{ name: "a", type: "array", required: false }])).toEqual({
      type: "object",
      properties: { a: { type: "array" } },
      required: [],
    });
  });
});
