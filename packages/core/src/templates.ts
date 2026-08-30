import { z } from "zod";
import { Graph } from "./graph.js";

/**
 * A user-fillable placeholder in a template, e.g. a brand name or a target URL
 * that the template's node configs reference. Schema-only for now — the web
 * form UI is deferred (see docs/design-templates.md §3) — but the shape is
 * fixed here so future templates don't need a breaking change.
 */
export interface TemplateField {
  /** Stable key identifying this field, e.g. "brand". */
  key: string;
  /** Human label shown above the input, e.g. "品牌名". */
  label: string;
  /** Placeholder shown in the empty input. */
  placeholder?: string;
  /** Value used when the user skips the form. */
  defaultValue?: string;
  /**
   * Where the value goes: node-id + config-path pairs. The path is dot-joined
   * keys into the node object (e.g. "agent.prompt"); the field value REPLACES
   * the whole value at that path.
   */
  applyTo: { nodeId: string; path: string }[];
}

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
  /** Optional user-fillable placeholders applied at instantiation time. */
  fields?: TemplateField[];
  /** The graph definition. Nodes/edges carry descriptive, human-readable names. */
  graph: z.input<typeof Graph>;
}

/**
 * Set `value` at a dot-joined path inside `obj`, creating intermediate objects.
 * Copy-on-write: every level descended into is cloned first, because template
 * nodes are spread shallowly and their nested configs are still shared.
 */
function setPath(obj: Record<string, unknown>, keys: string[], value: string): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    else cur[k] = { ...(cur[k] as Record<string, unknown>) };
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

/**
 * Build a fresh graph from a template. Every node and edge id is replaced with a
 * short generated id so duplicated templates never collide. Declared `fields`
 * are applied on top: an explicit non-empty value wins, then the field's
 * defaultValue; fields with neither are left untouched.
 */
export function instantiateTemplate(
  template: GraphTemplate,
  opts?: { id?: string; name?: string; fieldValues?: Record<string, string> },
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
  // applyTo references template node ids — resolve them to the instantiated nodes.
  const byOldId = new Map(template.graph.nodes.map((n, i) => [n.id, nodes[i]!]));
  for (const field of template.fields ?? []) {
    const raw = opts?.fieldValues?.[field.key];
    const value = raw && raw.trim() !== "" ? raw : field.defaultValue;
    if (value === undefined) continue;
    for (const target of field.applyTo) {
      const node = byOldId.get(target.nodeId);
      if (!node) continue;
      setPath(node as unknown as Record<string, unknown>, target.path.split("."), value);
    }
  }
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
        kind: "textGen",
        name: "卖点提炼",
        x: 340,
        y: 300,
        textGen: {
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
        kind: "textGen",
        name: "文案撰写",
        x: 620,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是电商文案。基于上游提炼的卖点，撰写商品详情页正文：" +
            "一段吸引人的开场 + 分点的卖点描述 + 一句行动号召。语言有画面感、不说空话套话。",
          skills: [],
        },
      },
      {
        id: "layout",
        kind: "textGen",
        name: "排版整理",
        x: 900,
        y: 300,
        textGen: {
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
      { id: "banner", kind: "imageGen", name: "AI 配图", x: 340, y: 560, imageGen: { model: "agnes-image-2.0-flash", prompt: "结合上游主商品图，生成一张电商主图：保留商品主体与核心卖点，背景简洁统一，专业产品摄影质感" } },
      { id: "scene", kind: "imageGen", name: "AI 场景图", x: 560, y: 560, imageGen: { model: "agnes-image-2.0-flash", prompt: "为商品生成一张真实使用场景图：自然光线、生活化构图，突出使用环境与氛围代入感" } },
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
        kind: "textGen",
        name: "卖点提炼",
        x: 340,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是小红书选品编辑。根据商品文字描述和参考图片，提炼 4-6 个最适合种草的卖点，" +
            "每个卖点一行，突出使用场景、真实感受和情绪价值，结合图片细节。",
          skills: [],
        },
      },
      {
        id: "copy",
        kind: "textGen",
        name: "种草文案",
        x: 620,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt: "你是小红书爆款笔记作者。基于上游卖点，写一篇种草笔记：一个带钩子的标题（可带 emoji）、口语化短句正文、分点使用感受、3-6 个话题标签。语气真诚像朋友安利，不要硬广腔和极限词。",
          skills: [],
        },
      },
      {
        id: "layout",
        kind: "textGen",
        name: "笔记排版",
        x: 900,
        y: 300,
        textGen: {
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
      { id: "banner", kind: "imageGen", name: "AI 配图", x: 340, y: 560, imageGen: { model: "agnes-image-2.0-flash", prompt: "结合上游主商品图，生成一张电商主图：保留商品主体与核心卖点，背景简洁统一，专业产品摄影质感" } },
      { id: "scene", kind: "imageGen", name: "AI 场景图", x: 560, y: 560, imageGen: { model: "agnes-image-2.0-flash", prompt: "为商品生成一张真实使用场景图：自然光线、生活化构图，突出使用环境与氛围代入感" } },
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

const mediaPipelineGraph = {
  id: "tpl-media-pipeline",
  name: "短视频广告工坊",
  description: "主题 → 脚本(文本) → 关键帧配图(图片) + 短视频(视频) → 成品",
  category: "营销内容",
  graph: {
    id: "tpl-media-pipeline",
    name: "短视频广告工坊",
    nodes: [
      { id: "intake", kind: "source", name: "主题", x: 80, y: 300 },
      {
        id: "scriptwriter",
        kind: "textGen",
        name: "脚本撰写",
        x: 340,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是短视频编导。根据主题写一段 15 秒口播脚本：开头 3 秒钩子 + 中间卖点介绍 + 结尾行动号召。" +
            "只输出脚本正文（120-180 字），便于直接作为视频生成提示词；不要输出标题和多余解释。",
          skills: [],
        },
      },
      {
        id: "keyframe",
        kind: "imageGen",
        name: "关键帧配图",
        x: 620,
        y: 180,
        imageGen: {
          model: "agnes-image-2.0-flash",
          aspect: "16:9",
          prompt:
            "为短视频生成一张关键帧封面：电影级构图、自然光线、氛围感强、主体清晰、16:9 横版，适合作为视频封面。",
        },
      },
      {
        id: "video",
        kind: "videoGen",
        name: "短视频生成",
        x: 620,
        y: 440,
        videoGen: {
          model: "agnes-video-v2.0",
          // prompt 留空：引擎直接用上游脚本文本作为视频提示词，实现文本 → 视频联动
          duration: 5,
          aspect: "16:9",
        },
      },
      { id: "depot", kind: "sink", name: "成品库", x: 920, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "scriptwriter", kind: "flow" },
      { id: "e2", from: "scriptwriter", to: "keyframe", kind: "flow" },
      { id: "e3", from: "scriptwriter", to: "video", kind: "flow" },
      { id: "e4", from: "keyframe", to: "depot", kind: "flow" },
      { id: "e5", from: "video", to: "depot", kind: "flow" },
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
        kind: "textGen",
        name: "初稿",
        x: 360,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是写作助手。根据给定主题写一篇结构完整的初稿，包含开头、主体分点和结尾。",
          skills: [],
        },
      },
      {
        id: "polish",
        kind: "textGen",
        name: "润色",
        x: 640,
        y: 300,
        textGen: {
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
        kind: "textGen",
        name: "初译",
        x: 360,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是专业译者。把输入文本翻译成中文，忠实原意，不增删信息。先给译文，再给术语说明。",
          skills: [],
        },
      },
      {
        id: "review",
        kind: "textGen",
        name: "校对",
        x: 640,
        y: 300,
        textGen: {
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
        kind: "textGen",
        name: "问题清单",
        x: 360,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是文档审查员。逐段检查文档，列出问题：事实错误、逻辑矛盾、表述不清、缺漏。每条标明位置和问题。",
          skills: [],
        },
      },
      {
        id: "suggest",
        kind: "textGen",
        name: "修订建议",
        x: 640,
        y: 300,
        textGen: {
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

const opsWeeklyGraph = {
  id: "tpl-ops-weekly",
  name: "运营周报",
  description: "拉取数据 → 代码清洗汇总 → AI 生成周报",
  category: "数据分析",
  fields: [
    {
      key: "dataUrl",
      label: "数据接口地址",
      placeholder: "https://your-api.example.com/metrics",
      defaultValue: "https://raw.githubusercontent.com/github/rest-api-description/main/examples/README.md",
      applyTo: [{ nodeId: "fetch", path: "http.url" }],
    },
  ],
  graph: {
    id: "tpl-ops-weekly",
    name: "运营周报",
    nodes: [
      { id: "intake", kind: "source", name: "周期开关", x: 80, y: 300 },
      {
        id: "fetch",
        kind: "http",
        name: "拉取数据",
        x: 340,
        y: 300,
        http: {
          url: "https://raw.githubusercontent.com/github/rest-api-description/main/examples/README.md",
          method: "GET",
          outputMode: "json",
        },
      },
      {
        id: "clean",
        kind: "code",
        name: "清洗汇总",
        x: 600,
        y: 300,
        code: {
          language: "javascript",
          code: [
            "// 读取上游数据（http 节点输出 JSON；失败时走 error 边到兜底节点）",
            "const raw = JSON.parse(Object.values(inputs)[0] ?? \"{}\");",
            "// TODO: 按你的业务字段做清洗与聚合，这里给出一个通用骨架",
            "const rows = Array.isArray(raw) ? raw : (raw.items ?? raw.data ?? [raw]);",
            "const summary = {",
            "  总量: rows.length,",
            "  示例字段: Object.keys(rows[0] ?? {}).slice(0, 5),",
            "};",
            "console.log(JSON.stringify({ 原始行数: rows.length, 汇总: summary }, null, 2));",
          ].join("\n"),
        },
      },
      {
        id: "writer",
        kind: "textGen",
        name: "周报撰写",
        x: 860,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是数据运营分析师。基于上游清洗汇总后的数据，写一份结构化周报：" +
            "整体表现（2-3 句）→ 关键指标变化（分点，标注数字）→ 异常与原因推测 → 下周建议。" +
            "语言克制，结论必须有数据支撑，不要编造数据里没有的数字。",
          skills: [],
        },
      },
      { id: "depot", kind: "sink", name: "周报归档", x: 1140, y: 300 },
      {
        id: "fallback",
        kind: "textGen",
        name: "无数据兜底",
        x: 340,
        y: 560,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "上游数据拉取失败（可能是网络未开或 URL 需要更换）。请向用户说明：这是一个数据拉取→清洗→AI 周报的流水线，" +
            "请在「拉取数据」节点换成自己的 API 地址后重试。输出一段简短的说明文字。",
          skills: [],
        },
      },
    ],
    edges: [
      { id: "e0", from: "intake", to: "fetch", kind: "flow" },
      { id: "e1", from: "fetch", to: "clean", kind: "flow" },
      { id: "e2", from: "clean", to: "writer", kind: "flow" },
      { id: "e3", from: "writer", to: "depot", kind: "flow" },
      { id: "x1", from: "fetch", to: "fallback", kind: "error" },
      { id: "x2", from: "fallback", to: "depot", kind: "flow" },
    ],
  },
} satisfies GraphTemplate;

const patrolAlertGraph = {
  id: "tpl-patrol-alert",
  name: "定时巡检告警",
  description: "健康检查 → 分支判断异常 → 飞书告警 / 正常记录",
  category: "IT 运维",
  fields: [
    {
      key: "targetUrl",
      label: "监控目标地址",
      placeholder: "https://your-service.example.com/health",
      defaultValue: "https://httpbin.org/status/200",
      applyTo: [{ nodeId: "probe", path: "http.url" }],
    },
    {
      key: "alarmWebhookUrl",
      label: "告警通知 Webhook（群机器人地址）",
      placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/xxxx",
      applyTo: [{ nodeId: "alarm", path: "notify.webhookUrl" }],
    },
  ],
  graph: {
    id: "tpl-patrol-alert",
    name: "定时巡检告警",
    nodes: [
      { id: "intake", kind: "source", name: "巡检开关", x: 80, y: 300 },
      {
        id: "probe",
        kind: "http",
        name: "健康检查",
        x: 340,
        y: 300,
        http: {
          url: "https://httpbin.org/status/200",
          method: "GET",
          failOnError: true,
        },
      },
      {
        id: "judge",
        kind: "branch",
        name: "异常判断",
        x: 600,
        y: 300,
        branch: {
          rules: [
            { id: "r-down", when: "${probe.ok} != true", target: "alarm" },
          ],
          defaultTarget: "record",
        },
      },
      {
        id: "alarm",
        kind: "notify",
        name: "飞书告警",
        x: 860,
        y: 180,
        notify: {
          provider: "feishu",
          format: "markdown",
          message: "🚨 巡检异常：${probe.url} 健康检查失败（状态 ${probe.status}），请立即处理。",
        },
      },
      {
        id: "record",
        kind: "sink",
        name: "正常记录",
        x: 860,
        y: 420,
      },
    ],
    edges: [
      { id: "e0", from: "intake", to: "probe", kind: "flow" },
      { id: "e1", from: "probe", to: "judge", kind: "flow" },
      { id: "e2", from: "judge", to: "alarm", kind: "flow" },
      { id: "e3", from: "judge", to: "record", kind: "flow" },
    ],
  },
} satisfies GraphTemplate;

const researchBriefGraph = {
  id: "tpl-research-brief",
  name: "多源研究简报",
  description: "两路 HTTP 拉取 → 汇聚 → AI 综合研判 → 归档",
  category: "数据分析",
  fields: [
    {
      key: "srcAUrl",
      label: "数据源 A 地址",
      placeholder: "https://source-a.example.com/data.json",
      defaultValue: "https://httpbin.org/json",
      applyTo: [{ nodeId: "srcA", path: "http.url" }],
    },
    {
      key: "srcBUrl",
      label: "数据源 B 地址",
      placeholder: "https://source-b.example.com/data.json",
      defaultValue: "https://httpbin.org/json",
      applyTo: [{ nodeId: "srcB", path: "http.url" }],
    },
  ],
  graph: {
    id: "tpl-research-brief",
    name: "多源研究简报",
    nodes: [
      { id: "intake", kind: "source", name: "研究开关", x: 80, y: 300 },
      {
        id: "srcA",
        kind: "http",
        name: "数据源 A",
        x: 340,
        y: 180,
        http: { url: "https://httpbin.org/json", method: "GET", outputMode: "json" },
      },
      {
        id: "srcB",
        kind: "http",
        name: "数据源 B",
        x: 340,
        y: 420,
        http: { url: "https://httpbin.org/json", method: "GET", outputMode: "json" },
      },
      {
        id: "merge",
        kind: "parallel",
        name: "汇聚",
        x: 600,
        y: 300,
      },
      {
        id: "analyst",
        kind: "textGen",
        name: "综合研判",
        x: 860,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是研究分析师。上游汇聚了两个数据源的 JSON，请交叉比对后输出一份简报：" +
            "核心结论（1 句）→ 两源一致的信息 → 仅有单源提及、需要二次确认的信息 → 数据缺口。" +
            "把「换成自己的两个信息源」作为第一步建议写在开头。",
          skills: [],
        },
      },
      { id: "depot", kind: "sink", name: "简报归档", x: 1140, y: 300 },
    ],
    edges: [
      { id: "e0", from: "intake", to: "srcA", kind: "flow" },
      { id: "e0b", from: "intake", to: "srcB", kind: "flow" },
      { id: "e1", from: "srcA", to: "merge", kind: "flow" },
      { id: "e2", from: "srcB", to: "merge", kind: "flow" },
      { id: "e3", from: "merge", to: "analyst", kind: "flow" },
      { id: "e4", from: "analyst", to: "depot", kind: "flow" },
    ],
  },
} satisfies GraphTemplate;

const competitorWatchGraph = {
  id: "tpl-competitor-watch",
  name: "竞品监控摘要",
  description: "拉取竞品页面 → 代码提取 → AI 对比摘要",
  category: "IT 运维",
  fields: [
    {
      key: "pageUrl",
      label: "竞品页地址",
      placeholder: "https://competitor.example.com/pricing",
      defaultValue: "https://httpbin.org/html",
      applyTo: [{ nodeId: "fetch", path: "http.url" }],
    },
  ],
  graph: {
    id: "tpl-competitor-watch",
    name: "竞品监控摘要",
    nodes: [
      { id: "intake", kind: "source", name: "监控开关", x: 80, y: 300 },
      {
        id: "fetch",
        kind: "http",
        name: "拉取竞品页",
        x: 340,
        y: 300,
        http: {
          url: "https://httpbin.org/html",
          method: "GET",
          outputMode: "text",
        },
      },
      {
        id: "extract",
        kind: "code",
        name: "字段提取",
        x: 600,
        y: 300,
        code: {
          language: "javascript",
          code: [
            "// 从页面文本里抽取关心的字段；替换成正则以匹配你的竞品页面结构",
            "const html = String(Object.values(inputs)[0] ?? \"\");",
            "const text = html.replace(/<[^>]+>/g, \" \").replace(/\\s+/g, \" \").trim();",
            "console.log(JSON.stringify({",
            "  长度: text.length,",
            "  摘要: text.slice(0, 200),",
            "  抓取时间: new Date().toISOString(),",
            "}, null, 2));",
          ].join("\n"),
        },
      },
      {
        id: "compare",
        kind: "textGen",
        name: "对比摘要",
        x: 860,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是竞品情报分析师。上游提取了竞品页面的摘要信息，请与「我方产品」对比，输出：" +
            "一句话动向判断 → 值得关注的改动（分点）→ 建议的应对动作。我方产品信息会在运行时由上游输入提供。",
          skills: [],
        },
      },
      { id: "depot", kind: "sink", name: "情报归档", x: 1140, y: 300 },
      {
        id: "fallback",
        kind: "textGen",
        name: "拉取失败兜底",
        x: 340,
        y: 560,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "上游页面拉取失败（外网未开通或站点反爬）。请输出简短说明：本流水线为竞品监控，" +
            "需要把「拉取竞品页」节点换成可访问的目标地址（或改为本地静态数据）后重试。",
          skills: [],
        },
      },
    ],
    edges: [
      { id: "e0", from: "intake", to: "fetch", kind: "flow" },
      { id: "e1", from: "fetch", to: "extract", kind: "flow" },
      { id: "e2", from: "extract", to: "compare", kind: "flow" },
      { id: "e3", from: "compare", to: "depot", kind: "flow" },
      { id: "x1", from: "fetch", to: "fallback", kind: "error" },
      { id: "x2", from: "fallback", to: "depot", kind: "flow" },
    ],
  },
} satisfies GraphTemplate;

export const TEMPLATES: GraphTemplate[] = [
  productDetailGraph,
  xiaohongshuGraph,
  mediaPipelineGraph,
  draftGraph,
  translationGraph,
  docReviewGraph,
  opsWeeklyGraph,
  patrolAlertGraph,
  researchBriefGraph,
  competitorWatchGraph,
  blankGraph,
];

export function getTemplate(id: string): GraphTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
