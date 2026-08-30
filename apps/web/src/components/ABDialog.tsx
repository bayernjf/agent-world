import { useEffect, useState } from "react";
import type { Graph } from "@agent-world/core";
import { api } from "../lib/api";

interface Props {
  open: boolean;
  graph: Graph | null;
  onClose: () => void;
  onLaunched: (groupId: string) => void;
}

export default function ABDialog({ open, graph, onClose, onLaunched }: Props) {
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
  const canLaunch = graph != null && effectiveTarget !== "" && variants.length >= 2 && !launching;

  const launch = async () => {
    if (!graph) return;
    setError(null);
    setLaunching(true);
    try {
      const budgetUsd = budget.trim() === "" ? null : Number(budget);
      const res = await api.startAB(graph.id, effectiveTarget, variants, budgetUsd, input.trim());
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
          <h2>A/B 实验</h2>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="modal__body">
          {textGenNodes.length === 0 ? (
            <p className="muted">当前产线没有文坊(textGen)节点，无法发起 A/B。</p>
          ) : (
            <>
              <div className="field">
                <span>目标文坊（将替换其 prompt）</span>
                <select value={effectiveTarget} onChange={(e) => setTargetNodeId(e.target.value)}>
                  {textGenNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span>Prompt 变体（每行一个，将作为 A / B / C… 各臂）</span>
                <textarea
                  rows={6}
                  placeholder={"版本一：用更口语的方式改写\n版本二：突出促销信息\n版本三：强调成分安全"}
                  value={variantsText}
                  onChange={(e) => setVariantsText(e.target.value)}
                />
                <div className="field__hint">已识别 {variants.length} 个变体（至少需要 2 个）。</div>
              </div>
              <div className="field">
                <span>预算上限（USD，可选）</span>
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="留空则不限制"
                />
              </div>
              <div className="field">
                <span>原材料（可选）</span>
                <textarea
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="留空则使用产线默认原材料"
                />
              </div>
              {error && (
                <div className="error-box">
                  <span className="error-msg">{error}</span>
                </div>
              )}
              <div className="btn-row">
                <button className="btn btn--block" disabled={!canLaunch} onClick={launch}>
                  {launching ? "发起中…" : `发起 A/B（${variants.length} 臂）`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
