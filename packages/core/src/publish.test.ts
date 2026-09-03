import { describe, expect, it } from "vitest";
import { buildPublishPackage } from "./publish.js";

describe("buildPublishPackage (F7-A)", () => {
  it("splits the first line into the title and the rest into the body", () => {
    const pkg = buildPublishPackage("夏日通勤穿搭\n这件托特包百搭又耐看。", { platform: "xiaohongshu" });
    expect(pkg.title).toBe("夏日通勤穿搭");
    expect(pkg.body).toBe("这件托特包百搭又耐看。");
    expect(pkg.platform).toBe("xiaohongshu");
    expect(pkg.platformLabel).toBe("小红书");
  });

  it("extracts hashtags and reports the platform image ratios", () => {
    const pkg = buildPublishPackage("标题\n正文 #穿搭 #通勤 #百搭", { platform: "xiaohongshu" });
    expect(pkg.hashtags).toEqual(["#穿搭", "#通勤", "#百搭"]);
    expect(pkg.imageRatios).toEqual(["3:4", "1:1"]);
    expect(pkg.readyToPublish).toBe(true);
  });

  it("truncates the title to the platform titleMax and warns", () => {
    const long = "这是一段特别长的标题".repeat(10); // 100 chars, xiaohongshu titleMax = 20
    const pkg = buildPublishPackage(long, { platform: "xiaohongshu" });
    expect(pkg.title.length).toBe(20);
    expect(pkg.warnings.some((w) => w.includes("标题已截断"))).toBe(true);
  });

  it("honours an explicit title and keeps the full text as the body", () => {
    const pkg = buildPublishPackage("手动标题\n这是正文第一行\n这是正文第二行", {
      platform: "wechat",
      title: "自定义标题",
    });
    expect(pkg.title).toBe("自定义标题");
    expect(pkg.body).toContain("手动标题");
    expect(pkg.body).toContain("这是正文第一行");
  });

  it("uses the custom profile for the custom platform", () => {
    const pkg = buildPublishPackage("标题\n正文", { platform: "custom" });
    expect(pkg.platform).toBe("custom");
    expect(pkg.platformLabel).toBe("自定义");
    expect(pkg.imageRatios).toContain("16:9");
  });
});
