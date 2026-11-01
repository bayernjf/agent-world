import { describe, expect, it } from "vitest";
import {
  IllegalDraftTransition,
  assertDraftTransition,
  canTransitionDraft,
  isOfflinePublisherPlatform,
  offlineReceipt,
  platformRequiresQualification,
} from "./publisher.js";

describe("draft lifecycle", () => {
  it("only allows the human-gated edges", () => {
    expect(canTransitionDraft("draft", "pending_review")).toBe(true);
    expect(canTransitionDraft("draft", "published")).toBe(false);
    expect(canTransitionDraft("pending_review", "approved")).toBe(true);
    expect(canTransitionDraft("pending_review", "rejected")).toBe(true);
    expect(canTransitionDraft("approved", "published")).toBe(true);
    expect(canTransitionDraft("published", "rejected")).toBe(false);
    expect(canTransitionDraft("rejected", "published")).toBe(false);
  });

  it("throws on illegal transitions", () => {
    expect(() => assertDraftTransition("draft", "published")).toThrow(IllegalDraftTransition);
  });

  it("never provides an edge that publishes without approval", () => {
    // Strong negative guarantee for OP-26: no state other than approved can
    // reach published, and approved itself is only reachable from review.
    expect(canTransitionDraft("draft", "approved")).toBe(false);
    expect(canTransitionDraft("pending_review", "published")).toBe(false);
  });
});

describe("platform coverage", () => {
  it("supports the four offline platforms and locks douyin", () => {
    for (const p of ["wechat", "xiaohongshu", "bilibili", "zhihu"]) {
      expect(isOfflinePublisherPlatform(p)).toBe(true);
      expect(platformRequiresQualification(p)).toBe(false);
    }
    expect(platformRequiresQualification("douyin")).toBe(true);
    expect(isOfflinePublisherPlatform("douyin")).toBe(false);
  });

  it("builds clearly marked offline receipts", () => {
    const r = offlineReceipt("wechat", "pdc_1", 1700000000000);
    expect(r.externalId).toBe("offline-wechat-pdc_1");
    expect(r.externalUrl).toBeNull();
    expect(r.publishedAt).toBe(1700000000000);
  });
});
