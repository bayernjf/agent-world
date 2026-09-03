import { describe, expect, it } from "vitest";
import {
  AD_LAW_BANNED_WORDS,
  PLATFORM_PROFILES,
  checkCompliance,
  complianceArtifact,
} from "./platforms.js";

describe("platforms", () => {
  it("内置平台 profile 表完整覆盖五个平台", () => {
    expect(Object.keys(PLATFORM_PROFILES).sort()).toEqual([
      "custom",
      "douyin",
      "taobao",
      "wechat",
      "xiaohongshu",
    ]);
  });

  it("广告法极限词库非空且含代表性词", () => {
    expect(AD_LAW_BANNED_WORDS.length).toBeGreaterThan(0);
    expect(AD_LAW_BANNED_WORDS).toContain("国家级");
    expect(AD_LAW_BANNED_WORDS).toContain("最佳");
  });

  it("干净文本通过，无违规且原样透传", () => {
    const r = checkCompliance({
      platform: "xiaohongshu",
      text: "这件复古帆布托特包，做工细致，日常通勤很实用。 #穿搭",
      title: "复古托特包",
    });
    expect(r.passed).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.sanitized).toBe(r.original);
  });

  it("命中广告法极限词时标出区间并给替换建议", () => {
    const r = checkCompliance({
      platform: "xiaohongshu",
      text: "这是全网最好的托特包。 #穿搭",
      title: "最好托特包",
    });
    expect(r.passed).toBe(false);
    const banned = r.violations.filter((v) => v.type === "banned");
    expect(banned.length).toBeGreaterThan(0);
    const hit = banned.find((v) => v.match === "最好");
    expect(hit).toBeDefined();
    expect(hit!.span).toEqual([4, 6]);
    expect(hit!.rule).toBe("广告法极限词");
    expect(hit!.suggest).toBeTruthy();
  });

  it("autoFix 用替换词就地洗稿", () => {
    const r = checkCompliance({
      platform: "xiaohongshu",
      text: "这是全网最好的托特包。 #穿搭",
      title: "托特包",
      autoFix: true,
    });
    expect(r.passed).toBe(false);
    expect(r.sanitized).not.toContain("最好");
    expect(r.sanitized).toContain("优秀");
  });

  it("标题超长产生 length 违规", () => {
    const longTitle = "好".repeat(30);
    const r = checkCompliance({
      platform: "xiaohongshu",
      text: "正文 #穿搭",
      title: longTitle,
    });
    const lengthViolations = r.violations.filter((v) => v.type === "length");
    expect(lengthViolations.length).toBeGreaterThan(0);
    expect(r.metrics.titleLength).toBe(30);
    expect(r.metrics.titleMax).toBe(20);
  });

  it("小红书缺话题标签产生 hashtag 违规", () => {
    const r = checkCompliance({
      platform: "xiaohongshu",
      text: "这件托特包很实用。",
      title: "托特包",
    });
    const hashtag = r.violations.filter((v) => v.type === "hashtag");
    expect(hashtag.length).toBe(1);
  });

  it("用户补充违禁词生效", () => {
    const r = checkCompliance({
      platform: "wechat",
      text: "本品联名款限量发售。",
      title: "联名款",
      extraBanned: "联名款",
    });
    const banned = r.violations.filter((v) => v.type === "banned" && v.match === "联名款");
    expect(banned.length).toBeGreaterThan(0);
  });

  it("complianceArtifact 输出契约形状", () => {
    const r = checkCompliance({
      platform: "taobao",
      text: "全网最低价。",
      title: "好物",
    });
    const a = complianceArtifact(r);
    expect(a).toHaveProperty("passed");
    expect(a).toHaveProperty("violations");
    expect(a).toHaveProperty("original");
    expect(a).toHaveProperty("sanitized");
    expect(a.original).toBe(r.original);
  });
});
