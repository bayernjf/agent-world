import { TEMPLATES, type GraphNode } from "@agent-world/core";
import { describe, expect, it } from "vitest";
import { getSkill } from "./registry.js";

/**
 * Templates pre-mount capability cards by id. Nothing in the type system ties
 * those ids to the registry, so a renamed or removed card would silently leave
 * a template mounting a card that resolves to nothing.
 */
function mountsOf(node: GraphNode): { id: string; where: string }[] {
  const out: { id: string; where: string }[] = [];
  for (const [where, mounts] of [
    ["textGen", node.textGen?.skills],
    ["gate", node.gate?.skills],
  ] as const) {
    for (const m of mounts ?? []) {
      out.push({ id: typeof m === "string" ? m : m.id, where: `${where}.${node.id}` });
    }
  }
  return out;
}

describe("template-mounted skill cards", () => {
  const mounted = TEMPLATES.flatMap((tpl) =>
    tpl.graph.nodes.flatMap((n) => mountsOf(n).map((m) => ({ ...m, tpl: tpl.id }))),
  );

  it("every mounted id resolves to a registered card", () => {
    for (const m of mounted) {
      expect(getSkill(m.id), `${m.tpl} mounts unknown card "${m.id}" on ${m.where}`).toBeTruthy();
    }
  });

  it("gates only mount judge cards", () => {
    for (const m of mounted.filter((x) => x.where.startsWith("gate."))) {
      expect(getSkill(m.id)!.kind, `${m.tpl} ${m.where}`).toBe("judge");
    }
  });

  it("agents never mount judge cards", () => {
    for (const m of mounted.filter((x) => x.where.startsWith("textGen."))) {
      expect(getSkill(m.id)!.kind, `${m.tpl} ${m.where}`).not.toBe("judge");
    }
  });

  it("ships at least one template demonstrating each non-tool kind", () => {
    const kinds = new Set(mounted.map((m) => getSkill(m.id)!.kind));
    expect(kinds).toContain("prompt-module");
    expect(kinds).toContain("output-contract");
    expect(kinds).toContain("judge");
  });
});
