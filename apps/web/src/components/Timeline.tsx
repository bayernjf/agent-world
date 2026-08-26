import { useRun } from "../store/run";

const LABEL: Record<string, string> = {
  "run.started": "开工",
  "node.started": "开始作业",
  "node.delta": "产出流入",
  "node.finished": "作业完成",
  "node.failed": "作业失败",
  "packet.sent": "货物发出",
  "gate.verdict": "质检判定",
  "gate.exhausted": "返工次数耗尽",
  "power.metered": "电表读数",
  "power.tripped": "跳闸",
  "run.finished": "收工",
};

/**
 * Scrubbing re-folds the event log up to a sequence number rather than undoing
 * state, which is why the reducer has to stay pure.
 */
export default function Timeline() {
  const { events, scrubSeq, scrubTo, view, reset } = useRun();
  if (events.length === 0) return null;

  const maxSeq = events.at(-1)!.seq;
  const at = scrubSeq ?? maxSeq;
  const current = events.filter((e) => e.seq <= at).at(-1);

  return (
    <div className="panel timeline">
      <div className="timeline__head">
        <span className="label">回放</span>
        <span className="muted">
          seq {at} / {maxSeq}
          {current ? ` · ${LABEL[current.type] ?? current.type}` : ""}
        </span>
        {scrubSeq !== null && (
          <button className="chip" onClick={() => scrubTo(null)}>
            回到实时
          </button>
        )}
        {view === "replay" && scrubSeq === null && (
          <button className="chip" onClick={() => reset()} title="退出历史回放，回到当前产线">
            退出回放
          </button>
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
