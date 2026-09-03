import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Graph } from "@agent-world/core";
import { api } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  graph: Graph | null;
  onClose: () => void;
  onLaunched: (groupId: string) => void;
}

export default function ABDialog({ open, graph, onClose, onLaunched }: Props) {
  const { t } = useTranslation();
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
      setInput("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const effectiveTarget = targetNodeId || textGenNodes[0]?.id || "";
  const variants = variantsText
    .split("\n")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const canLaunch =
    graph != null &&
    effectiveTarget !== "" &&
    variants.length >= 2 &&
    !launching;

  const launch = async () => {
    if (!graph) return;
    setError(null);
    setLaunching(true);
    try {
      const budgetUsd = budget.trim() === "" ? null : Number(budget);
      const res = await api.startAB(
        graph.id,
        effectiveTarget,
        variants,
        budgetUsd,
        input.trim(),
      );
      onLaunched(res.abGroup);
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
  };

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
          {textGenNodes.length === 0 ? (
            <p className="muted">
              {t("modals:abDialog.noTextGen", { node: t("nodes:textGen") })}
            </p>
          ) : (
            <>
              <div className="field">
                <span>{t("modals:abDialog.targetLabel", { node: t("nodes:textGen") })}</span>
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
                  {t("modals:abDialog.variantsHint", { count: variants.length })}
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
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t("modals:abDialog.inputPlaceholder")}
                />
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
                    : t("modals:abDialog.launch", { count: variants.length })}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
