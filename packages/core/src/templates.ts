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

/** Config fields whose value is (or starts with) a node id, not a plain string. */
const NODE_ID_REF_FIELDS = new Set(["source", "target", "items", "iterate", "pick"]);

/**
 * Rewrite node-id references inside a node's config so they survive re-id.
 * Handles three shapes:
 *  - `${oldId.path}` and `inputs.oldId.path` variable references in any string;
 *  - `inputs["oldId"]` (browser syntax) in code-node scripts;
 *  - bare node-id values in reference fields (`source`/`target`/`items`/…).
 * The node object is walked and mutated in place — callers must pass a clone.
 */
function rewriteNodeIdRefs(node: Record<string, unknown>, idMap: Map<string, string>): void {
  const rewriteString = (s: string, field: string): string => {
    let out = s;
    for (const [oldId, newId] of idMap) {
      out = out.split(`\${${oldId}`).join(`\${${newId}`);
      out = out.split(`inputs.${oldId}`).join(`inputs.${newId}`);
      out = out.split(`inputs["${oldId}"]`).join(`inputs["${newId}"]`);
    }
    if (NODE_ID_REF_FIELDS.has(field)) {
      // Rewrite a leading node-id token (bare or a dotted path root).
      const renamed = (() => {
        if (out.trim() === "") return undefined;
        const seg = out.trim().split(/[.:]/)[0]!;
        return idMap.get(seg);
      })();
      if (renamed) {
        out = out.replace(/^[^.:\[\]]+/, renamed);
      }
    }
    return out;
  };

  const walk = (obj: Record<string, unknown>) => {
    for (const key of Object.keys(obj)) {
      if (key === "id") continue;
      const v = obj[key];
      if (typeof v === "string") {
        obj[key] = rewriteString(v, key);
      } else if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          const el = v[i];
          if (typeof el === "string") v[i] = rewriteString(el, key);
          else if (el && typeof el === "object") walk(el as Record<string, unknown>);
        }
      } else if (v && typeof v === "object") {
        walk(v as Record<string, unknown>);
      }
    }
  };
  walk(node);
}

/**
 * Build a fresh graph from a template. Every node and edge id is replaced with a
 * short generated id so duplicated templates never collide. Node-id references
 * bound into configs (`${probe.url}`, `inputs.src`, branch targets, `source`
 * fields) are rewritten to the fresh ids. Declared `fields` are applied on top:
 * an explicit non-empty value wins, then the field's defaultValue; fields with
 * neither are left untouched. The template definition itself is never mutated.
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

  const nodes = template.graph.nodes.map((n) => {
    // Deep clone so reference rewriting never mutates the shared template
    // definition (configs are nested plain objects shared with
    // template.graph.nodes, and are JSON-serializable).
    const clone = JSON.parse(JSON.stringify(n)) as Record<string, unknown>;
    clone.id = uid(clone.id as string);
    rewriteNodeIdRefs(clone, idMap);
    return clone;
  });
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
  description: "原文 → 专用翻译节点初译 → 校对润色 → 质检 → 译文",
  category: "写作",
  fields: [
    {
      key: "targetLang",
      label: "目标语言",
      placeholder: "简体中文 / English / 日本語 …",
      defaultValue: "简体中文",
      applyTo: [{ nodeId: "translate", path: "translate.target" }],
    },
  ],
  graph: {
    id: "tpl-translation",
    name: "翻译流水线",
    nodes: [
      { id: "intake", kind: "source", name: "原文", x: 80, y: 300 },
      {
        id: "translate",
        kind: "translate",
        name: "初译",
        x: 360,
        y: 300,
        // 专用翻译节点：低温度保忠实，目标语言由模板字段控制。
        translate: { target: "简体中文" },
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
  category: "数据分析",
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

const batchContentGraph = {
  id: "tpl-batch-content",
  name: "批量内容工坊",
  description: "批量清单 → 逐条简报 → 成批成稿 → 质检 → 成品（Map 批处理）",
  category: "营销内容",
  graph: {
    id: "tpl-batch-content",
    name: "批量内容工坊",
    nodes: [
      { id: "intake", kind: "source", name: "原料清单", x: 80, y: 300 },
      {
        id: "split",
        kind: "code",
        name: "拆条",
        x: 360,
        y: 300,
        code: {
          language: "javascript",
          code: [
            '// 读取上游粘贴的批量清单（一行一条），拆成一个待生产条目数组。',
            'const raw = String(Object.values(inputs)[0] ?? "").trim();',
            'const lines = raw.split(/\\r?\\n/).map(function (s) { return s.trim(); }).filter(Boolean);',
            'const items = lines.map(function (title, i) { return { id: i + 1, title: title }; });',
            'console.log(JSON.stringify({ items: items }));',
          ].join("\n"),
        },
      },
      {
        id: "brief",
        kind: "map",
        name: "批量简报",
        x: 640,
        y: 300,
        map: {
          iterate: "items",
          template: JSON.stringify({
            seq: "${item.id}",
            title: "${item.title}",
            brief:
              "围绕《${item.title}》写一篇公众号推文：先抛出一个痛点场景，再给出可落地的解决步骤，结尾自然引导关注。要求口语化、亲切，约 320 字。",
          }),
        },
      },
      {
        id: "writer",
        kind: "textGen",
        name: "批量成稿",
        x: 920,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是批量内容主编。下面是一批选题简报（JSON 数组），每项含 title 和 brief。请为每一条简报分别生成一篇完整的公众号推文正文，以编号“一、二、三…”分隔输出，篇与篇相互独立、可直接发布。",
          skills: [],
        },
      },
      {
        id: "qc",
        kind: "gate",
        name: "质检",
        x: 1180,
        y: 300,
        gate: {
          maxAttempts: 3,
          criterion: "每篇推文结构完整（标题+正文+结尾）、无空项、覆盖清单里的全部选题。",
          onExhausted: "halt",
        },
      },
      { id: "depot", kind: "sink", name: "成品库", x: 1460, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "split", kind: "flow" },
      { id: "e2", from: "split", to: "brief", kind: "flow" },
      { id: "e3", from: "brief", to: "writer", kind: "flow" },
      { id: "e4", from: "writer", to: "qc", kind: "flow" },
      { id: "e5", from: "qc", to: "depot", kind: "flow" },
      { id: "r1", from: "qc", to: "writer", kind: "rework" },
    ],
  },
} satisfies GraphTemplate;

const docIngestGraph = {
  id: "tpl-doc-ingest",
  name: "文档智能解析入库",
  description: "拉文档 → 解析正文与图片 → OCR → 归纳入库（表格化清单）",
  category: "办公协同",
  fields: [
    {
      key: "docUrl",
      label: "文档链接",
      placeholder: "填入 PDF / DOCX 等文档的公开链接",
      defaultValue: "https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf",
      applyTo: [{ nodeId: "fetch", path: "http.url" }],
    },
  ],
  graph: {
    id: "tpl-doc-ingest",
    name: "文档智能解析入库",
    nodes: [
      { id: "intake", kind: "source", name: "文档入口", x: 80, y: 140 },
      {
        id: "fetch",
        kind: "http",
        name: "拉取文档",
        x: 360,
        y: 140,
        http: {
          method: "GET",
          url: "https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf",
          outputMode: "file",
          retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 5000 },
        },
      },
      {
        id: "parse",
        kind: "fileParse",
        name: "文档解析",
        x: 640,
        y: 140,
        fileParse: { maxImages: 10 },
      },
      {
        id: "ocr",
        kind: "ocr",
        name: "图文 OCR",
        x: 840,
        y: 60,
        ocr: { lang: "chi_sim+eng" },
      },
      {
        // OCR 兜底：纯文字 PDF 没有嵌入图片时 OCR 节点会失败，这里接住它，
        // 让"归纳入库"仍然拿到正文文本（图片 OCR 字符数记 0）。
        id: "ocrFallback",
        kind: "code",
        name: "OCR 兜底",
        x: 840,
        y: 480,
        code: {
          language: "javascript",
          code: [
            '// OCR 失败（多数是文档没有嵌入图片）时输出空文本，保证主流程继续。',
            'console.log("");',
          ].join("\n"),
        },
      },
      {
        id: "combine",
        kind: "code",
        name: "归纳入库",
        x: 1080,
        y: 300,
        code: {
          language: "javascript",
          code: [
            '// 汇总正文文本与图片 OCR 文本，输出一行一字段的结构化清单。',
            'const parseText = String(inputs["parse"] ?? "");',
            '// OCR 失败时上游是错误对象而非文本，此时回退到兜底节点的空串。',
            'const ocrText = typeof inputs["ocr"] === "string" ? inputs["ocr"] : String(inputs["ocrFallback"] ?? "");',
            'const text = parseText + "\n" + ocrText;',
            'const firstLine = (parseText.split("\n")[0] || "(无标题)").trim().slice(0, 40);',
            'const rows = [',
            '  { field: "文档字符数", value: text.length },',
            '  { field: "段落数", value: parseText.split(/\\n{2,}/).length },',
            '  { field: "图片 OCR 字符数", value: ocrText.length },',
            '  { field: "首行摘录", value: firstLine },',
            '];',
            'console.log(JSON.stringify(rows));',
          ].join("\n"),
        },
      },
      {
        id: "table",
        kind: "table",
        name: "结构化入库",
        x: 1320,
        y: 300,
        table: {
          steps: [{ op: "output", format: "json" }],
        },
      },
      { id: "depot", kind: "sink", name: "入库清单", x: 1540, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "fetch", kind: "flow" },
      { id: "e2", from: "fetch", to: "parse", kind: "flow" },
      { id: "e3", from: "parse", to: "ocr", kind: "flow" },
      { id: "e4", from: "parse", to: "combine", kind: "flow" },
      { id: "e5", from: "ocr", to: "combine", kind: "flow" },
      { id: "x1", from: "ocr", to: "ocrFallback", kind: "error" },
      { id: "e5b", from: "ocrFallback", to: "combine", kind: "flow" },
      { id: "e6", from: "combine", to: "table", kind: "flow" },
      { id: "e7", from: "table", to: "depot", kind: "flow" },
    ],
  },
} satisfies GraphTemplate;

const reviewPublishGraph = {
  id: "tpl-review-publish",
  name: "人工审核发布",
  description: "自动成稿 → N 次自检 → 送审通知 → 人工终审 → 正式发布（审校闭环）",
  category: "营销内容",
  fields: [
    {
      key: "reviewWebhookUrl",
      label: "送审通知 Webhook",
      placeholder: "填入飞书 / 钉钉 / 企业微信机器人的 webhook 地址",
      applyTo: [{ nodeId: "notify", path: "notify.webhookUrl" }],
    },
  ],
  graph: {
    id: "tpl-review-publish",
    name: "人工审核发布",
    nodes: [
      {
        id: "intake",
        kind: "source",
        name: "素材输入",
        x: 80,
        y: 300,
      },
      {
        id: "writer",
        kind: "textGen",
        name: "自动成稿",
        x: 360,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是内容运营。根据上游提供的素材，产出一篇结构完整、可直接发布的文案：先提炼核心卖点，再分点展开，最后给出行动号召。口语化、有亲和力。",
          skills: [],
        },
      },
      {
        id: "qc",
        kind: "gate",
        name: "自检把关",
        x: 640,
        y: 300,
        gate: {
          maxAttempts: 3,
          criterion: "文案无事实性错误、无敏感词/违禁词、结构完整（标题+正文+行动号召）、语气统一。",
          onExhausted: "halt",
        },
      },
      {
        id: "notify",
        kind: "notify",
        name: "送审通知",
        x: 920,
        y: 460,
        notify: {
          provider: "feishu",
          format: "markdown",
          // message 留空：notify 会把上游成稿文本作为送审内容原样发出。
          message: "",
        },
      },
      {
        // 送审通知兜底：未配置 webhook 时 notify 节点会失败，这里接住它，
        // 人工终审照常进行（审核不依赖外部通知渠道）。
        id: "notifyFallback",
        kind: "code",
        name: "通知兜底",
        x: 1180,
        y: 560,
        code: {
          language: "javascript",
          code: [
            '// 未配置送审 webhook 时走这里：直接放行，人工终审在界面上进行。',
            'console.log("(未配置送审通知 webhook，已跳过外部通知)");',
          ].join("\n"),
        },
      },
      {
        id: "human",
        kind: "human",
        name: "人工终审",
        x: 1180,
        y: 300,
        human: {
          prompt: "请审阅这篇待发布文案：通过则发布；如需修改请直接编辑；不符合要求可驳回（驳回将触发失败回退）。",
        },
      },
      { id: "publish", kind: "sink", name: "正式发布", x: 1460, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "writer", kind: "flow" },
      { id: "e2", from: "writer", to: "qc", kind: "flow" },
      { id: "e3", from: "qc", to: "notify", kind: "flow" },
      { id: "e4", from: "qc", to: "human", kind: "flow" },
      { id: "e5", from: "human", to: "publish", kind: "flow" },
      { id: "e6", from: "notify", to: "publish", kind: "flow" },
      { id: "x1", from: "notify", to: "notifyFallback", kind: "error" },
      { id: "x2", from: "notifyFallback", to: "publish", kind: "flow" },
      { id: "r1", from: "qc", to: "writer", kind: "rework" },
    ],
  },
} satisfies GraphTemplate;

const customModelGraph = {
  id: "tpl-custom-model",
  name: "自定义模型接入",
  description: "一组通用入口 → 编排多模态请求体 → 任意模型推理 → 成品（泛化节点 + 自定义模型）",
  category: "开发集成",
  fields: [
    {
      key: "modelName",
      label: "模型名",
      placeholder: "填入你要接入的模型（内置或自定义）",
      defaultValue: "agnes-2.0-flash",
      applyTo: [{ nodeId: "gen", path: "generic.model" }],
    },
    {
      key: "customBaseUrl",
      label: "自定义 Endpoint (可选)",
      placeholder: "对接私有/第三方网关时填写，例如 https://gateway.example.com/v1",
      applyTo: [{ nodeId: "gen", path: "generic.baseUrl" }],
    },
  ],
  graph: {
    id: "tpl-custom-model",
    name: "自定义模型接入",
    nodes: [
      {
        id: "intake",
        kind: "source",
        name: "请求输入",
        x: 80,
        y: 300,
      },
      {
        id: "craft",
        kind: "code",
        name: "编排请求体",
        x: 360,
        y: 300,
        code: {
          language: "javascript",
          code: [
            '// 读取上游输入，按模态组装一条推理请求承载（文本 / 图片 / 视频 / 音频由泛化节点自动分派）。',
            'const raw = String(Object.values(inputs)[0] ?? "");',
            'const tone = "专业、通顺、信息密度高、避免车轱辘话";',
            'const payload = {',
            '  intent: "根据输入的原始内容进行一次高质量加工与润色",',
            '  constraint: tone,',
            '  sourceText: raw,',
            '  outputShape: "回传一段可直接使用的文本；若输入为待总结内容则先给三点要点再给全文"。',
            '};',
            'console.log(JSON.stringify(payload));',
          ].join("\n"),
        },
      },
      {
        id: "gen",
        kind: "generic",
        name: "自定义模型推理",
        x: 640,
        y: 300,
        generic: {
          model: "agnes-2.0-flash",
          modality: "text",
          prompt:
            "下面是编排好的推理请求（JSON），请按其中的 intent / constraint / outputShape 执行并返回加工后的结果：\n${craft.output}",
        },
      },
      { id: "depot", kind: "sink", name: "成品输出", x: 920, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "craft", kind: "flow" },
      { id: "e2", from: "craft", to: "gen", kind: "flow" },
      { id: "e3", from: "gen", to: "depot", kind: "flow" },
    ],
  },
} satisfies GraphTemplate;

const newsPodcastGraph = {
  id: "tpl-news-podcast",
  name: "资讯播客工坊",
  description: "话题 → 联网搜索 → 播客口播稿 → AI 配音 → 音频成品（search + TTS）",
  category: "营销内容",
  fields: [
    {
      key: "ttsModel",
      label: "配音模型（TTS）",
      placeholder: "如 tts-1；需供应商支持 /audio/speech 接口",
      defaultValue: "tts-1",
      applyTo: [{ nodeId: "voice", path: "audioGen.model" }],
    },
  ],
  graph: {
    id: "tpl-news-podcast",
    name: "资讯播客工坊",
    nodes: [
      {
        id: "intake",
        kind: "source",
        name: "话题输入",
        x: 80,
        y: 300,
      },
      {
        id: "search",
        kind: "search",
        name: "联网搜索",
        x: 340,
        y: 300,
        // query 留空：自动把上游话题文本作为搜索词（DuckDuckGo，无需 API Key）。
        search: { query: "", provider: "duckduckgo", maxResults: 5 },
      },
      {
        id: "script",
        kind: "textGen",
        name: "播客撰稿",
        x: 620,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是播客主理人。基于上游搜索到的话题资讯，写一段约 2 分钟的单人口播稿：" +
            "开头一句话点题 → 3-5 条资讯要点（每条一句话事实 + 一句话点评）→ 结尾互动引导。" +
            "口语化、有节奏感，适合朗读；只输出稿件本身，不要标题和格式符号。",
          skills: [],
        },
      },
      {
        id: "voice",
        kind: "audioGen",
        name: "AI 配音",
        x: 900,
        y: 300,
        // prompt 留空：直接朗读上游口播稿。默认供应商不支持 TTS 时该节点会
        // 软跳过（稿件文本仍完整产出），配置支持 /audio/speech 的模型即可出音频。
        audioGen: { model: "tts-1", voice: "alloy", format: "mp3" },
      },
      { id: "depot", kind: "sink", name: "播客成品", x: 1180, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "search", kind: "flow" },
      { id: "e2", from: "search", to: "script", kind: "flow" },
      { id: "e3", from: "script", to: "voice", kind: "flow" },
      { id: "e4", from: "voice", to: "depot", kind: "flow" },
    ],
  },
} satisfies GraphTemplate;

const researchLoopGraph = {
  id: "tpl-research-loop",
  name: "多课题深度调研",
  description: "课题清单 → 逐课题联网搜索 + 调研卡片 → 循环聚合（loop 批处理）",
  category: "数据分析",
  graph: {
    id: "tpl-research-loop",
    name: "多课题深度调研",
    nodes: [
      {
        id: "intake",
        kind: "source",
        name: "课题清单",
        x: 80,
        y: 300,
      },
      {
        id: "split",
        kind: "code",
        name: "拆题",
        x: 340,
        y: 300,
        code: {
          language: "javascript",
          code: [
            '// 读取上游粘贴的课题清单（一行一个课题），拆成一个字符串数组。',
            'const raw = String(Object.values(inputs)[0] ?? "").trim();',
            'const topics = raw.split(/\\r?\\n/).map(function (s) { return s.trim(); }).filter(Boolean);',
            'console.log(JSON.stringify(topics));',
          ].join("\n"),
        },
      },
      {
        // 循环体：出题 → 联网搜索 → 写调研卡片。循环节点把每一轮卡片的
        // 输出聚合进 { results: [...] } JSON 产物，即最终调研合集。
        id: "loop",
        kind: "loop",
        name: "逐课题循环",
        x: 600,
        y: 300,
        loop: {
          items: "${split}",
          maxIterations: 20,
        },
      },
      {
        id: "kicker",
        kind: "code",
        name: "出题",
        x: 860,
        y: 300,
        code: {
          language: "javascript",
          code: [
            '// 当前课题（循环项）原样输出，作为下游搜索节点的搜索词。',
            'console.log(String(inputs.item ?? ""));',
          ].join("\n"),
        },
      },
      {
        id: "search",
        kind: "search",
        name: "联网搜索",
        x: 1080,
        y: 300,
        // query 留空：自动用上游「出题」节点的课题文本作为搜索词。
        search: { query: "", provider: "duckduckgo", maxResults: 4 },
      },
      {
        id: "writer",
        kind: "textGen",
        name: "调研卡片",
        x: 1320,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是研究助理。当前课题：${item}。上游提供了该课题的联网搜索结果，" +
            "请写一张调研卡片：**结论**（1-2 句）→ **关键事实**（3-5 条，注明来自搜索结果）→ " +
            "**待确认**（搜索结果没覆盖、需要二次核实的问题）。只输出卡片内容。",
          skills: [],
        },
      },
    ],
    edges: [
      { id: "e1", from: "intake", to: "split", kind: "flow" },
      { id: "e2", from: "split", to: "loop", kind: "flow" },
      { id: "e3", from: "loop", to: "kicker", kind: "flow" },
      { id: "e4", from: "kicker", to: "search", kind: "flow" },
      { id: "e5", from: "search", to: "writer", kind: "flow" },
    ],
  },
} satisfies GraphTemplate;

const releasePrGraph = {
  id: "tpl-release-pr",
  name: "发版 PR 助手",
  description: "变更草稿 → AI 整理 PR 描述 → 人工确认 → 自动创建 PR（vcs 集成）",
  category: "开发集成",
  fields: [
    {
      key: "repoOwner",
      label: "仓库 Owner",
      placeholder: "GitHub 用户名或组织名",
      applyTo: [{ nodeId: "submit", path: "vcs.owner" }],
    },
    {
      key: "repoName",
      label: "仓库名",
      placeholder: "例如 agent-world",
      applyTo: [{ nodeId: "submit", path: "vcs.repo" }],
    },
    {
      key: "headBranch",
      label: "来源分支（head）",
      placeholder: "例如 feature/my-change",
      applyTo: [{ nodeId: "submit", path: "vcs.head" }],
    },
    {
      key: "baseBranch",
      label: "目标分支（base）",
      placeholder: "main",
      defaultValue: "main",
      applyTo: [{ nodeId: "submit", path: "vcs.base" }],
    },
  ],
  graph: {
    id: "tpl-release-pr",
    name: "发版 PR 助手",
    nodes: [
      {
        id: "intake",
        kind: "source",
        name: "变更草稿",
        x: 80,
        y: 300,
      },
      {
        id: "polish",
        kind: "textGen",
        name: "PR 描述整理",
        x: 340,
        y: 300,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "你是发版工程师。把上游的变更草稿整理成规范的 PR 描述（Markdown）：" +
            "## Summary（一段话说清这次改动）→ ## Changes（分点列出）→ ## Test Plan（如何验证）。" +
            "忠实于草稿内容，不要编造未提及的改动。",
          skills: [],
        },
      },
      {
        id: "confirm",
        kind: "human",
        name: "人工确认",
        x: 620,
        y: 300,
        human: {
          prompt: "确认这份 PR 描述：通过则提交到仓库；可直接编辑修改；驳回则本次不发版。",
        },
      },
      {
        // body 留空：自动使用上游人工确认后的 PR 描述文本。
        // 凭证从服务器环境变量 GITHUB_TOKEN 读取，不会存进产线。
        id: "submit",
        kind: "vcs",
        name: "创建 PR",
        x: 900,
        y: 300,
        vcs: {
          provider: "github",
          action: "create_pr",
          head: "feature/my-change",
          base: "main",
        },
      },
      { id: "depot", kind: "sink", name: "提交回执", x: 1180, y: 300 },
    ],
    edges: [
      { id: "e1", from: "intake", to: "polish", kind: "flow" },
      { id: "e2", from: "polish", to: "confirm", kind: "flow" },
      { id: "e3", from: "confirm", to: "submit", kind: "flow" },
      { id: "e4", from: "submit", to: "depot", kind: "flow" },
    ],
  },
} satisfies GraphTemplate;

const scanOcrGraph = {
  id: "tpl-scan-ocr",
  name: "扫描件数字化",
  description: "拉取扫描 PDF → 逐页转图 → OCR 识别 → 文字成品（convert + ocr）",
  category: "办公协同",
  fields: [
    {
      key: "docUrl",
      label: "扫描件链接",
      placeholder: "填入扫描版 PDF（每页一张图）的公开链接",
      defaultValue: "https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf",
      applyTo: [{ nodeId: "fetch", path: "http.url" }],
    },
  ],
  graph: {
    id: "tpl-scan-ocr",
    name: "扫描件数字化",
    nodes: [
      { id: "intake", kind: "source", name: "文件入口", x: 80, y: 300 },
      {
        id: "fetch",
        kind: "http",
        name: "拉取扫描件",
        x: 340,
        y: 300,
        http: {
          method: "GET",
          url: "https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf",
          outputMode: "file",
          retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 5000 },
        },
      },
      {
        id: "pages",
        kind: "convert",
        name: "逐页转图",
        x: 600,
        y: 300,
        // PDF → 图片：扫描版 PDF 每页一张图，转出来正好逐页交给 OCR。
        convert: { to: "image" },
      },
      {
        id: "ocr",
        kind: "ocr",
        name: "文字识别",
        x: 860,
        y: 300,
        ocr: { lang: "chi_sim+eng" },
      },
      { id: "depot", kind: "sink", name: "文字成品", x: 1140, y: 300 },
      {
        // 兜底：纯文字 PDF 没有可提取的页面图片时 convert 会失败，
        // 这里接住并提示改用「文档智能解析入库」模板。
        id: "convFallback",
        kind: "textGen",
        name: "转换兜底",
        x: 600,
        y: 560,
        textGen: {
          model: "agnes-2.0-flash",
          prompt:
            "上游 PDF 不是扫描件（没有可提取的页面图片），无法走「逐页转图 → OCR」流程。" +
            "请输出一段简短说明：该文档有文字层，建议改用「文档智能解析入库」模板直接解析正文，" +
            "或者更换为真正的扫描版 PDF 链接后重试。",
          skills: [],
        },
      },
    ],
    edges: [
      { id: "e1", from: "intake", to: "fetch", kind: "flow" },
      { id: "e2", from: "fetch", to: "pages", kind: "flow" },
      { id: "e3", from: "pages", to: "ocr", kind: "flow" },
      { id: "e4", from: "ocr", to: "depot", kind: "flow" },
      { id: "x1", from: "pages", to: "convFallback", kind: "error" },
      { id: "x2", from: "convFallback", to: "depot", kind: "flow" },
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
  batchContentGraph,
  docIngestGraph,
  reviewPublishGraph,
  customModelGraph,
  newsPodcastGraph,
  researchLoopGraph,
  releasePrGraph,
  scanOcrGraph,
  blankGraph,
];

export function getTemplate(id: string): GraphTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
