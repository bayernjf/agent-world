import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  type PendingReview,
  type ReviewAction,
  type ReviewDecision,
} from "../lib/api";
import { reattachRun } from "../store/run";
import { useToast } from "../store/toast";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Opens the run on the canvas (the caller closes this modal first). */
  onOpenRun?: (runId: string) => void;
  /** Lets the nav badge refresh the moment a decision lands. */
  onChanged?: () => void;
}

/** One page of the queue. The server sorts FIFO, so this is the oldest N. */
const PAGE_LIMIT = 100;
const POLL_MS = 10_000;

const KIND_KEY: Record<PendingReview["kind"], string> = {
  human: "reviews:kind.human",
  tool: "reviews:kind.tool",
  gate: "reviews:kind.gate",
};

/**
 * Language-neutral duration, the same shape RunHistory uses, so a waiting time
 * reads identically in zh and en without a set of plural keys.
 */
function fmtWaiting(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Approving a dangerous-action halt has to name the tool, every other kind does not. */
function approveOf(review: PendingReview): ReviewDecision {
  return review.kind === "tool" && review.tool
    ? { runId: review.runId, action: "approve", approveTools: [review.tool] }
    : { runId: review.runId, action: "approve" };
}

export default function ReviewQueue({ open, onClose, onOpenRun, onChanged }: Props) {
  const { t } = useTranslation();
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  /** Row the A/R/E shortcuts act on when nothing is checked. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.listPendingReviews({ limit: PAGE_LIMIT });
      setReviews(d.reviews);
      setTotal(d.total);
      setError("");
    } catch (e) {
      setError(t("reviews:loadFailed", { message: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Reset the transient selection whenever the queue is reopened.
  useEffect(() => {
    if (!open) return;
    setBatchMode(false);
    setSelected([]);
    setActiveId(null);
    setEditingId(null);
    setBusy([]);
    panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  // Poll while open so a run that halts elsewhere shows up, but never refresh
  // rows out from under an open editor.
  useEffect(() => {
    if (!open || editingId) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [open, editingId, load]);

  const active = reviews.find((r) => r.runId === activeId) ?? reviews[0];
  /** Checked rows win over the active row, so the shortcuts follow what is visible. */
  const targets =
    selected.length > 0 ? reviews.filter((r) => selected.includes(r.runId)) : active ? [active] : [];

  const decide = useCallback(
    async (decisions: ReviewDecision[]) => {
      if (decisions.length === 0) return;
      const ids = decisions.map((d) => d.runId);
      setBusy((b) => [...new Set([...b, ...ids])]);
      setEditingId(null);
      try {
        const { results } = await api.decideReviews(decisions);
        const failed = results.filter((r) => !r.ok);
        // The engine resumed without the run store asking for it; re-attach the
        // canvas if it happens to be showing one of these runs.
        for (const r of results) if (r.ok) reattachRun(r.runId);
        const okCount = results.length - failed.length;
        if (okCount > 0) {
          useToast.getState().show(t("reviews:result.submitted", { n: okCount }));
        }
        if (failed.length > 0) {
          useToast
            .getState()
            .show(
              t("reviews:result.partial", {
                n: failed.length,
                message: failed.map((f) => f.error).join("；"),
              }),
              { ttlMs: 6000 },
            );
        }
        setSelected([]);
        await load();
        onChanged?.();
      } catch (e) {
        setError(t("reviews:decideFailed", { message: (e as Error).message }));
      } finally {
        setBusy((b) => b.filter((id) => !ids.includes(id)));
      }
    },
    [load, onChanged, t],
  );

  /** `rows` defaults to what the shortcuts target; per-row buttons pass their own
   *  row because the selection state they clear has not been applied yet. */
  const act = (action: ReviewAction, rows: PendingReview[] = targets) => {
    if (rows.length === 0) return;
    if (action === "reject" || action === "scrap") {
      const key = action === "reject" ? "reviews:confirm.reject" : "reviews:confirm.scrap";
      if (!window.confirm(t(key, { n: rows.length }))) return;
    }
    void decide(rows.map((r) => ({ runId: r.runId, action })));
  };

  const approveSelected = () => void decide(targets.map(approveOf));

  const startEdit = (review: PendingReview) => {
    setEditingId(review.runId);
    setEditText(review.content ?? "");
  };

  const saveEdit = (review: PendingReview) => {
    // The engine addresses an edit by node id, so a run whose halt predates
    // node recording cannot be edited at all.
    if (!review.nodeId) return;
    void decide([
      {
        runId: review.runId,
        action: "edit",
        editOutput: { [review.nodeId]: editText },
      },
    ]);
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /**
   * The canvas and the Inspector bind single keys on window. An open queue owns
   * the keyboard, so stop the native event before it bubbles out of the React
   * root — otherwise "e" would both open the editor here and cycle Inspector tabs.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const modified = e.metaKey || e.ctrlKey || e.altKey;
    if (!modified) e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (modified) return;
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
    const key = e.key.toLowerCase();
    if (key === "arrowdown" || key === "arrowup") {
      if (reviews.length === 0) return;
      e.preventDefault();
      const i = reviews.findIndex((r) => r.runId === active?.runId);
      const next = key === "arrowdown" ? Math.min(reviews.length - 1, i + 1) : Math.max(0, i - 1);
      setActiveId(reviews[next]!.runId);
      return;
    }
    if (key !== "a" && key !== "r" && key !== "e") return;
    e.preventDefault();
    // Buttons disable themselves while a decision is in flight; the shortcuts
    // have to skip those rows too, or a second press double-submits a 409.
    const rows = targets.filter((r) => !busy.includes(r.runId));
    if (rows.length === 0) return;
    if (key === "a") void decide(rows.map(approveOf));
    else if (key === "r") act("reject", rows);
    else if (rows.length === 1 && rows[0]!.nodeId) startEdit(rows[0]!);
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal--wide modal--tall"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-label={t("reviews:title")}
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="modal__header">
          <h2>{t("reviews:title")}</h2>
          <div className="reviewqueue__head-actions">
            <button className="btn" onClick={() => setBatchMode((v) => !v)}>
              {batchMode ? t("reviews:batch.exit") : t("reviews:batch.enter")}
            </button>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              {t("reviews:refresh")}
            </button>
            <Tooltip content={t("reviews:close")}>
              <button className="icon-btn" onClick={onClose} aria-label={t("reviews:close")}>
                ✕
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="reviewqueue__bar">
          <span className="reviewqueue__subtitle">{t("reviews:subtitle")}</span>
          <span className="reviewqueue__count">{t("reviews:total", { n: total })}</span>
        </div>

        <div className="modal__body reviewqueue__body">
          {error && <div className="reviewqueue__error">{error}</div>}
          {loading && reviews.length === 0 && (
            <div className="note">{t("reviews:loading")}</div>
          )}
          {!loading && reviews.length === 0 && (
            <div className="note">{t("reviews:empty")}</div>
          )}

          <div className="reviewqueue__list">
            {reviews.map((r) => {
              const isBusy = busy.includes(r.runId);
              const isActive = active?.runId === r.runId;
              return (
                <div
                  key={r.runId}
                  className={[
                    "reviewqueue__row",
                    `reviewqueue__row--${r.kind}`,
                    isActive ? "is-active" : "",
                    isBusy ? "is-busy" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setActiveId(r.runId)}
                >
                  <div className="reviewqueue__row-head">
                    {batchMode && (
                      <input
                        type="checkbox"
                        checked={selected.includes(r.runId)}
                        aria-label={t("reviews:row.select")}
                        onChange={() => toggleSelect(r.runId)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <span className={`run-status reviewqueue__kind reviewqueue__kind--${r.kind}`}>
                      {t(KIND_KEY[r.kind])}
                    </span>
                    <span className="reviewqueue__graph">{r.graphName}</span>
                    <span className="reviewqueue__node">
                      {r.nodeName ?? t("reviews:row.unknownNode")}
                    </span>
                    <span className="reviewqueue__meta">
                      {t("reviews:row.waiting", { time: fmtWaiting(r.waitingMs) })}
                    </span>
                    <span className="reviewqueue__meta">
                      {t("reviews:row.trigger", { trigger: r.trigger })}
                    </span>
                    {r.abArm && (
                      <span className="reviewqueue__meta">
                        {t("reviews:row.abArm", { arm: r.abArm })}
                      </span>
                    )}
                    <span className="reviewqueue__id">{r.runId.slice(0, 8)}</span>
                  </div>

                  {(r.reason || r.detail || r.tool) && (
                    <div className="reviewqueue__why">
                      {r.reason && (
                        <span>
                          <em>{t("reviews:content.reason")}</em>
                          {r.reason}
                        </span>
                      )}
                      {r.detail && (
                        <span>
                          <em>{t("reviews:content.verdict")}</em>
                          {r.detail}
                        </span>
                      )}
                      {r.tool && (
                        <span>
                          <em>{t("reviews:content.tool")}</em>
                          <code>{r.tool}</code>
                        </span>
                      )}
                    </div>
                  )}

                  <div className="reviewqueue__content-label">{t("reviews:content.label")}</div>
                  {r.content ? (
                    <pre className="reviewqueue__content">{r.content}</pre>
                  ) : (
                    <div className="note">{t("reviews:content.empty")}</div>
                  )}
                  {r.contentTruncated && (
                    <div className="note">{t("reviews:content.truncated", { n: r.content?.length ?? 0 })}</div>
                  )}

                  {editingId === r.runId ? (
                    <div className="reviewqueue__edit">
                      <textarea
                        autoFocus
                        rows={6}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                      />
                      <div className="note">{t("reviews:action.editHint")}</div>
                      <div className="btn-row">
                        <button className="btn btn--primary" onClick={() => saveEdit(r)}>
                          {t("reviews:action.editSave")}
                        </button>
                        <button className="btn btn--ghost" onClick={() => setEditingId(null)}>
                          {t("reviews:action.editCancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="reviewqueue__actions">
                      <button
                        className="btn btn--primary"
                        disabled={isBusy}
                        onClick={() => void decide([approveOf(r)])}
                      >
                        {t("reviews:action.approve")}
                      </button>
                      <button
                        className="btn btn--warn"
                        disabled={isBusy}
                        onClick={() => act("reject", [r])}
                      >
                        {t("reviews:action.reject")}
                      </button>
                      {r.kind !== "tool" && (
                        <button
                          className="btn"
                          disabled={isBusy || !r.nodeId}
                          title={r.nodeId ? undefined : t("reviews:action.editUnavailable")}
                          onClick={() => startEdit(r)}
                        >
                          {t("reviews:action.edit")}
                        </button>
                      )}
                      <button
                        className="btn btn--ghost"
                        disabled={isBusy}
                        onClick={() => act("scrap", [r])}
                      >
                        {t("reviews:action.scrap")}
                      </button>
                      {isBusy && <span className="note">{t("reviews:action.deciding")}</span>}
                      <button
                        className="btn btn--ghost reviewqueue__open"
                        onClick={() => onOpenRun?.(r.runId)}
                      >
                        {t("reviews:row.openRun")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {total > reviews.length && (
            <div className="note">
              {t("reviews:showing", { shown: reviews.length, n: total })}
            </div>
          )}
        </div>

        <div className="reviewqueue__footer">
          {batchMode ? (
            <div className="btn-row">
              <button
                className="btn btn--primary"
                disabled={selected.length === 0 || busy.length > 0}
                onClick={approveSelected}
              >
                {t("reviews:batch.approveSelected", { n: selected.length })}
              </button>
              <span className="note">{t("reviews:batch.selected", { n: selected.length })}</span>
            </div>
          ) : (
            <span className="reviewqueue__hint">
              <kbd>{t("reviews:shortcuts.approveKeys")}</kbd>
              {t("reviews:action.approve")}
              <kbd>{t("reviews:shortcuts.rejectKeys")}</kbd>
              {t("reviews:action.reject")}
              <kbd>{t("reviews:shortcuts.editKeys")}</kbd>
              {t("reviews:action.edit")}
              <kbd>{t("reviews:shortcuts.closeKeys")}</kbd>
              {t("reviews:close")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
