import { z } from "zod";
import { PLATFORM_PROFILES, PlatformId } from "./platforms.js";

/**
 * 发布集成（F7 阶段 A）：平台化导出包。
 *
 * 与 F3 合规校验联动——publish 是「整理」而非「校验」：读上游成稿文本，按
 * 目标平台的 profile 拆分标题/正文、提取话题标签、给出主图比例清单，产出
 * 一份可直接人工复制到各平台的「待发布包」。不承诺自动发布到主流 C 端平台。
 */

export const PublishConfig = z.object({
  /** 目标平台。 */
  platform: PlatformId.default("xiaohongshu"),
  /** 可选标题；缺省取上游文本第一行。 */
  title: z.string().optional(),
});
export type PublishConfig = z.infer<typeof PublishConfig>;

export interface PublishPackage {
  platform: PlatformId;
  platformLabel: string;
  /** 截断到 titleMax 的标题。 */
  title: string;
  /** 截断到 bodyMax 的正文。 */
  body: string;
  /** 从正文提取的话题标签（前缀 + 数量按 profile）。 */
  hashtags: string[];
  /** 平台主图推荐比例。 */
  imageRatios: string[];
  readyToPublish: boolean;
  /** 整理过程的提示（如超长截断）。 */
  warnings: string[];
}

/**
 * 把上游成稿文本整理成目标平台的待发布包（F7-A 核心纯函数）。
 * 确定性规则：拆分标题/正文、提取话题标签、按 profile 截断，不调 LLM。
 */
export function buildPublishPackage(text: string, config: PublishConfig): PublishPackage {
  const profile = PLATFORM_PROFILES[config.platform] ?? PLATFORM_PROFILES.custom;
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const warnings: string[] = [];
  const rawTitle = config.title?.trim() || lines[0] || "";
  let title = rawTitle.slice(0, profile.titleMax);
  if (rawTitle.length > profile.titleMax) warnings.push(`标题已截断到 ${profile.titleMax} 字`);

  const rawBody = config.title?.trim() ? text : lines.slice(1).join("\n");
  let body = rawBody.slice(0, profile.bodyMax);
  if (rawBody.length > profile.bodyMax) warnings.push(`正文已截断到 ${profile.bodyMax} 字`);

  const hashtags = [...text.matchAll(/#[^#\s]+/g)]
    .map((m) => m[0])
    .slice(0, Math.max(profile.hashtag.max, 0));

  return {
    platform: config.platform,
    platformLabel: profile.label,
    title,
    body,
    hashtags,
    imageRatios: profile.imageRatios,
    readyToPublish: true,
    warnings,
  };
}

/** publish 输出 artifact 的 JSON 形状（engine 与前端共享）。 */
export function publishArtifact(pkg: PublishPackage): PublishPackage {
  return pkg;
}
