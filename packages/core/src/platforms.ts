import { z } from "zod";

/**
 * 平台适配与合规校验（F3）。
 *
 * 每个平台有一份「发布规范 profile」：标题/正文长度上限、话题标签规则、
 * 主图比例、平台特有违禁词与必含要素。合规检查是纯函数，供 engine 与单测
 * 直接调用；内置词表作为静态常量随包发布，可后续热更新。
 */

export const PlatformId = z.enum(["taobao", "xiaohongshu", "douyin", "wechat", "custom"]);
export type PlatformId = z.infer<typeof PlatformId>;

export const PlatformProfile = z.object({
  id: PlatformId,
  /** 展示名（中文）。 */
  label: z.string(),
  /** 标题长度上限（字符）。 */
  titleMax: z.number().int().positive(),
  /** 正文长度上限（字符）。 */
  bodyMax: z.number().int().positive(),
  /** 话题标签规则：前缀与数量上限。 */
  hashtag: z.object({ prefix: z.string(), max: z.number().int().nonnegative() }),
  /** 主图推荐比例，如 ["3:4", "1:1"]。 */
  imageRatios: z.array(z.string()),
  /** 平台特有违禁词（与《广告法》极限词库分开）。 */
  bannedWords: z.array(z.string()).default([]),
  /** 必含要素（如「需含购买链接」「需含话题标签」）。 */
  required: z.array(z.string()).default([]),
});
export type PlatformProfile = z.infer<typeof PlatformProfile>;

/**
 * 《广告法》极限词与常见违禁词库（国家级公开监管词）。
 * 来源：《中华人民共和国广告法》第九条及市场监管部门公开案例；
 * 更新：2026-09-03。这是静态基线，用户可在节点里补充自己的词表。
 */
export const AD_LAW_BANNED_WORDS: readonly string[] = [
  "国家级",
  "世界级",
  "最高级",
  "最佳",
  "最好",
  "最优",
  "最先进",
  "最优秀",
  "最低价",
  "最便宜",
  "第一",
  "第一品牌",
  "顶级",
  "极品",
  "顶尖",
  "绝对",
  "独家",
  "绝无仅有",
  "前所未有",
  "万能",
  "永久",
  "特效",
  "根治",
  "治愈",
  "无毒",
  "无害",
  "无副作用",
  "100%",
  "百分百",
  "零风险",
  "保证",
  "权威",
  "销量第一",
  "销量冠军",
  "全网最低",
  "史上最低",
  "驰名商标",
  "中国名牌",
];

/** 默认平台 profile 表（可迭代维护的单一事实源）。 */
export const PLATFORM_PROFILES: Readonly<Record<PlatformId, PlatformProfile>> = {
  taobao: {
    id: "taobao",
    label: "淘宝",
    titleMax: 60,
    bodyMax: 2000,
    hashtag: { prefix: "", max: 0 },
    imageRatios: ["1:1", "3:4"],
    bannedWords: ["包邮", "正品保证"],
    required: ["商品主图"],
  },
  xiaohongshu: {
    id: "xiaohongshu",
    label: "小红书",
    titleMax: 20,
    bodyMax: 1000,
    hashtag: { prefix: "#", max: 10 },
    imageRatios: ["3:4", "1:1"],
    bannedWords: ["微信", "加V", "私聊"],
    required: ["话题标签"],
  },
  douyin: {
    id: "douyin",
    label: "抖音",
    titleMax: 55,
    bodyMax: 500,
    hashtag: { prefix: "#", max: 8 },
    imageRatios: ["9:16"],
    bannedWords: ["微信", "引流"],
    required: ["话题标签"],
  },
  wechat: {
    id: "wechat",
    label: "微信公众号",
    titleMax: 64,
    bodyMax: 2000,
    hashtag: { prefix: "#", max: 0 },
    imageRatios: ["16:9", "1:1"],
    bannedWords: [],
    required: [],
  },
  custom: {
    id: "custom",
    label: "自定义",
    titleMax: 100,
    bodyMax: 5000,
    hashtag: { prefix: "#", max: 20 },
    imageRatios: ["1:1", "3:4", "4:3", "16:9", "9:16"],
    bannedWords: [],
    required: [],
  },
};

export type ViolationType = "banned" | "length" | "hashtag" | "ratio";

export interface ComplianceViolation {
  type: ViolationType;
  /** 命中的违规词（banned 类）。 */
  match?: string;
  /** 违规词在原文中的 [start, end) 区间（banned 类，供前端高亮）。 */
  span?: [number, number];
  /** 规则描述（如「广告法极限词」「标题超长」）。 */
  rule: string;
  /** 修复建议（如替换词或处理动作）。 */
  suggest: string;
}

export interface ComplianceResult {
  passed: boolean;
  violations: ComplianceViolation[];
  original: string;
  /** autoFix 时产出的修复版文本；否则等于 original。 */
  sanitized: string;
  /** 针对标题/正文的分项达标情况。 */
  metrics: {
    titleLength: number;
    titleMax: number;
    bodyLength: number;
    bodyMax: number;
    hashtagCount: number;
    hashtagMax: number;
  };
}

/** 一个「违规词 → 建议替换」的静态映射，用于 autoFix 兜底。 */
const BANNED_SUGGEST: Record<string, string> = {
  国家级: "领先",
  世界级: "领先",
  最高级: "高端",
  最佳: "优秀",
  最好: "优秀",
  最优: "优秀",
  最先进: "先进",
  最优秀: "优秀",
  最低价: "实惠",
  最便宜: "实惠",
  第一: "领先",
  第一品牌: "知名品牌",
  顶级: "高端",
  极品: "精品",
  顶尖: "出色",
  绝对: "相对",
  独家: "独家（如需使用请核实资质）",
  绝无仅有: "少见",
  前所未有: "少见",
  万能: "全面",
  永久: "长期",
  特效: "有效",
  根治: "改善",
  治愈: "改善",
  无毒: "安全",
  无害: "安全",
  无副作用: "温和",
  "100%": "接近满分",
  百分百: "接近满分",
  零风险: "低风险",
  保证: "承诺",
  权威: "专业",
  销量第一: "销量领先",
  销量冠军: "销量领先",
  全网最低: "全网优惠",
  史上最低: "历史低价",
  驰名商标: "知名品牌",
  中国名牌: "知名品牌",
};

export interface ComplianceOptions {
  /** 目标平台 id。 */
  platform: PlatformId;
  /** 用户补充的违禁词（逗号/换行分隔）。 */
  extraBanned?: string;
  /** 是否自动产出修复版文本。 */
  autoFix?: boolean;
  /** 输入文本（正文）。 */
  text: string;
  /** 可选：标题文本（长度按 titleMax 校验）。 */
  title?: string;
}

function splitWords(raw: string): string[] {
  return raw
    .split(/[\n,，、;；\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 合并内置《广告法》词库 + 平台特有词 + 用户补充词，去重后返回。 */
function bannedWordList(profile: PlatformProfile, extraBanned: string): string[] {
  const seen = new Set<string>();
  for (const w of [...AD_LAW_BANNED_WORDS, ...profile.bannedWords, ...splitWords(extraBanned)]) {
    if (w) seen.add(w);
  }
  return [...seen];
}

/**
 * 确定性合规校验（F3 核心纯函数）。检查正文与标题的极限词 / 长度 / 话题标签 /
 * 比例，返回违规清单与（可选）修复版文本。
 */
export function checkCompliance(opts: ComplianceOptions): ComplianceResult {
  const profile = PLATFORM_PROFILES[opts.platform] ?? PLATFORM_PROFILES.custom;
  const words = bannedWordList(profile, opts.extraBanned ?? "");
  const text = opts.text;
  const title = opts.title ?? "";
  const violations: ComplianceViolation[] = [];

  // 1) 违禁词（正文 + 标题都查；正文先查，标题命中排在后面）
  for (const word of words) {
    let idx = text.indexOf(word);
    while (idx !== -1) {
      violations.push({
        type: "banned",
        match: word,
        span: [idx, idx + word.length],
        rule: word in BANNED_SUGGEST ? "广告法极限词" : "平台违禁词",
        suggest: BANNED_SUGGEST[word] ?? `删除或替换「${word}」`,
      });
      idx = text.indexOf(word, idx + word.length);
    }
  }
  for (const word of words) {
    const idx = title.indexOf(word);
    if (idx !== -1) {
      violations.push({
        type: "banned",
        match: word,
        span: [idx, idx + word.length],
        rule: word in BANNED_SUGGEST ? "广告法极限词" : "平台违禁词",
        suggest: BANNED_SUGGEST[word] ?? `删除或替换「${word}」`,
      });
    }
  }

  // 2) 长度校验
  if (title.length > profile.titleMax) {
    violations.push({
      type: "length",
      rule: "标题超长",
      suggest: `标题需 ≤ ${profile.titleMax} 字，当前 ${title.length} 字`,
    });
  }
  if (text.length > profile.bodyMax) {
    violations.push({
      type: "length",
      rule: "正文超长",
      suggest: `正文需 ≤ ${profile.bodyMax} 字，当前 ${text.length} 字`,
    });
  }

  // 3) 话题标签
  const hashtagCount = (text.match(/#[^#\s]+/g) ?? []).length;
  if (profile.hashtag.max > 0 && profile.required.includes("话题标签") && hashtagCount === 0) {
    violations.push({
      type: "hashtag",
      rule: "缺少话题标签",
      suggest: `需至少 1 个 ${profile.hashtag.prefix} 话题标签（上限 ${profile.hashtag.max} 个）`,
    });
  } else if (hashtagCount > profile.hashtag.max) {
    violations.push({
      type: "hashtag",
      rule: "话题标签超量",
      suggest: `话题标签上限 ${profile.hashtag.max} 个，当前 ${hashtagCount} 个`,
    });
  }

  // 4) 主图比例：合规节点只看文本，比例无法从文本推断，不产生违规；
  //    保留该类型是为后续接入图片产物元数据时补检。

  const passed = violations.length === 0;

  // autoFix：按命中区间做「最长词优先」的就地替换
  let sanitized = text;
  if (opts.autoFix !== false && !passed) {
    const bannedHits = violations
      .filter((v) => v.type === "banned" && v.span && v.match)
      .sort((a, b) => b.span![1] - b.span![0] - (a.span![1] - a.span![0]));
    for (const v of bannedHits) {
      const [s, e] = v.span!;
      const replacement = BANNED_SUGGEST[v.match!] ?? "（已删除）";
      sanitized = sanitized.slice(0, s) + replacement + sanitized.slice(e);
    }
  }

  return {
    passed,
    violations,
    original: text,
    sanitized,
    metrics: {
      titleLength: title.length,
      titleMax: profile.titleMax,
      bodyLength: text.length,
      bodyMax: profile.bodyMax,
      hashtagCount,
      hashtagMax: profile.hashtag.max,
    },
  };
}

/** 合规检查输出 artifact 的 JSON 形状（engine 与前端共享）。 */
export function complianceArtifact(result: ComplianceResult): {
  passed: boolean;
  violations: ComplianceViolation[];
  original: string;
  sanitized: string;
} {
  return {
    passed: result.passed,
    violations: result.violations,
    original: result.original,
    sanitized: result.sanitized,
  };
}
