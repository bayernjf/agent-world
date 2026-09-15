/**
 * FactoryReviewCard — RTS stage-C C7 human-review actions inside the park popover.
 *
 * Lazily loads the halted runs awaiting a human decision for one factory and
 * offers approve / reject. Tool halts approve the named tool; human/gate halts
 * continue. After each decision the item is removed locally and the parent is
 * told to refresh the overview so the factory's halted badge/count updates.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type PendingReview, type ReviewDecision } from "../lib/api";

/** Approve decision for one halted run: tool halts carry approveTools, others continue. */
export function approveDecision(r: PendingReview): ReviewDecision {
  if (r.kind === "tool" && r.tool) {
    return { runId: r.runId, action: "approve", approveTools: [r.tool] };
  }
  return { runId: r.runId, action: "continue" };
}

export default function FactoryReviewCard({
  graphId,
  onDecided,
}: {
  graphId: string;
  onDecided?: () => void;
}) {
  const { t } = useTranslation();
  const [reviews, setReviews] = useState<PendingReview[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReviews(null);
    api
      .listPendingReviews({ graphId, limit: 20 })
      .then((d) => {
        if (!cancelled) setReviews(d.reviews);
      })
      .catch(() => {
        if (!cancelled) setReviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [graphId]);

  const decide = async (r: PendingReview, verdict: "approve" | "reject") => {
    setBusy(r.runId);
    try {
      const decision: ReviewDecision =
        verdict === "approve" ? approveDecision(r) : { runId: r.runId, action: "reject" };
      await api.decideReviews([decision]);
      setReviews((cur) => (cur ?? []).filter((x) => x.runId !== r.runId));
      onDecided?.();
    } finally {
      setBusy(null);
    }
  };

  if (reviews === null) {
    return <div className="park-review park-review--loading">{t("park:review.loading")}</div>;
  }
  if (reviews.length === 0) {
    return <div className="park-review park-review--empty">{t("park:review.empty")}</div>;
  }

  return (
    <div className="park-review" data-testid="park-review">
      <div className="park-review__title">{t("park:review.title")}</div>
      {reviews.map((r) => (
        <div key={r.runId} className="park-review__item">
          <div className="park-review__meta">
            <span className="park-review__node">{r.nodeName ?? r.nodeId ?? t("park:review.node")}</span>
            {r.reason && <span className="park-review__reason">{r.reason}</span>}
          </div>
          <div className="park-review__actions">
            <button
              type="button"
              className="park-review__btn park-review__btn--ok"
              disabled={busy === r.runId}
              onClick={() => void decide(r, "approve")}
            >
              {t("park:review.approve")}
            </button>
            <button
              type="button"
              className="park-review__btn park-review__btn--no"
              disabled={busy === r.runId}
              onClick={() => void decide(r, "reject")}
            >
              {t("park:review.reject")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
