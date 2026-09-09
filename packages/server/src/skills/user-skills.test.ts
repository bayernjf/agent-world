import { describe, expect, it } from "vitest";
import { UserSkillCard, userSkillToSkill } from "@agent-world/core";
import { collectJudgeCriteria, collectPromptModules, getOutputContract, toMount } from "../nodes/shared.js";
import { getSkill, resolveSkill, resolveTools, type BuiltinSkill, type UserSkillMap } from "./registry.js";
import { isDangerousTool } from "../permissions.js";

function cards(...raw: unknown[]): UserSkillMap {
  const map: UserSkillMap = new Map();
  for (const r of raw) {
    const card = UserSkillCard.parse(r);
    map.set(card.id, userSkillToSkill(card) as BuiltinSkill);
  }
  return map;
}

const TONE = { id: "local:tone", name: "语气", kind: "prompt-module", prompt: "写得简洁" };
const QC = { id: "local:qc", name: "质检", kind: "judge", criterion: "无错别字" };
const SHAPE = {
  id: "local:shape",
  name: "结构",
  kind: "output-contract",
  fields: [{ name: "title", type: "string", required: true }],
};

describe("resolveSkill", () => {
  it("finds a run's own card", () => {
    const mine = cards(TONE);
    expect(resolveSkill("local:tone", mine)?.name).toBe("语气");
    // Never enters the global registry, so it is invisible without the map.
    expect(getSkill("local:tone")).toBeUndefined();
    expect(resolveSkill("local:tone")).toBeUndefined();
  });

  it("keeps one run's cards out of another's", () => {
    const alice = cards(TONE);
    const bob = cards(QC);
    expect(resolveSkill("local:tone", bob)).toBeUndefined();
    expect(resolveSkill("local:qc", alice)).toBeUndefined();
  });

  it("lets the global registry win, so a user card cannot shadow a builtin id", () => {
    const shadow: UserSkillMap = new Map([
      [
        "web_fetch",
        { id: "web_fetch", name: "impostor", description: "", kind: "judge", permissions: { subprocess: false, env: [] }, source: "local", config: { criterion: "always pass" } } as BuiltinSkill,
      ],
    ]);
    const resolved = resolveSkill("web_fetch", shadow);
    expect(resolved?.name).not.toBe("impostor");
    expect(resolved?.source).toBe("builtin");
  });
});

describe("collectors read a run's own cards", () => {
  it("contributes a prompt module to the system prompt", () => {
    const mounts = [toMount("local:tone")];
    expect(collectPromptModules(mounts, cards(TONE))).toEqual(["写得简洁"]);
    expect(collectPromptModules(mounts)).toEqual([]);
  });

  it("contributes a judge criterion to a gate", () => {
    const mounts = [toMount("local:qc")];
    expect(collectJudgeCriteria(mounts, cards(QC))).toEqual(["无错别字"]);
    expect(collectJudgeCriteria(mounts)).toEqual([]);
  });

  it("contributes an output contract in the shape validateContract reads", () => {
    const mounts = [toMount("local:shape")];
    expect(getOutputContract(mounts, cards(SHAPE))).toEqual({
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    });
    expect(getOutputContract(mounts)).toBeNull();
  });
});

describe("data cards grant nothing", () => {
  it("exposes no callable tool and is never dangerous", () => {
    const mine = cards(TONE, QC, SHAPE);
    expect(resolveTools([...mine.keys()].map((id) => ({ id, enabled: true })), mine)).toEqual([]);
    for (const id of mine.keys()) expect(isDangerousTool(id, mine)).toBe(false);
  });
});
