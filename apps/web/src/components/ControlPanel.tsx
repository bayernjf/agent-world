import { useEffect, useState } from "react";
import { UNIT_LABELS, type Diagnostic } from "@agent-world/core";
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
  onOpenHistory: () => void;
}

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "select", label: "选择", hint: "拖动节点重新布局，单击查看详情" },
  { key: "connect", label: "铺管道", hint: "依次点两座节点，铺一条正向管道" },
  { key: "rework", label: "返工线", hint: "从质检站点回上游节点，铺一条返工线" },
  { key: "error", label: "容错线", hint: "上游节点故障时改走这条线，接到兜底节点（catch）" },
  { key: "delete", label: "拆除", hint: "点节点或管道即拆除" },
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
  const { mode, setMode, budget, setBudget, rawMaterial, setRawMaterial, diagnostics, canRun, onRun, onCancel, onOpenSettings, onOpenHistory } = props;
  const runtime = useVisibleRuntime();
  const { graph, saveState } = useGraph();
  const { runId, connecting, reconnecting } = useRun();

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
  const dangerTool =
    halted && runtime.reason?.startsWith("dangerous-tool:")
      ? runtime.reason.slice("dangerous-tool:".length)
      : null;
  const humanHalt = halted && runtime.reason?.startsWith("human:");
  const humanReview =
    humanHalt && runtime.haltedNodeId ? runtime.nodes[runtime.haltedNodeId]?.pendingReview : undefined;
  const materialEmpty = rawMaterial.trim() === "";
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
                <div className={`gauge ${pct > 85 ? "is-hot" : runtime.budgetWarned ? "is-warn" : ""}`}>
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
                {runtime.budgetWarned && pct <= 100 && (
                  <p className="note note--warn">
                    ⚠ 电费已达预算的 {Math.round(pct)}%，接近上限，注意控制返工。
                  </p>
                )}
                <p className="note">
                  token 消耗只能在调用返回后计量，所以电表是事后读数；超过上限即刻跳闸停线。
                </p>
              </>
            ) : (
              runtime.totalTokensIn > 0 || runtime.totalTokensOut > 0 ? (
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
                  {Object.entries(runtime.totalUnits).some(([, v]) => v > 0) && (
                    <div className="meter__row">
                      <span className="muted">
                        {Object.entries(runtime.totalUnits)
                          .filter(([, v]) => v > 0)
                          .map(([k, v]) => `${v}${UNIT_LABELS[k] ?? k}`)
                          .join(" · ")}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <p className="muted">
                  电力读数待派发后出现 · 在
                  <span className="inline-info" title="未配置模型单价时只显示 token 用量；在「设置」里填入单价后可显示电费和预算">
                    ⓘ 设置
                  </span>
                  里填入单价可开启预算和电费读数
                </p>
              )
            )}
          </div>
          {runtime.monthlyBudgetWarned && (
            <p className="note note--warn">
              ⚠ 本月累计电费已触及月度预算，请到「设置 → 月度预算」查看或调整上限。
            </p>
          )}
        </section>

        <section>
          <h3 className="label">工具</h3>
          <div className="modes">
            {MODES.map((m) => (
              <button
                key={m.key}
                className={`chip ${mode === m.key ? "is-on" : ""}`}
                onClick={() => setMode(m.key)}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="label">状态</h3>
          {/* 编译/保存状态：常态 → muted 文字；出错 → diag 高亮 */}
          {errors.length === 0 && warnings.length === 0 && (
            <p className="note note--compact">
              图可编译 · {graph.nodes.length} 座节点
              {saveState === "saved" && <span className="muted"> · 已保存</span>}
            </p>
          )}
          {errors.map((d, i) => (
            <p key={`e${i}`} className="diag diag--error">{d.message}</p>
          ))}
          {warnings.map((d, i) => (
            <p key={`w${i}`} className="diag diag--warn">{d.message}</p>
          ))}
          <p className="status">
            {humanHalt ? "等待人工审批" : STATUS_TEXT[runtime.status] ?? runtime.status}
            {reconnecting && <span className="muted"> · 重连中…</span>}
            {connecting && !reconnecting && <span className="muted"> · 连接中…</span>}
          </p>
          {humanReview != null && (
            <div className="control-panel__review">
              <span className="muted">待审批内容：</span>
              <pre className="control-panel__review-text">{humanReview}</pre>
            </div>
          )}
          {!running && !halted && (
            <label className="field">
              <span>原料（交给原料台的任务）</span>
              <textarea
                rows={3}
                placeholder="把素材或任务交给原料台…"
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
            <div className="btn-row btn-row--wrap">
              {dangerTool ? (
                <>
                  <button
                    className="btn"
                    onClick={() => resumeRun("approve", undefined, undefined, [dangerTool])}
                  >
                    批准执行 {dangerTool}
                  </button>
                  <button
                    className="btn btn--warn"
                    onClick={() => {
                      if (window.confirm("驳回此次运行？运行将以失败结束。")) resumeRun("reject");
                    }}
                  >
                    驳回
                  </button>
                  <button className="btn btn--ghost" onClick={() => resumeRun("scrap")}>
                    报废
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" onClick={() => resumeRun("approve")}>
                    批准继续
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      const text = window.prompt("编辑该节点的产出（人工修正后继续）：");
                      if (text != null && runtime.haltedNodeId) {
                        resumeRun("edit", undefined, { [runtime.haltedNodeId]: text });
                      }
                    }}
                  >
                    编辑后继续
                  </button>
                  <button
                    className="btn btn--warn"
                    onClick={() => {
                      if (window.confirm("驳回此次运行？运行将以失败结束。")) resumeRun("reject");
                    }}
                  >
                    驳回
                  </button>
                  <button className="btn btn--ghost" onClick={() => resumeRun("scrap")}>
                    报废
                  </button>
                </>
              )}
            </div>
          ) : (
            <button
              className="btn"
              onClick={() => onRun()}
              disabled={!canRun || materialEmpty}
            >
              派发任务
            </button>
          )}
          {!running && !halted && materialEmpty && (
            <p className="note">先填入原料才能派发给进料口。</p>
          )}
          {!running && !halted && !materialEmpty && !canRun && (
            <p className="note note--warn">
              {errors.length > 0
                ? "修复上方「编译」里的错误后才能派发。"
                : "编译检查未通过，请刷新页面重试；若仍不行，检查「编译」区块的报错。"}
            </p>
          )}
          {running && (
            <p className="note">停机只停止后续工作，已产生的 token 仍会计费。</p>
          )}
        </section>

        <section className="control__footer">
          <button className="btn btn--ghost btn--block" onClick={onOpenSettings}>
            设置 · 模型与密钥
          </button>
          <button className="btn btn--ghost btn--block" onClick={onOpenHistory}>
            📋 运行历史
          </button>
        </section>
      </div>
    </aside>
  );
}
