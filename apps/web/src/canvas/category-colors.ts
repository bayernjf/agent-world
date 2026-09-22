import { NODE_CATEGORY, type NodeCategory, type NodeKind } from "@agent-world/core";

/** Base color per node category (five factory-zone tints). */
export const CATEGORY_COLORS: Record<NodeCategory, number> = {
  generation: 0x8b7cf6,
  control: 0xff9d2e,
  data: 0x2eb8a6,
  integrations: 0x69c35b,
  io: 0xd9a441,
};

export function categoryColor(kind: NodeKind): number {
  return CATEGORY_COLORS[NODE_CATEGORY[kind]];
}
