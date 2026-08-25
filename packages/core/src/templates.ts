import { z } from "zod";
import { Graph } from "./graph.js";

/**
 * A reusable production-line blueprint. Templates are plain graphs with stable
 * placeholder ids; the runtime strips ids when instantiating so each created
 * graph gets fresh identity.
 */
export interface GraphTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  /** The graph definition. Nodes/edges carry descriptive, human-readable names. */
  graph: z.input<typeof Graph>;
}

/**
 * Build a fresh graph from a template. Every node and edge id is replaced with a
 * short generated id so duplicated templates never collide.
 */
export function instantiateTemplate(
  template: GraphTemplate,
  opts?: { id?: string; name?: string },
): z.infer<typeof Graph> {
  const idMap = new Map<string, string>();
  const uid = (oldId: string) => {
    const existing = idMap.get(oldId);
    if (existing) return existing;
    const fresh = `${oldId.replace(/[^a-z0-9]/gi, "").slice(0, 6) || "n"}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    idMap.set(oldId, fresh);
    return fresh;
  };

  const nodes = template.graph.nodes.map((n) => ({
    ...n,
    id: uid(n.id),
  }));
  const edges = template.graph.edges.map((e) => ({
    ...e,
    id: `e-${Math.random().toString(36).slice(2, 7)}`,
    from: uid(e.from),
    to: uid(e.to),
  }));

  return Graph.parse({
    id: opts?.id ?? `tpl-${Date.now().toString(36)}`,
    name: opts?.name ?? template.name,
    nodes,
    edges,
  });
}

const productDetailGraph = {
  id: "tpl-product",
  name: "商品详情页",
  description: "文字描述 + 参考图 → 卖点 → 文案 → 排版 → 质检 → 成品",
  category: "营销内容",
  graph: {
    id: "tpl-product",
    name: "商品详情页",
    nodes: [
      { id: "intake", kind: "source", name: "原料台", x: 80, y: 300 },
      {
        id: "selling",
        kind: "agent",
        name: "卖点提炼",
        x: 340,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt:
            "你是电商卖点分析师。根据商品的文字描述和参考图片，提炼 5-8 个核心卖点。" +
            "每个卖点一行，先给一个短标题，再用一句话说明对用户的价值。" +
            "如果提供了图片，结合图片里看到的细节（材质、外观、使用场景）。",
          skills: [],
        },
      },
      {
        id: "copy",
        kind: "agent",
        name: "文案撰写",
        x: 620,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt:
            "你是电商文案。基于上游提炼的卖点，撰写商品详情页正文：" +
            "一段吸引人的开场 + 分点的卖点描述 + 一句行动号召。语言有画面感、不说空话套话。",
          skills: [],
        },
      },
      {
        id: "layout",
        kind: "agent",
        name: "排版整理",
        x: 900,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt:
            "你是详情页编辑。把文案整理成可直接上架的结构化排版，" +
            "用 Markdown 标注标题、分点、重点加粗，并给出配图位建议（用 [图: ...] 占位）。",
          skills: [],
        },
      },
      {
        id: "qc",
        kind: "gate",
        name: "质检站",
        x: 1180,
        y: 300,
        gate: {
          maxAttempts: 3,
          criterion:
            "必须包含开场、至少 4 个卖点分点、行动号召，且有配图位建议；不得有明显的空话套话。",
          onExhausted: "halt",
        },
      },
      { id: "depot", kind: "sink", name: "成品库", x: 1460, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "selling", kind: "flow" },
      { id: "e2", from: "selling", to: "copy", kind: "flow" },
      { id: "e3", from: "copy", to: "layout", kind: "flow" },
      { id: "e4", from: "layout", to: "qc", kind: "flow" },
      { id: "e5", from: "qc", to: "depot", kind: "flow" },
      { id: "r1", from: "qc", to: "copy", kind: "rework" },
    ],
  },
} satisfies GraphTemplate;

const blankGraph = {
  id: "tpl-blank",
  name: "空白产线",
  description: "从一块空地开始搭建",
  category: "基础",
  graph: {
    id: "tpl-blank",
    name: "空白产线",
    nodes: [],
    edges: [],
  },
} satisfies GraphTemplate;

export const TEMPLATES: GraphTemplate[] = [productDetailGraph, blankGraph];

export function getTemplate(id: string): GraphTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
