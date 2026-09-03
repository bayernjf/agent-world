import { useTranslation } from "react-i18next";
import { useRun } from "../store/run";
import Tooltip from "./Tooltip";

// Event types are engine-side ids, so they map to pack keys instead of copy.
const EVENT_LABELS: Record<string, string> = {
  "run.started": "run:timeline.events.runStarted",
  "node.started": "run:timeline.events.nodeStarted",
  "node.delta": "run:timeline.events.nodeDelta",
  "node.finished": "run:timeline.events.nodeFinished",
  "node.failed": "run:timeline.events.nodeFailed",
  "packet.sent": "run:timeline.events.packetSent",
  "gate.verdict": "run:timeline.events.gateVerdict",
  "gate.exhausted": "run:timeline.events.gateExhausted",
  "power.metered": "run:timeline.events.powerMetered",
  "power.tripped": "run:timeline.events.powerTripped",
  "run.finished": "run:timeline.events.runFinished",
};

/**
 * Scrubbing re-folds the event log up to a sequence number rather than undoing
 * state, which is why the reducer has to stay pure.
 */
export default function Timeline() {
  const { t } = useTranslation();
  const { events, scrubSeq, scrubTo, view, reset } = useRun();
  if (events.length === 0) return null;

  const maxSeq = events.at(-1)!.seq;
  const at = scrubSeq ?? maxSeq;
  const current = events.filter((e) => e.seq <= at).at(-1);
  // Unknown event types still show their raw id rather than a missing key.
  const currentKey = current ? EVENT_LABELS[current.type] : undefined;
  const currentLabel = current ? (currentKey ? t(currentKey) : current.type) : "";

  return (
    <div className="panel timeline">
      <div className="timeline__head">
        <span className="label">{t("run:timeline.replay")}</span>
        <span className="muted">
          seq {at} / {maxSeq}
          {current ? ` · ${currentLabel}` : ""}
        </span>
        {scrubSeq !== null && (
          <button className="chip" onClick={() => scrubTo(null)}>
            {t("run:timeline.backToLive")}
          </button>
        )}
        {view === "replay" && scrubSeq === null && (
          <Tooltip content={t("run:timeline.exitReplayHint")}>
            <button className="chip" onClick={() => reset()}>
              {t("run:timeline.exitReplay")}
            </button>
          </Tooltip>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={maxSeq}
        value={at}
        onChange={(e) => {
          const v = Number(e.target.value);
          scrubTo(v >= maxSeq ? null : v);
        }}
      />
    </div>
  );
}
