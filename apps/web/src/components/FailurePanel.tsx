import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { incoming, outgoing, type Graph } from "@agent-world/core";
import { useGraph } from "../store/graph";
import { useVisibleRuntime, resumeRun, useRun } from "../store/run";
import type { FailureRecord } from "@agent-world/core";

// Engine-side error codes, so they map to pack keys instead of copy.
const ERROR_LABEL: Record<string, string> = {
  TIMEOUT: "run:failure.codes.timeout",
  RATE_LIMIT: "run:failure.codes.rateLimit",
  PROVIDER_ERROR: "run:failure.codes.providerError",
  AUTH: "run:failure.codes.auth",
  VALIDATION: "run:failure.codes.validation",
  BUDGET: "run:failure.codes.budget",
  UNSUPPORTED: "run:failure.codes.unsupported",
  SCRIPT_ERROR: "run:failure.codes.scriptError",
  UNKNOWN: "run:failure.codes.unknown",
};

/** `fallback` comes from the caller: this helper has no t() of its own. */
function nodeName(graph: Graph, id: string | undefined, fallback: string): string {
  if (!id) return fallback;
  return graph.nodes.find((n) => n.id === id)?.name ?? id;
}

function downstreamIds(graph: Graph, start: string): Set<string> {
  const out = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of outgoing(graph, id, "flow")) {
      if (!out.has(e.to)) {
        out.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return out;
}

function upstreamDone(
  graph: Graph,
  failedNode: string,
  done: Set<string>,
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const queue = incoming(graph, failedNode, "flow").map((e) => e.from);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (done.has(id)) found.push(id);
    queue.push(...incoming(graph, id, "flow").map((e) => e.from));
  }
  return found;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface Props {
  onRerun: () => void;
}

export default function FailurePanel({ onRerun }: Props) {
  const { t } = useTranslation();
  const { graph } = useGraph();
  const runtime = useVisibleRuntime();
  const reset = useRun((s) => s.reset);
  const [busy, setBusy] = useState(false);
  const [reworkFor, setReworkFor] = useState<number | null>(null);

  const visible = runtime.status === "failed" || runtime.status === "tripped";

  const failedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of runtime.failures) if (f.nodeId) ids.add(f.nodeId);
    return [...ids];
  }, [runtime.failures]);

  const doneNodes = useMemo(
    () =>
      new Set(
        Object.entries(runtime.nodes)
          .filter(([, n]) => n.status === "done")
          .map(([id]) => id),
      ),
    [runtime.nodes],
  );

  if (!visible) return null;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const retryNode = (f: FailureRecord) => {
    if (!f.nodeId) return;
    return act(() => resumeRun("continue", f.nodeId));
  };

  const reworkTo = (upstreamId: string) =>
    act(() => resumeRun("continue", upstreamId));

  return (
    <div className="failure-panel">
      <div className="failure-panel__head">
        <span className="failure-panel__icon">⚠</span>
        <div>
          <div className="failure-panel__title">
            {runtime.status === "tripped"
              ? t("run:failure.trippedTitle")
              : t("run:failure.failedTitle")}
          </div>
          <div className="failure-panel__sub">
            {t("run:failure.summary", { total: runtime.failures.length })}
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={() => reset()}

          disabled={busy}
        >
          ✕
        </button>
      </div>

      <div className="failure-panel__list">
        {runtime.failures.map((f, i) => {
          const stranded = f.nodeId
            ? [...downstreamIds(graph, f.nodeId)].filter(
                (id) => !doneNodes.has(id) && id !== f.nodeId,
              ).length
            : 0;
          const upstream = f.nodeId
            ? upstreamDone(graph, f.nodeId, doneNodes)
            : [];
          const codeKey = f.errorCode ? ERROR_LABEL[f.errorCode] : undefined;
          const whole = t("run:failure.wholePipeline");
          return (
            <div className="failure-card" key={`${f.seq}-${i}`}>
              <div className="failure-card__top">
                <span className="failure-card__node">
                  {nodeName(graph, f.nodeId, whole)}
                </span>
                {f.errorCode && (
                  <span
                    className={`failure-code failure-code--${f.errorCode.toLowerCase()}`}
                  >
                    {codeKey ? t(codeKey) : f.errorCode}
                  </span>
                )}
                {f.attempt !== undefined && f.attempt > 0 && (
                  <span className="failure-card__attempt">
                    {t("run:failure.attempt", { attempt: f.attempt })}
                  </span>
                )}
                <span className="failure-card__time">{formatTime(f.ts)}</span>
              </div>
              <p className="failure-card__msg">{f.error}</p>
              {stranded > 0 && (
                <p className="failure-card__impact">
                  {t("run:failure.impact", { stranded })}
                </p>
              )}
              <div className="failure-card__actions">
                {f.nodeId && (
                  <button
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() => retryNode(f)}
                  >
                    {t("run:failure.retryNode")}
                  </button>
                )}
                {f.nodeId && upstream.length > 0 && (
                  <div className="rework-wrap">
                    <button
                      className="btn btn--ghost btn--small"
                      disabled={busy}
                      onClick={() =>
                        setReworkFor(reworkFor === f.seq ? null : f.seq)
                      }
                    >
                      {t("run:failure.reworkUpstream")}
                    </button>
                    {reworkFor === f.seq && (
                      <div className="rework-popover">
                        {upstream.map((id) => (
                          <button
                            key={id}
                            className="rework-option"
                            disabled={busy}
                            onClick={() => reworkTo(id)}
                          >
                            {nodeName(graph, id, whole)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="failure-panel__footer">
        <button className="btn btn--ghost" disabled={busy} onClick={onRerun}>
          {t("run:failure.rerunAll")}
        </button>
        <span className="muted">
          {failedNodeIds.length > 0
            ? t("run:failure.hintRetry")
            : t("run:failure.hintTripped")}
        </span>
      </div>
    </div>
  );
}
