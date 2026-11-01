import { z } from "zod";
import { PlatformId } from "./platforms.js";

/**
 * Human-gated content distribution (ops M2 / OP-20~26).
 *
 * A platform draft can only reach `published` through an explicit human
 * approval action. There is deliberately no "auto publish" transition: the
 * engine submits drafts, editor QA gates the move to pending_review, and a
 * human approve is the single gate into published. Rejected is terminal.
 */

export const PublisherPlatform = PlatformId;
export type PublisherPlatform = z.infer<typeof PublisherPlatform>;

/**
 * Platforms supported by the offline draft adapters (OP-21/22/24).
 * Douyin is intentionally absent: it requires platform API qualification
 * (OP-23) and fails closed until credentials are provisioned.
 */
export const OFFLINE_PUBLISHER_PLATFORMS = [
  "wechat",
  "xiaohongshu",
  "bilibili",
  "zhihu",
] as const satisfies readonly PublisherPlatform[];

/** Platforms that must refuse every publish attempt until qualified (OP-23). */
export const QUALIFICATION_LOCKED_PLATFORMS = ["douyin"] as const;

export const DraftStatus = z.enum(["draft", "pending_review", "approved", "published", "rejected"]);
export type DraftStatus = z.infer<typeof DraftStatus>;

/**
 * Allowed lifecycle edges. `approved` is a transient state the service passes
 * through while performing the (offline) publish; no public transition enters
 * it directly. It exists so a future async platform adapter can park an
 * approved-but-not-yet-live draft without inventing a second state machine.
 */
export const DRAFT_TRANSITIONS = {
  draft: ["pending_review"],
  pending_review: ["approved", "rejected"],
  approved: ["published"],
  published: [],
  rejected: [],
} as const satisfies Record<DraftStatus, readonly DraftStatus[]>;

export class IllegalDraftTransition extends Error {
  constructor(from: DraftStatus, to: DraftStatus) {
    super(`illegal draft transition ${from} -> ${to}`);
    this.name = "IllegalDraftTransition";
  }
}

export class PlatformNotQualifiedError extends Error {
  constructor(platform: string) {
    super(`platform ${platform} requires API qualification before any publish`);
    this.name = "PlatformNotQualifiedError";
  }
}

export function canTransitionDraft(from: DraftStatus, to: DraftStatus): boolean {
  return (DRAFT_TRANSITIONS[from] as readonly DraftStatus[]).includes(to);
}

export function assertDraftTransition(from: DraftStatus, to: DraftStatus): void {
  if (!canTransitionDraft(from, to)) throw new IllegalDraftTransition(from, to);
}

export function isOfflinePublisherPlatform(
  platform: string,
): platform is (typeof OFFLINE_PUBLISHER_PLATFORMS)[number] {
  return (OFFLINE_PUBLISHER_PLATFORMS as readonly string[]).includes(platform);
}

export function platformRequiresQualification(platform: string): boolean {
  return (QUALIFICATION_LOCKED_PLATFORMS as readonly string[]).includes(platform);
}

/** Publisher receipt persisted once a draft is published (OP-25). */
export interface PublisherReceipt {
  externalId: string;
  externalUrl: string | null;
  publishedAt: number;
}

/**
 * Build an offline receipt. Deterministic and non-network: it records an
 * explicit `offline-` marker so analytics can never mistake it for a live
 * platform post id.
 */
export function offlineReceipt(platform: string, draftId: string, now: number): PublisherReceipt {
  return {
    externalId: `offline-${platform}-${draftId}`,
    externalUrl: null,
    publishedAt: now,
  };
}
