import { useEffect, useState } from "react";
import type { Diagnostic } from "@agent-world/core";
import type { Mode } from "../canvas/Canvas";
import { useGraph } from "../store/graph";
import { useRun, useVisibleRuntime, resumeRun } from "../store/run";
import { api, type AppConfig } from "../lib/api";

interface Props {
  mode: Mode;
  setMode: (m: Mode) => void;
  budget: number;
  setBudget: (v: number) => void;
  rawMaterial: string;
  setRawMaterial: (v: string) => void;
  diagnostics: Diagnostic[];
  canRun: boolean;
  onRun: () => void;
  onCancel: () => void;
  onOpenSettings: () => void;
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
  interrupted: "上次运行中断（服务重启）",
};

type MeterMode = "cost" | "tokens";

function hasPricing(cfg: AppConfig | null): boolean {
  if (!cfg) return false;
  return Object.values(cfg.providers).some((p) => !!p.pricing && Object.keys(p.pricing).length > 0);
}

export default function ControlPanel(props: Props) {
  const { mode, setMode, budget, setBudget, rawMaterial, setRawMaterial, diagnostics, canRun, onRun, onCancel, onOpenSettings } = props;
  const runtime = useVisibleRuntime();
  const { graph, saveState } = useGraph();
  const { runId, connecting } = useRun();

  const [settings, setSettings] = useState<AppConfig | null>(null);
  const [meterMode, setMeterMode] = useState<MeterMode>(
    () => (localStorage.getItem("aw-meter-mode") as MeterMode) || "cost",
  );

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => undefined);
  }, [saveState]);

  const pricingConfigured = hasPricing(settings);
  // Without a unit price there is no cost to show — force token view.
  const effectiveMode: MeterMode = pricingConfigured ? meterMode : "tokens";

  useEffect(() => {
    localStorage.setItem("aw-meter-mode", effectiveMode);
  }, [effectiveMode]);

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const running = runtime.status === "running";
  const halted = runtime.status === "halted";
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
          <div className="meter__head">
            <h3 className="label">电力</h3>
            {pricingConfigured && (
              <div className="seg">
                <button
                  className={`seg__btn ${effectiveMode === "cost" ? "is-on" : ""}`}
                  onClick={() => setMeterMode("cost")}
                >
                  电费
                </button>
                <button
                  className={`seg__btn ${effectiveMode === "tokens" ? "is-on" : ""}`}
                  onClick={() => setMeterMode("tokens")}
                >
                  Token
                </button>
              </div>
            )}
          </div>
          <div className="meter">
            {effectiveMode === "cost" ? (
              <>
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
              </>
            ) : (
              <>
                <div className="meter__row">
                  <span className="readout">
                    {runtime.totalTokensIn.toLocaleString()} / {runtime.totalTokensOut.toLocaleString()}
                  </span>
                  <span className="muted">入 / 出</span>
                </div>
                {runtime.totalCachedTokens > 0 && (
                  <div className="meter__row">
                    <span className="muted">缓存命中 {runtime.totalCachedTokens.toLocaleString()}</span>
                  </div>
                )}
                {!pricingConfigured && (
                  <p className="note">
                    未配置模型单价，只显示 token 用量。在「设置」里填入单价后可显示电费和预算。
                  </p>
                )}
              </>
            )}
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
            <p className="diag diag--ok">
              图可编译 · {graph.nodes.length} 座厂房
              {saveState === "saved" && <span className="muted"> · 已保存</span>}
            </p>
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
          <p className="status">
            {STATUS_TEXT[runtime.status] ?? runtime.status}
            {connecting && <span className="muted"> · 重连中…</span>}
          </p>
          {!running && !halted && (
            <label className="field">
              <span>原料（投递给进料口的任务）</span>
              <textarea
                rows={3}
                placeholder="写下要交给这条产线加工的内容…"
                value={rawMaterial}
                onChange={(e) => setRawMaterial(e.target.value)}
              />
            </label>
          )}
          {running ? (
            <button className="btn btn--ghost" onClick={onCancel} disabled={!runId}>
              停机
            </button>
          ) : halted ? (
            <div className="btn-row">
              <button className="btn" onClick={() => resumeRun("continue")}>
                人工放行
              </button>
              <button className="btn btn--ghost" onClick={() => resumeRun("scrap")}>
                报废
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => onRun()} disabled={!canRun}>
              派发任务
            </button>
          )}
          {running && (
            <p className="note">停机只停止后续工作，已产生的 token 仍会计费。</p>
          )}
        </section>

        <section>
          <button className="btn btn--ghost btn--block" onClick={onOpenSettings}>
            设置 · 模型与密钥
          </button>
        </section>
      </div>
    </aside>
  );
}
