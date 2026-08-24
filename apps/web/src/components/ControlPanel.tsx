import type { Diagnostic } from "@agent-world/core";
import type { Mode } from "../canvas/Canvas";
import { useGraph } from "../store/graph";
import { useRun, useVisibleRuntime } from "../store/run";

interface Props {
  mode: Mode;
  setMode: (m: Mode) => void;
  budget: number;
  setBudget: (v: number) => void;
  diagnostics: Diagnostic[];
  canRun: boolean;
  onRun: () => void;
  onCancel: () => void;
}

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "select", label: "选择", hint: "拖动厂房重新布局，单击查看详情" },
  { key: "connect", label: "铺管道", hint: "依次点两座厂房，铺一条正向管道" },
  { key: "rework", label: "返工线", hint: "从质检站点回上游厂房，铺一条返工线" },
  { key: "delete", label: "拆除", hint: "点厂房或管道即拆除" },
];

const STATUS_TEXT: Record<string, string> = {
  idle: "产线就绪 · 等待投料",
  running: "运行中",
  done: "全部出厂",
  failed: "产线故障",
  halted: "返工次数耗尽 · 等待人工",
  tripped: "电力不足 · 全厂停机",
  cancelled: "已取消",
};

export default function ControlPanel(props: Props) {
  const { mode, setMode, budget, setBudget, diagnostics, canRun, onRun, onCancel } = props;
  const runtime = useVisibleRuntime();
  const { graph } = useGraph();
  const { runId } = useRun();

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const running = runtime.status === "running";
  const pct = budget > 0 ? Math.min(100, (runtime.totalCostUsd / budget) * 100) : 0;
  const hint = MODES.find((m) => m.key === mode)?.hint ?? "";

  return (
    <aside className="panel control">
      <div className="panel__bar">
        <span>控制面板</span>
        <span className={`led led--${runtime.status}`} />
      </div>

      <div className="control__body">
        <section>
          <h3 className="label">电力</h3>
          <div className="meter">
            <div className="meter__row">
              <span className="readout">${runtime.totalCostUsd.toFixed(5)}</span>
              <span className="muted">上限 ${budget.toFixed(4)}</span>
            </div>
            <div className={`gauge ${pct > 85 ? "is-hot" : ""}`}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <label className="field">
              <span>预算上限 (USD)</span>
              <input
                type="number"
                step="0.0001"
                min="0"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                disabled={running}
              />
            </label>
            <p className="note">
              token 消耗只能在调用返回后计量，所以电表是事后读数；超过上限即刻跳闸停线。
            </p>
          </div>
        </section>

        <section>
          <h3 className="label">工具</h3>
          <div className="modes">
            {MODES.map((m) => (
              <button
                key={m.key}
                className={`chip ${mode === m.key ? "is-on" : ""}`}
                onClick={() => setMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="note">{hint}</p>
        </section>

        <section>
          <h3 className="label">编译</h3>
          {errors.length === 0 && warnings.length === 0 && (
            <p className="diag diag--ok">图可编译 · {graph.nodes.length} 座厂房</p>
          )}
          {errors.map((d, i) => (
            <p key={`e${i}`} className="diag diag--error">
              {d.message}
            </p>
          ))}
          {warnings.map((d, i) => (
            <p key={`w${i}`} className="diag diag--warn">
              {d.message}
            </p>
          ))}
        </section>

        <section>
          <h3 className="label">状态</h3>
          <p className="status">{STATUS_TEXT[runtime.status] ?? runtime.status}</p>
          {running ? (
            <button className="btn btn--ghost" onClick={onCancel} disabled={!runId}>
              停机
            </button>
          ) : (
            <button className="btn" onClick={onRun} disabled={!canRun}>
              派发任务
            </button>
          )}
        </section>
      </div>
    </aside>
  );
}
