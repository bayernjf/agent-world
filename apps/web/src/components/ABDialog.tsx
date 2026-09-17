import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Graph } from "@agent-world/core";
import { api } from "../lib/api";
import Tooltip from "./Tooltip";

/**
 * G5.1: when launched from a finished run's timeline ("compare prompt on this
 * sample"), the dialog locks the target and starting input to that run and only
 * asks for the new prompt(s); arm A is projected server-side from the live
 * prompt. Without a sample the dialog behaves as the original manual A/B form.
 */
export interface ABCompareSample {
  runId: string;
  graphId: string;
  targetNodeId: string;
  targetName?: string;
  input: string;
}

interface Props {
  open: boolean;
  graph: Graph | null;
  onClose: () => void;
  onLaunched: (groupId: string) => void;
  sample?: ABCompareSample | null;
}

export default function ABDialog({ open, graph, onClose, onLaunched, sample = null }: Props) {
  const { t } = useTranslation();
  const isSample = sample != null;
  const textGenNodes = graph?.nodes.filter((n) => n.kind === "textGen") ?? [];
  const [targetNodeId, setTargetNodeId] = useState("");
  const [variantsText, setVariantsText] = useState("");
  const [budget, setBudget] = useState("");
  const [input, setInput] = useState("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTargetNodeId("");
      setVariantsText("");
      setBudget("");
      setInput(sample?.input ?? "");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const effectiveTarget = isSample
    ? sample!.targetNodeId
    : targetNodeId || textGenNodes[0]?.id || "";
  const variants = variantsText
    .split("\n")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const minVariants = isSample ? 1 : 2;
  const canLaunch = effectiveTarget !== "" && variants.length >= minVariants && !launching;
  const armCount = variants.length + (isSample ? 1 : 0);

  const launch = async () => {
    setError(null);
    setLaunching(true);
    try {
      const budgetUsd = budget.trim() === "" ? null : Number(budget);
      const res = await api.startAB(
        isSample ? sample!.graphId : graph!.id,
        effectiveTarget,
        variants,
        budgetUsd,
        isSample ? sample!.input : input.trim(),
        isSample ? sample!.runId : undefined,
      );
      onLaunched(res.abGroup);
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
  };

  const showForm = isSample || textGenNodes.length > 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:abDialog.title")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          {!showForm ? (
            <p className="muted">
              {t("modals:abDialog.noTextGen", { node: t("nodes:textGen") })}
            </p>
          ) : (
            <>
              {isSample && (
                <div className="ab-winner-note" style={{ marginBottom: 12 }}>
                  {t("modals:abDialog.sampleHint")}
                </div>
              )}
              <div className="field">
                <span>{t("modals:abDialog.targetLabel", { node: t("nodes:textGen") })}</span>
                {isSample ? (
                  <select value={sample!.targetNodeId} disabled>
                    <option value={sample!.targetNodeId}>
                      {sample!.targetName || sample!.targetNodeId}
                    </option>
                  </select>
                ) : (
                  <select
                    value={effectiveTarget}
                    onChange={(e) => setTargetNodeId(e.target.value)}
                  >
                    {textGenNodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="field">
                <span>{t("modals:abDialog.variantsLabel")}</span>
                <textarea
                  rows={6}
                  placeholder={t("modals:abDialog.variantsPlaceholder")}
                  value={variantsText}
                  onChange={(e) => setVariantsText(e.target.value)}
                />
                <div className="field__hint">
                  {isSample
                    ? t("modals:abDialog.variantsHintSample", { count: variants.length })
                    : t("modals:abDialog.variantsHint", { count: variants.length })}
                </div>
              </div>
              <div className="field">
                <span>{t("modals:abDialog.budgetLabel")}</span>
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder={t("modals:abDialog.budgetPlaceholder")}
                />
              </div>
              <div className="field">
                <span>{t("modals:abDialog.inputLabel")}</span>
                <textarea
                  rows={2}
                  value={input}
                  readOnly={isSample}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t("modals:abDialog.inputPlaceholder")}
                />
                {isSample && <div className="field__hint">{t("modals:abDialog.inputFromRun")}</div>}
              </div>
              {error && (
                <div className="error-box">
                  <span className="error-msg">{error}</span>
                </div>
              )}
              <div className="btn-row">
                <button
                  className="btn btn--block"
                  disabled={!canLaunch}
                  onClick={launch}
                >
                  {launching
                    ? t("modals:abDialog.launching")
                    : t("modals:abDialog.launch", { count: armCount })}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
