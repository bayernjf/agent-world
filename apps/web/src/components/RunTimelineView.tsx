import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type RunTimelineResponse } from "../lib/api";
import { formatNumber } from "../i18n/utils";
import type { TimelineAttempt, TimelineAttemptStatus, TimelineNode } from "@agent-world/core";

/** Map a timeline attempt status onto the existing run-status badge styles. */
const STATUS_CLASS: Record<TimelineAttemptStatus, string> = {
  done: "run-status--done",
  failed: "run-status--failed",
  running: "run-status--running",
  reviewing: "run-status--halted",
  skipped: "run-status--interrupted",
  // G4: degraded (a long async job awaiting a decision) is orange.
  degraded: "run-status--degraded",
};

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** Truncate a long remote job id for inline display (full id is in the title). */
function truncateJob(id: string): string {
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

function AttemptRow({ runId, nodeId, a }: { runId: string; nodeId: string; a: TimelineAttempt }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const toggleFull = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (full != null) {
      setExpanded(true);
      return;
    }
    setLoading(true);
    setLoadError(false);
    api
      .getRunNodeOutput(runId, nodeId, a.attempt)
      .then((r) => {
        setFull(r.output);
        setExpanded(true);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  return (
    <div className={`run-timeline-attempt run-timeline-attempt--${a.status}`}>
      <div className="run-timeline-attempt-head">
        <span className={`run-status ${STATUS_CLASS[a.status]}`}>
          {t(`run:timeline.status.${a.status}`)}
        </span>
        <span className="run-timeline-attempt-no">
          {t("run:timeline.attempt", { n: a.attempt })}
        </span>
        {a.variant !== "main" && (
          <span className="run-timeline-variant">
            {t("run:timeline.variant", { v: a.variant })}
          </span>
        )}
        <span className="run-timeline-spacer" />
        <span className="run-timeline-metric">{fmtMs(a.durationMs)}</span>
        {a.model && <span className="run-timeline-metric">{a.model}</span>}
        {(a.tokensIn > 0 || a.tokensOut > 0) && (
          <span className="run-timeline-metric">
            {formatNumber(a.tokensIn)}↑ {formatNumber(a.tokensOut)}↓
          </span>
        )}
        {a.costUsd > 0 && (
          <span className="run-timeline-metric">${a.costUsd.toFixed(4)}</span>
        )}
        {a.score != null && (
          <span className="run-timeline-metric">
            {t("run:timeline.score", { n: a.score })}
          </span>
        )}
      </div>
      {a.gate && (
        <div
          className={`run-timeline-gate${a.gate.passed ? " run-timeline-gate--pass" : " run-timeline-gate--fail"}`}
        >
          {t("run:timeline.gate")}
          {a.gate.passed ? "✓" : "✕"} {a.gate.reason}
        </div>
      )}
      {a.error && (
        <div className="run-timeline-error">
          <span className="run-timeline-error-code">{a.errorCode ?? "ERROR"}</span>{" "}
          {a.error}
        </div>
      )}
      {a.status === "skipped" && a.skipReason && (
        <div className="run-timeline-skip">
          <span className="run-timeline-skip-label">{t("run:timeline.skipReason")}</span>
          {a.skipReason}
        </div>
      )}
      {a.status === "degraded" && a.degradedReason && (
        <div className="run-timeline-degraded">
          <span className="run-timeline-degraded-label">{t("run:timeline.degradedLabel")}</span>
          {a.degradedReason}
          {a.remoteJob && (
            <span className="run-timeline-job" title={a.remoteJob.jobId}>
              {t("run:timeline.jobId")} {truncateJob(a.remoteJob.jobId)}
              {a.startedAt != null && (
                <span className="run-timeline-job-age">
                  {" · "}
                  {t("run:timeline.inFlight", { n: fmtMs(Date.now() - a.startedAt) })}
                </span>
              )}
            </span>
          )}
        </div>
      )}
      {a.status === "degraded" && a.degradedAccepted && (
        <div className="run-timeline-degraded-accepted">
          {t("run:timeline.degradedAccepted")}
        </div>
      )}
      {a.outputPreview && !expanded && (
        <pre className="run-timeline-output">
          {a.outputPreview}
          {a.outputTruncated ? "…" : ""}
        </pre>
      )}
      {expanded && full != null && (
        <pre className="run-timeline-output run-timeline-output--full">{full}</pre>
      )}
      {a.outputTruncated && (
        <button
          type="button"
          className="run-timeline-output-toggle"
          onClick={toggleFull}
          disabled={loading}
        >
          {loading
            ? t("run:timeline.loadingFull")
            : expanded
              ? t("run:timeline.hideFull")
              : t("run:timeline.showFull")}
        </button>
      )}
      {loadError && (
        <div className="run-timeline-error run-timeline-output-error">
          {t("run:timeline.fullError")}
        </div>
      )}
      {(a.toolCalls > 0 || a.artifacts > 0) && (
        <div className="run-timeline-foot">
          {a.toolCalls > 0 && (
            <span>{t("run:timeline.tools", { n: a.toolCalls })}</span>
          )}
          {a.artifacts > 0 && (
            <span>{t("run:timeline.artifacts", { n: a.artifacts })}</span>
          )}
        </div>
      )}
    </div>
  );
}

type BusyState = "reattach" | "accept" | "resubmit" | null;

/**
 * G4 decision bar for a degraded node. While the remote job is open it offers
 * "continue this node" (reattach) and "accept degraded" (with a confirm); once
 * the provider has lost the job it offers a single "resubmit (bills again)".
 */
function DegradedActions({
  runId,
  nodeId,
  lost,
  onDecided,
}: {
  runId: string;
  nodeId: string;
  lost: boolean;
  onDecided: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<BusyState>(null);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (which: Exclude<BusyState, null>, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(which);
    setError(null);
    try {
      await fn();
      onDecided();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  if (lost) {
    return (
      <div className="run-timeline-degrade-actions">
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy !== null}
          onClick={() =>
            void act("resubmit", () => api.resumeRun(runId, "continue", nodeId))
          }
        >
          {busy === "resubmit" ? t("run:timeline.submitting") : t("run:timeline.resubmit")}
        </button>
        {error && <span className="run-timeline-degrade-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className="run-timeline-degrade-actions">
      <button
        type="button"
        className="btn btn--sm"
        disabled={busy !== null}
        onClick={() => void act("reattach", () => api.resumeRun(runId, "reattach"))}
      >
        {busy === "reattach" ? t("run:timeline.working") : t("run:timeline.reattach")}
      </button>
      {!confirmAccept ? (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy !== null}
          onClick={() => setConfirmAccept(true)}
        >
          {t("run:timeline.acceptDegraded")}
        </button>
      ) : (
        <span className="run-timeline-confirm">
          {t("run:timeline.confirmAccept")}
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy !== null}
            onClick={() =>
              void act("accept", () => api.resumeRun(runId, "accept-degraded"))
            }
          >
            {busy === "accept" ? t("run:timeline.working") : t("run:timeline.confirmYes")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy !== null}
            onClick={() => setConfirmAccept(false)}
          >
            {t("run:timeline.confirmNo")}
          </button>
        </span>
      )}
      {error && <span className="run-timeline-degrade-error">{error}</span>}
    </div>
  );
}

/** True when the latest attempt's remote job was lost by the provider. */
function isNodeLost(node: TimelineNode): boolean {
  const last = node.attempts[node.attempts.length - 1];
  return last?.errorCode === "REMOTE_JOB_LOST";
}

/**
 * Read-only step trace for a single run (competitor painpoint G1). Fetches the
 * timeline projection and renders every node + attempt (retries included), with
 * status, duration, tokens/cost, gate verdict, error and an output preview.
 */
export default function RunTimelineView({
  runId,
  onForked,
  onComparePrompt,
}: {
  runId: string;
  /** G1.2: called with the new run id after a "rerun from here" fork starts. */
  onForked?: (newRunId: string) => void;
  /** G5.1: seed an A/B prompt comparison from this finished run's input. */
  onComparePrompt?: (o: {
    runId: string;
    graphId: string;
    targetNodeId: string;
    targetName?: string;
    input: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<RunTimelineResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [forkingNode, setForkingNode] = useState<string | null>(null);
  const [forkError, setForkError] = useState<string | null>(null);

  const loadTimeline = useCallback(() => {
    setFailed(false);
    api
      .getRunTimeline(runId)
      .then((d) => setData(d))
      .catch(() => setFailed(true));
  }, [runId]);

  const handleFork = async (nodeId: string) => {
    setForkError(null);
    setForkingNode(nodeId);
    try {
      const { runId: newRunId } = await api.forkRun(runId, nodeId);
      onForked?.(newRunId);
    } catch (e) {
      setForkError(t("run:timeline.forkFailed", { message: (e as Error).message }));
      setForkingNode(null);
    }
  };

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    api
      .getRunTimeline(runId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  if (failed) return <div className="run-timeline-error">{t("run:timeline.error")}</div>;
  if (!data) return <div className="note">{t("run:timeline.loading")}</div>;

  const { timeline, nodeMeta } = data;
  if (timeline.nodes.length === 0) {
    return <div className="note">{t("run:timeline.empty")}</div>;
  }

  return (
    <div className="run-timeline">
      <div className="run-timeline-summary">
        <span className={`run-status ${timeline.totals.failed > 0 ? "run-status--failed" : "run-status--done"}`}>
          {t("run:timeline.totals", {
            done: timeline.totals.done,
            failed: timeline.totals.failed,
            total: timeline.totals.nodes,
          })}
        </span>
        <span className="run-timeline-metric">
          {formatNumber(timeline.totals.tokensIn)}↑ {formatNumber(timeline.totals.tokensOut)}↓
        </span>
        <span className="run-timeline-metric">${timeline.totals.costUsd.toFixed(4)}</span>
        {timeline.budget.tripped && (
          <span className="run-timeline-tripped">{t("run:timeline.tripped")}</span>
        )}
      </div>
      {forkError && <div className="run-timeline-forkerror">{forkError}</div>}
      {timeline.nodes.map((node) => {
        const meta = nodeMeta[node.nodeId];
        const last = node.attempts[node.attempts.length - 1];
        return (
          <div key={node.nodeId} className="run-timeline-node">
            <div className="run-timeline-node-head">
              <span className={`run-status ${STATUS_CLASS[node.status]}`}>
                {t(`run:timeline.status.${node.status}`)}
              </span>
              <span className="run-timeline-node-name">
                {meta?.name || node.nodeId.slice(0, 8)}
              </span>
              {meta?.kind && <span className="run-timeline-node-kind">{meta.kind}</span>}
              {node.reused && (
                <span className="run-timeline-reused" title={t("run:timeline.reused")}>
                  {t("run:timeline.reused")}
                </span>
              )}
              {node.attempts.length > 1 && (
                <span className="run-timeline-retry">
                  {t("run:timeline.retries", { n: node.attempts.length - 1 })}
                </span>
              )}
              {node.status === "done" && (
                <button
                  type="button"
                  className="btn btn--sm run-timeline-fork"
                  disabled={forkingNode !== null}
                  onClick={() => void handleFork(node.nodeId)}
                  title={t("run:timeline.forkHere")}
                >
                  {forkingNode === node.nodeId
                    ? t("run:timeline.forking")
                    : t("run:timeline.forkHere")}
                </button>
              )}
              {node.status === "done" &&
                data.run.status === "done" &&
                meta?.kind === "textGen" &&
                onComparePrompt && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm run-timeline-fork"
                    onClick={() =>
                      onComparePrompt({
                        runId: data.run.id,
                        graphId: data.run.graphId,
                        targetNodeId: node.nodeId,
                        targetName: meta?.name ?? undefined,
                        input: data.run.input,
                      })
                    }
                    title={t("run:timeline.comparePromptHint")}
                  >
                    {t("run:timeline.comparePrompt")}
                  </button>
                )}
            </div>
            <div className="run-timeline-attempts">
              {node.attempts.map((a) => (
                <AttemptRow
                  key={`${a.variant}-${a.attempt}`}
                  runId={runId}
                  nodeId={node.nodeId}
                  a={a}
                />
              ))}
            </div>
            {last?.status === "running" && data.run.haltedReason && (
              <div className="run-timeline-halt">{data.run.haltedReason}</div>
            )}
            {node.status === "degraded" && data.run.status === "halted" && (
              <DegradedActions
                runId={runId}
                nodeId={node.nodeId}
                lost={isNodeLost(node)}
                onDecided={() => setTimeout(loadTimeline, 2000)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
