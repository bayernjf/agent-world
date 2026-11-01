import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../../db.js";
import {
  ComplianceGateError,
  PublisherNotConfiguredError,
  PublisherService,
  PublisherValidationError,
} from "./service.js";

const FIXED_NOW = 1_700_000_000_000;

describe("publisher service (ops M2 human-gated drafts)", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let service: PublisherService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-publisher-"));
    db = openDb(join(dir, "test.sqlite"));
    service = new PublisherService(db);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const cleanDraft = (overrides: { platform?: string; title?: string; body?: string } = {}) =>
    service.createDraft({
      userId: "u1",
      platform: overrides.platform ?? "wechat",
      title: overrides.title ?? "产品更新说明",
      body: overrides.body ?? "这是一篇干净的正文，没有违禁词。",
      tags: [],
      now: FIXED_NOW,
    });

  it("creates a draft and refuses unknown or qualification-locked platforms (OP-20/23)", async () => {
    const draft = await cleanDraft();
    expect(draft.status).toBe("draft");
    expect(draft.platform).toBe("wechat");

    await expect(cleanDraft({ platform: "douyin" })).rejects.toBeInstanceOf(PublisherNotConfiguredError);
    await expect(cleanDraft({ platform: "taobao" })).rejects.toBeInstanceOf(PublisherNotConfiguredError);
  });

  it("validates title and body", async () => {
    await expect(
      service.createDraft({ userId: "u1", platform: "wechat", title: "", body: "x", tags: [] }),
    ).rejects.toBeInstanceOf(PublisherValidationError);
  });

  it("blocks editor QA on banned words (OP-26)", async () => {
    const draft = await cleanDraft({ body: "全网最好的产品，保证有效。" });
    await expect(service.submitForReview(draft.id, "u1", FIXED_NOW)).rejects.toBeInstanceOf(
      ComplianceGateError,
    );
    // stays a draft — never entered review
    expect((await service.get(draft.id, "u1"))?.status).toBe("draft");
  });

  it("runs the full chain only through human approve (OP-21/25/26)", async () => {
    const draft = await cleanDraft();
    const inReview = await service.submitForReview(draft.id, "u1", FIXED_NOW);
    expect(inReview.status).toBe("pending_review");

    // No approve yet: still not published, and no shortcut transition exists.
    expect((await service.get(draft.id, "u1"))?.status).toBe("pending_review");

    const published = await service.approve(draft.id, "u1", "owner", FIXED_NOW + 1000);
    expect(published.status).toBe("published");
    expect(published.externalId).toBe(`offline-wechat-${draft.id}`);
    expect(published.publishedAt).toBe(FIXED_NOW + 1000);
  });

  it("can never publish without the human gate", async () => {
    const draft = await cleanDraft();
    // Illegal lifecycle jumps are refused at every pre-approval state.
    await expect(service.approve(draft.id, "u1", "owner")).rejects.toThrow(/illegal/);
    const reviewed = await service.submitForReview(draft.id, "u1");
    expect(reviewed.status).toBe("pending_review");
  });

  it("rejects a reviewed draft terminally", async () => {
    const draft = await cleanDraft();
    await service.submitForReview(draft.id, "u1");
    const rejected = await service.reject(draft.id, "u1", "owner", "需要重写");
    expect(rejected.status).toBe("rejected");
    await expect(service.approve(draft.id, "u1", "owner")).rejects.toThrow(/illegal/);
  });

  it("scopes drafts to their owner", async () => {
    const draft = await cleanDraft();
    expect(await service.get(draft.id, "someone-else")).toBeNull();
    await expect(service.submitForReview(draft.id, "someone-else")).rejects.toThrow(/not found/);
  });

  it("supports xiaohongshu, bilibili and zhihu adapters", async () => {
    for (const platform of ["xiaohongshu", "bilibili", "zhihu"]) {
      const d = await service.createDraft({
        userId: "u1",
        platform,
        title: "日常分享",
        body: platform === "xiaohongshu" ? "今天天气不错 #生活" : "一篇普通文章，内容干净。",
        tags: [],
      });
      await service.submitForReview(d.id, "u1");
      const out = await service.approve(d.id, "u1", "owner");
      expect(out.status).toBe("published");
      expect(out.externalId).toBe(`offline-${platform}-${d.id}`);
    }
  });
});
