import { useEffect, useState } from "react";
import { UNIT_LABELS, type Diagnostic } from "@agent-world/core";
import type { Mode } from "../canvas/Canvas";
import { useGraph } from "../store/graph";
import { useRun, useVisibleRuntime, resumeRun } from "../store/run";
import { api, type AppConfig } from "../lib/api";
import { useTranslation } from "react-i18next";
import Tooltip from "./Tooltip";

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
  onOpenModelAssign: () => void;
}

const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "select", label: "run:control.modes.select", hint: "run:control.modes.selectHint" },
  { key: "connect", label: "run:control.modes.connect", hint: "run:control.modes.connectHint" },
  {
    key: "rework",
    label: "run:control.modes.rework",
    hint: "run:control.modes.reworkHint",
  },
  {
    key: "error",
    label: "run:control.modes.error",
    hint: "run:control.modes.errorHint",
  },
  { key: "delete", label: "run:control.modes.delete", hint: "run:control.modes.deleteHint" },
];

const STATUS_TEXT: Record<string, string> = {
  idle: "run:control.statusText.idle",
  running: "run:control.statusText.running",
  done: "run:control.statusText.done",
  failed: "run:control.statusText.failed",
  halted: "run:control.statusText.halted",
  tripped: "run:control.statusText.tripped",
  cancelled: "run:control.statusText.cancelled",
  interrupted: "run:control.statusText.interrupted",
};

type MeterMode = "cost" | "tokens";

function hasPricing(cfg: AppConfig | null): boolean {
  if (!cfg) return false;
  return Object.values(cfg.providers).some(
    (p) => !!p.pricing && Object.keys(p.pricing).length > 0,
  );
}

export default function ControlPanel(props: Props) {
  const {
    mode,
    setMode,
    budget,
    setBudget,
    rawMaterial,
    setRawMaterial,
    diagnostics,
    canRun,
    onRun,
    onCancel,
    onOpenSettings,
    onOpenHistory,
    onOpenModelAssign,
  } = props;
  const { t } = useTranslation();
  const runtime = useVisibleRuntime();
  const { graph, saveState } = useGraph();
  const { runId, connecting, reconnecting } = useRun();

  const [settings, setSettings] = useState<AppConfig | null>(null);
  const [meterMode, setMeterMode] = useState<MeterMode>(
    () => (localStorage.getItem("aw-meter-mode") as MeterMode) || "cost",
  );

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch(() => undefined);
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
    humanHalt && runtime.haltedNodeId
      ? runtime.nodes[runtime.haltedNodeId]?.pendingReview
      : undefined;
  const materialEmpty = rawMaterial.trim() === "";
  const pct =
    budget > 0 ? Math.min(100, (runtime.totalCostUsd / budget) * 100) : 0;
  const hint = MODES.find((m) => m.key === mode)?.hint ?? "";

  return (
    <aside className="panel control">
      <div className="panel__bar">
        <span>{t("run:control.title")}</span>
        <span className={`led led--${runtime.status}`} />
      </div>

      <div className="control__body">
        <section>
          <div className="meter__head">
            <h3 className="label">{t("run:control.power")}</h3>
            {pricingConfigured && (
              <div className="seg">
                <button
                  className={`seg__btn ${effectiveMode === "cost" ? "is-on" : ""}`}
                  onClick={() => setMeterMode("cost")}
                >
                  {t("run:control.cost")}
                </button>
                <button
                  className={`seg__btn ${effectiveMode === "tokens" ? "is-on" : ""}`}
                  onClick={() => setMeterMode("tokens")}
                >
                  {t("run:control.token")}
                </button>
              </div>
            )}
          </div>
          <div className="meter">
            {effectiveMode === "cost" ? (
              <>
                <div className="meter__row">
                  <span className="readout">
                    ${runtime.totalCostUsd.toFixed(5)}
                  </span>
                  <span className="muted">
                    {t("run:control.capUsd", { budget: budget.toFixed(4) })}
                  </span>
                </div>
                <div
                  className={`gauge ${pct > 85 ? "is-hot" : runtime.budgetWarned ? "is-warn" : ""}`}
                >
                  <i style={{ width: `${pct}%` }} />
                </div>
                <label className="field">
                  <span>{t("run:control.budgetCap")}</span>
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
                    {t("run:control.budgetWarn", { pct: Math.round(pct) })}
                  </p>
                )}
                <p className="note">{t("run:control.meterNote")}</p>
              </>
            ) : runtime.totalTokensIn > 0 || runtime.totalTokensOut > 0 ? (
              <>
                <div className="meter__row">
                  <span className="readout">
                    {runtime.totalTokensIn.toLocaleString()} /{" "}
                    {runtime.totalTokensOut.toLocaleString()}
                  </span>
                  <span className="muted">{t("run:control.inOut")}</span>
                </div>
                {runtime.totalCachedTokens > 0 && (
                  <div className="meter__row">
                    <span className="muted">
                      {t("run:control.cacheHit", {
                        n: runtime.totalCachedTokens.toLocaleString(),
                      })}
                    </span>
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
                {t("run:control.meterEmptyBefore")}
                <Tooltip content={t("run:control.meterEmptyInfo")}>
                  <span className="inline-info">
                    {t("run:control.meterEmptySetting")}
                  </span>
                </Tooltip>
                {t("run:control.meterEmptyAfter")}
              </p>
            )}
          </div>
          {runtime.monthlyBudgetWarned && (
            <p className="note note--warn">{t("run:control.monthlyWarn")}</p>
          )}
        </section>

        <section>
          <h3 className="label">{t("run:control.tools")}</h3>
          <div className="modes">
            {MODES.map((m) => (
              <button
                key={m.key}
                className={`chip ${mode === m.key ? "is-on" : ""}`}
                onClick={() => setMode(m.key)}
                title={t(m.hint)}
              >
                {t(m.label)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="label">{t("run:control.status")}</h3>
          {/* 编译/保存状态：常态 → muted 文字；出错 → diag 高亮 */}
          {errors.length === 0 && warnings.length === 0 && (
            <p className="note note--compact">
              {t("run:control.compileOk", { n: graph.nodes.length })}
              {saveState === "saved" && (
                <span className="muted"> · {t("run:control.saved")}</span>
              )}
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
          <p className="status">
            {humanHalt
              ? t("run:control.waitingApproval")
              : STATUS_TEXT[runtime.status]
                ? t(STATUS_TEXT[runtime.status]!)
                : runtime.status}
            {reconnecting && (
              <span className="muted"> · {t("run:control.reconnecting")}</span>
            )}
            {connecting && !reconnecting && (
              <span className="muted"> · {t("run:control.connecting")}</span>
            )}
          </p>
          {humanReview != null && (
            <div className="control-panel__review">
              <span className="muted">{t("run:control.pendingReview")}</span>
              <pre className="control-panel__review-text">{humanReview}</pre>
            </div>
          )}
          {!running && !halted && (
            <label className="field">
              <span>{t("run:control.material")}</span>
              <textarea
                rows={3}
                placeholder={t("run:control.materialPlaceholder")}
                value={rawMaterial}
                onChange={(e) => setRawMaterial(e.target.value)}
              />
            </label>
          )}
          {running ? (
            <button
              className="btn btn--ghost"
              onClick={onCancel}
              disabled={!runId}
            >
              {t("run:control.stop")}
            </button>
          ) : halted ? (
            <div className="btn-row btn-row--wrap">
              {dangerTool ? (
                <>
                  <button
                    className="btn"
                    onClick={() =>
                      resumeRun("approve", undefined, undefined, [dangerTool])
                    }
                  >
                    {t("run:control.approveTool", { tool: dangerTool })}
                  </button>
                  <button
                    className="btn btn--warn"
                    onClick={() => {
                      if (window.confirm(t("run:control.rejectConfirm")))
                        resumeRun("reject");
                    }}
                  >
                    {t("run:control.reject")}
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={() => resumeRun("scrap")}
                  >
                    {t("run:control.scrap")}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" onClick={() => resumeRun("approve")}>
                    {t("run:control.approve")}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      const text = window.prompt(t("run:control.editPrompt"));
                      if (text != null && runtime.haltedNodeId) {
                        resumeRun("edit", undefined, {
                          [runtime.haltedNodeId]: text,
                        });
                      }
                    }}
                  >
                    {t("run:control.editContinue")}
                  </button>
                  <button
                    className="btn btn--warn"
                    onClick={() => {
                      if (window.confirm(t("run:control.rejectConfirm")))
                        resumeRun("reject");
                    }}
                  >
                    {t("run:control.reject")}
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={() => resumeRun("scrap")}
                  >
                    {t("run:control.scrap")}
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
              {t("run:control.dispatch")}
            </button>
          )}
          {!running && !halted && materialEmpty && (
            <p className="note">{t("run:control.fillMaterialFirst")}</p>
          )}
          {!running && !halted && !materialEmpty && !canRun && (
            <p className="note note--warn">
              {errors.length > 0
                ? t("run:control.fixErrorsFirst")
                : t("run:control.compileNotPassed")}
            </p>
          )}
          {running && (
            <p className="note">{t("run:control.stopNote")}</p>
          )}
        </section>

        <section className="control__footer">
          <button
            className="btn btn--ghost btn--block"
            onClick={onOpenSettings}
          >
            {t("run:control.settingsKey")}
          </button>
          <button className="btn btn--ghost btn--block" onClick={onOpenModelAssign}>
            {t("run:control.modelAssign")}
          </button>
          <button className="btn btn--ghost btn--block" onClick={onOpenHistory}>
            {t("run:control.runHistory")}
          </button>
        </section>
      </div>
    </aside>
  );
}
