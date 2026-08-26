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
  name: "淘宝商品详情",
  description: "产品图 → 卖点 → 详情文案 → 图文排版 → 质检 → 成品",
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
            "你是淘宝详情页排版编辑。把上游文案整理成结构化商品详情页。只输出一个 ```product-json 代码块，不要输出其他文字，JSON 结构如下：\n```product-json\n{\"platform\":\"taobao\",\"title\":\"商品标题\",\"blocks\":[{\"type\":\"hero\",\"title\":\"主标题\",\"subtitle\":\"一句话核心卖点\",\"image\":\"第一张图URL\"},{\"type\":\"heading\",\"text\":\"产品亮点\"},{\"type\":\"bullets\",\"items\":[\"**亮点1**：说明\",\"亮点2：说明\"]},{\"type\":\"image\",\"src\":\"图URL\",\"caption\":\"图注\",\"align\":\"full\",\"aspect\":\"3:4\"},{\"type\":\"imageCards\",\"layout\":\"grid\",\"columns\":2,\"items\":[{\"src\":\"图URL\",\"caption\":\"图注\",\"span\":2}]},{\"type\":\"paragraph\",\"text\":\"2-3段有画面感的描述\"},{\"type\":\"specs\",\"rows\":[{\"name\":\"参数名\",\"value\":\"值\"}]},{\"type\":\"cta\",\"text\":\"立即选购行动号召\"}]}\n```\n图片使用上游提供的真实图片 URL，不要编造；没有图的块可以省略 image/imageCards。图片区块可加 align(full/left/right/center) 控制位置、aspect(1:1/3:4/4:3/16:9) 控制比例、rounded 控制圆角；多图卡用 layout(grid/carousel/row) 与 columns 控制版式。",
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
            "必须输出合法的 product-json，包含 hero、至少 4 个卖点、规格参数、行动号召；图片用上游真实 URL，不得有空话套话和极限词。",
          onExhausted: "halt",
        },
      },
      { id: "banner", kind: "imageGen", name: "AI 配图", x: 340, y: 560, imageGen: { model: "agnes-image", prompt: "" } },
      { id: "scene", kind: "imageGen", name: "AI 场景图", x: 560, y: 560, imageGen: { model: "agnes-image", prompt: "为商品生成一张真实使用场景图：自然光线、生活化构图，突出使用环境与氛围代入感" } },
      { id: "depot", kind: "sink", name: "成品库", x: 1460, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "selling", kind: "flow" },
      { id: "e2", from: "selling", to: "copy", kind: "flow" },
      { id: "e3", from: "copy", to: "layout", kind: "flow" },
      { id: "e4", from: "layout", to: "qc", kind: "flow" },
      { id: "e5", from: "qc", to: "depot", kind: "flow" },
      { id: "r1", from: "qc", to: "copy", kind: "rework" },
      { id: "e6", from: "intake", to: "banner", kind: "flow" },
      { id: "e7", from: "banner", to: "layout", kind: "flow" },
      { id: "e8", from: "intake", to: "scene", kind: "flow" },
      { id: "e9", from: "scene", to: "layout", kind: "flow" },
    ],
  },
} satisfies GraphTemplate;

const xiaohongshuGraph = {
  id: "tpl-xiaohongshu",
  name: "小红书种草笔记",
  description: "产品图 → 卖点 → 种草文案 → 笔记排版 → 质检 → 成品",
  category: "营销内容",
  graph: {
    id: "tpl-xiaohongshu",
    name: "小红书种草笔记",
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
            "你是小红书选品编辑。根据商品文字描述和参考图片，提炼 4-6 个最适合种草的卖点，" +
            "每个卖点一行，突出使用场景、真实感受和情绪价值，结合图片细节。",
          skills: [],
        },
      },
      {
        id: "copy",
        kind: "agent",
        name: "种草文案",
        x: 620,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt: "你是小红书爆款笔记作者。基于上游卖点，写一篇种草笔记：一个带钩子的标题（可带 emoji）、口语化短句正文、分点使用感受、3-6 个话题标签。语气真诚像朋友安利，不要硬广腔和极限词。",
          skills: [],
        },
      },
      {
        id: "layout",
        kind: "agent",
        name: "笔记排版",
        x: 900,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt: "你是小红书笔记排版编辑。把上游文案整理成结构化笔记。只输出一个 ```product-json 代码块，不要输出其他文字，结构如下：\n```product-json\n{\"platform\":\"xiaohongshu\",\"title\":\"笔记标题\",\"blocks\":[{\"type\":\"hero\",\"title\":\"带钩子的标题\",\"subtitle\":\"一句话种草\",\"image\":\"封面图URL\"},{\"type\":\"paragraph\",\"text\":\"口语化开场\"},{\"type\":\"bullets\",\"items\":[\"✨ 卖点1\",\"🌟 卖点2\"]},{\"type\":\"image\",\"src\":\"图URL\",\"caption\":\"图注\",\"align\":\"center\",\"aspect\":\"3:4\"},{\"type\":\"imageCards\",\"layout\":\"carousel\",\"columns\":2,\"items\":[{\"src\":\"图URL\",\"caption\":\"图注\"}]},{\"type\":\"paragraph\",\"text\":\"使用感受总结\"},{\"type\":\"cta\",\"text\":\"互动引导 + #标签1 #标签2\"}]}\n```\n图片使用上游真实图片 URL，不要编造；没有图可省略 image/imageCards。图片区块可加 align(full/left/right/center) 控制位置、aspect(1:1/3:4/4:3/16:9) 控制比例、rounded 控制圆角；多图卡用 layout(grid/carousel/row) 与 columns 控制版式。",
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
          criterion: "必须输出合法的 product-json，含吸睛标题、至少 3 个分点、正文和带话题标签的 CTA；语气自然，无硬广极限词。",
          onExhausted: "halt",
        },
      },
      { id: "banner", kind: "imageGen", name: "AI 配图", x: 340, y: 560, imageGen: { model: "agnes-image", prompt: "" } },
      { id: "scene", kind: "imageGen", name: "AI 场景图", x: 560, y: 560, imageGen: { model: "agnes-image", prompt: "为商品生成一张真实使用场景图：自然光线、生活化构图，突出使用环境与氛围代入感" } },
      { id: "depot", kind: "sink", name: "成品库", x: 1460, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "selling", kind: "flow" },
      { id: "e2", from: "selling", to: "copy", kind: "flow" },
      { id: "e3", from: "copy", to: "layout", kind: "flow" },
      { id: "e4", from: "layout", to: "qc", kind: "flow" },
      { id: "e5", from: "qc", to: "depot", kind: "flow" },
      { id: "r1", from: "qc", to: "copy", kind: "rework" },
      { id: "e6", from: "intake", to: "banner", kind: "flow" },
      { id: "e7", from: "banner", to: "layout", kind: "flow" },
      { id: "e8", from: "intake", to: "scene", kind: "flow" },
      { id: "e9", from: "scene", to: "layout", kind: "flow" },
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

const draftGraph = {
  id: "tpl-draft",
  name: "写草稿",
  description: "主题 → 初稿 → 润色 → 质检 → 成稿，通用写作流水线",
  category: "写作",
  graph: {
    id: "tpl-draft",
    name: "写草稿",
    nodes: [
      { id: "intake", kind: "source", name: "主题", x: 80, y: 300 },
      {
        id: "draft",
        kind: "agent",
        name: "初稿",
        x: 360,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt:
            "你是写作助手。根据给定主题写一篇结构完整的初稿，包含开头、主体分点和结尾。",
          skills: [],
        },
      },
      {
        id: "polish",
        kind: "agent",
        name: "润色",
        x: 640,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt:
            "你是文字编辑。润色初稿：让语言更流畅、删除冗余、统一语气，但不要改变核心观点。",
          skills: [],
        },
      },
      {
        id: "qc",
        kind: "gate",
        name: "质检",
        x: 920,
        y: 300,
        gate: {
          maxAttempts: 3,
          criterion: "必须结构完整、无明显语病、不少于三段。",
          onExhausted: "halt",
        },
      },
      { id: "depot", kind: "sink", name: "成稿", x: 1200, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "draft", kind: "flow" },
      { id: "e2", from: "draft", to: "polish", kind: "flow" },
      { id: "e3", from: "polish", to: "qc", kind: "flow" },
      { id: "e4", from: "qc", to: "depot", kind: "flow" },
      { id: "r1", from: "qc", to: "draft", kind: "rework" },
    ],
  },
} satisfies GraphTemplate;

const translationGraph = {
  id: "tpl-translation",
  name: "翻译流水线",
  description: "原文 → 初译 → 校对润色 → 质检 → 译文",
  category: "写作",
  graph: {
    id: "tpl-translation",
    name: "翻译流水线",
    nodes: [
      { id: "intake", kind: "source", name: "原文", x: 80, y: 300 },
      {
        id: "translate",
        kind: "agent",
        name: "初译",
        x: 360,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt:
            "你是专业译者。把输入文本翻译成中文，忠实原意，不增删信息。先给译文，再给术语说明。",
          skills: [],
        },
      },
      {
        id: "review",
        kind: "agent",
        name: "校对",
        x: 640,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt:
            "你是译审。对照原意检查初译：错译、漏译、生硬表达，输出修订后的流畅译文。",
          skills: [],
        },
      },
      {
        id: "qc",
        kind: "gate",
        name: "质检",
        x: 920,
        y: 300,
        gate: {
          maxAttempts: 3,
          criterion: "译文完整覆盖原意，无语义遗漏，中文自然通顺。",
          onExhausted: "halt",
        },
      },
      { id: "depot", kind: "sink", name: "译文", x: 1200, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "translate", kind: "flow" },
      { id: "e2", from: "translate", to: "review", kind: "flow" },
      { id: "e3", from: "review", to: "qc", kind: "flow" },
      { id: "e4", from: "qc", to: "depot", kind: "flow" },
      { id: "r1", from: "qc", to: "translate", kind: "rework" },
    ],
  },
} satisfies GraphTemplate;

const docReviewGraph = {
  id: "tpl-doc-review",
  name: "文档审查",
  description: "文档 → 问题清单 → 修订建议 → 质检 → 审查报告",
  category: "审查",
  graph: {
    id: "tpl-doc-review",
    name: "文档审查",
    nodes: [
      { id: "intake", kind: "source", name: "待审文档", x: 80, y: 300 },
      {
        id: "issues",
        kind: "agent",
        name: "问题清单",
        x: 360,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt:
            "你是文档审查员。逐段检查文档，列出问题：事实错误、逻辑矛盾、表述不清、缺漏。每条标明位置和问题。",
          skills: [],
        },
      },
      {
        id: "suggest",
        kind: "agent",
        name: "修订建议",
        x: 640,
        y: 300,
        agent: {
          model: "agnes-2.0-flash",
          prompt:
            "针对问题清单给出具体的修改建议，最好给出可直接替换的文字。输出一份审查报告。",
          skills: [],
        },
      },
      {
        id: "qc",
        kind: "gate",
        name: "质检",
        x: 920,
        y: 300,
        gate: {
          maxAttempts: 3,
          criterion: "报告必须覆盖所有发现的问题，每条建议具体可执行。",
          onExhausted: "halt",
        },
      },
      { id: "depot", kind: "sink", name: "审查报告", x: 1200, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "issues", kind: "flow" },
      { id: "e2", from: "issues", to: "suggest", kind: "flow" },
      { id: "e3", from: "suggest", to: "qc", kind: "flow" },
      { id: "e4", from: "qc", to: "depot", kind: "flow" },
      { id: "r1", from: "qc", to: "issues", kind: "rework" },
    ],
  },
} satisfies GraphTemplate;

export const TEMPLATES: GraphTemplate[] = [
  productDetailGraph,
  xiaohongshuGraph,
  draftGraph,
  translationGraph,
  docReviewGraph,
  blankGraph,
];

export function getTemplate(id: string): GraphTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
