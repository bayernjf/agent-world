/**
 * Ops M2 content distribution (OP-20~26): human-gated platform drafts.
 *
 * The service is the ONLY writer of draft lifecycle state. It never calls a
 * real platform API in this milestone: adapters are offline and produce
 * deterministic receipts. A draft becomes `published` exclusively through
 * the human approve() action — create/submitForReview/reject can never reach
 * it.
 */
import { randomUUID } from "node:crypto";
import {
  assertDraftTransition,
  checkCompliance,
  isOfflinePublisherPlatform,
  offlineReceipt,
  platformRequiresQualification,
  type DraftStatus,
} from "@agent-world/core";
import type { Db, PublishedContent } from "../../db.js";

export class PublisherValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublisherValidationError";
  }
}

export class PublisherNotConfiguredError extends Error {
  constructor(platform: string) {
    super(`platform ${platform} is not configured for publishing`);
    this.name = "PublisherNotConfiguredError";
  }
}

export class ComplianceGateError extends Error {
  constructor(
    message: string,
    readonly violations: string[],
  ) {
    super(message);
    this.name = "ComplianceGateError";
  }
}

export interface CreateDraftInput {
  userId: string;
  platform: string;
  title: string;
  body: string;
  tags: string[];
  graphId?: string | null;
  runId?: string | null;
  artifactId?: string | null;
  now?: number;
}

interface DraftDetail {
  title: string;
  body: string;
  tags: string[];
  qa?: { passed: true; checkedAt: number; violations: string[] };
  review?: { decidedAt: number; reviewer: string; reason?: string };
}

export class PublisherService {
  constructor(private readonly db: Db) {}

  /** OP-20/21/22/24: submit content as a draft. Nothing is published here. */
  async createDraft(input: CreateDraftInput): Promise<PublishedContent> {
    const platform = String(input.platform ?? "").trim();
    // OP-23 douyin, and any platform without an offline adapter: fail closed.
    if (platformRequiresQualification(platform) || !isOfflinePublisherPlatform(platform)) {
      throw new PublisherNotConfiguredError(platform);
    }
    const title = input.title?.trim() ?? "";
    const body = input.body?.trim() ?? "";
    if (!title) throw new PublisherValidationError("draft requires a title");
    if (!body) throw new PublisherValidationError("draft requires a body");

    const detail: DraftDetail = { title, body, tags: input.tags ?? [] };
    return this.db.insertPublishedContent({
      id: `pdc_${randomUUID()}`,
      userId: input.userId,
      graphId: input.graphId ?? null,
      runId: input.runId ?? null,
      artifactId: input.artifactId ?? null,
      platform,
      status: "draft",
      publishedAt: null,
      detailJson: JSON.stringify(detail),
    });
  }

  /** OP-26: editor QA gate; only a clean draft may enter human review. */
  async submitForReview(id: string, userId: string, now = Date.now()): Promise<PublishedContent> {
    const draft = await this.requireDraft(id, userId);
    assertDraftTransition(draft.status as DraftStatus, "pending_review");
    const detail = parseDetail(draft.detailJson);

    const result = checkCompliance({
      platform: draft.platform as never,
      text: detail.body,
      title: detail.title,
    });
    if (!result.passed) {
      throw new ComplianceGateError(
        "draft failed editor QA and cannot enter review",
        result.violations.map((v) => `${v.field ?? "body"}: ${v.rule}`),
      );
    }

    detail.qa = { passed: true, checkedAt: now, violations: [] };
    const changes = await this.db.updatePublishedContent(id, userId, {
      status: "pending_review",
      detailJson: JSON.stringify(detail),
    });
    if (changes === 0) throw new PublisherValidationError(`draft ${id} update failed`);
    return this.requireDraft(id, userId);
  }

  /** Reject a draft waiting for human review (terminal). */
  async reject(
    id: string,
    userId: string,
    reviewer: string,
    reason: string,
    now = Date.now(),
  ): Promise<PublishedContent> {
    const draft = await this.requireDraft(id, userId);
    assertDraftTransition(draft.status as DraftStatus, "rejected");
    const detail = parseDetail(draft.detailJson);
    detail.review = { decidedAt: now, reviewer, reason };
    const changes = await this.db.updatePublishedContent(id, userId, {
      status: "rejected",
      detailJson: JSON.stringify(detail),
    });
    if (changes === 0) throw new PublisherValidationError(`draft ${id} update failed`);
    return this.requireDraft(id, userId);
  }

  /**
   * OP-21/22/24/25: the single human gate. Moves pending_review → approved →
   * published in one call using the platform's offline adapter, recording a
   * receipt whose external id carries an explicit `offline-` marker.
   */
  async approve(id: string, userId: string, reviewer: string, now = Date.now()): Promise<PublishedContent> {
    const draft = await this.requireDraft(id, userId);
    assertDraftTransition(draft.status as DraftStatus, "approved");
    if (!draft.platform || !isOfflinePublisherPlatform(draft.platform)) {
      throw new PublisherNotConfiguredError(draft.platform ?? "(none)");
    }

    const receipt = offlineReceipt(draft.platform, draft.id, now);
    const detail = parseDetail(draft.detailJson);
    detail.review = { decidedAt: now, reviewer };

    // approved is only reachable from pending_review; published only from
    // approved, so there is no other code path to publication. The offline
    // adapter is deterministic (no network), making the two guarded updates
    // safe to perform sequentially.
    let changes = await this.db.updatePublishedContent(id, userId, {
      status: "approved",
      detailJson: JSON.stringify(detail),
    });
    if (changes === 0) throw new PublisherValidationError(`draft ${id} update failed`);

    const approved = await this.requireDraft(id, userId);
    assertDraftTransition(approved.status as DraftStatus, "published");
    changes = await this.db.updatePublishedContent(id, userId, {
      status: "published",
      externalId: receipt.externalId,
      externalUrl: receipt.externalUrl,
      publishedAt: receipt.publishedAt,
    });
    if (changes === 0) throw new PublisherValidationError(`draft ${id} publish failed`);
    return this.requireDraft(id, userId);
  }

  list(userId: string): Promise<PublishedContent[]> {
    return this.db.listPublishedContents(userId);
  }

  get(id: string, userId: string): Promise<PublishedContent | null> {
    return this.db.getPublishedContent(id, userId);
  }

  private async requireDraft(id: string, userId: string): Promise<PublishedContent> {
    const draft = await this.db.getPublishedContent(id, userId);
    if (!draft) throw new PublisherValidationError(`draft ${id} not found`);
    return draft;
  }
}

function parseDetail(json: string | null): DraftDetail {
  if (!json) return { title: "", body: "", tags: [] };
  const parsed = JSON.parse(json) as Partial<DraftDetail>;
  return {
    title: String(parsed.title ?? ""),
    body: String(parsed.body ?? ""),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    ...(parsed.qa ? { qa: parsed.qa } : {}),
    ...(parsed.review ? { review: parsed.review } : {}),
  };
}
