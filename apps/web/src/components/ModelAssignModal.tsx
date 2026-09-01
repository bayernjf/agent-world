import { useEffect, useMemo, useState } from "react";
import type { GraphNode } from "@agent-world/core";
import type { Modality } from "../lib/api";
import { useToast } from "../store/toast";
import {
  getModelOptions,
  refreshDefaultModel,
  useGraph,
  type ModelOption,
} from "../store/graph";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

/** AI node kinds grouped by the modality their worker executes against. */
const MODALITY_KINDS: Record<Exclude<Modality, "embedding">, GraphNode["kind"][]> = {
  text: ["textGen"],
  image: ["imageGen"],
  video: ["videoGen"],
  audio: ["audioGen"],
};

const MODALITY_LABEL: Record<Exclude<Modality, "embedding">, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
};

const MODALITY_ORDER: Exclude<Modality, "embedding">[] = ["text", "image", "video", "audio"];

type AiModality = Exclude<Modality, "embedding">;

/** Current model of an AI node ("" when unset). */
function modelOf(node: GraphNode): string {
  if (node.kind === "textGen") return node.textGen?.model ?? "";
  if (node.kind === "imageGen") return node.imageGen?.model ?? "";
  if (node.kind === "videoGen") return node.videoGen?.model ?? "";
  if (node.kind === "audioGen") return node.audioGen?.model ?? "";
  return "";
}

function modalityOfNode(node: GraphNode): AiModality | null {
  for (const mod of MODALITY_ORDER) {
    if (MODALITY_KINDS[mod].includes(node.kind)) return mod;
  }
  return null;
}

export default function ModelAssignModal({ open, onClose, onOpenSettings }: Props) {
  const { graph, assignModel } = useGraph();
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [picked, setPicked] = useState<{ provider: string; model: string; modality: AiModality } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Reload the (cached) model options each time the modal opens so entries
  // added/edited in Settings show up without a page refresh.
  useEffect(() => {
    if (!open) return;
    void refreshDefaultModel().then(() => setOptions(getModelOptions()));
    setPicked(null);
    setChecked(new Set());
  }, [open]);

  const aiNodes = useMemo(
    () => graph.nodes.filter((n) => modalityOfNode(n) !== null),
    [graph.nodes],
  );

  // Models grouped by modality, with the number of current-graph nodes that
  // already use each one (the "N 节点 / 未使用" hint on the left list).
  const grouped = useMemo(() => {
    const byMod = new Map<AiModality, { option: ModelOption; used: number }[]>();
    for (const option of options) {
      const mod = option.modality as AiModality | "embedding";
      if (mod === "embedding") continue;
      const list = byMod.get(mod) ?? [];
      const used = aiNodes.filter((n) => modelOf(n) === option.model).length;
      list.push({ option, used });
      byMod.set(mod, list);
    }
    return byMod;
  }, [options, aiNodes]);

  // Candidate nodes for the picked model: same modality, by kind.
  const candidates = useMemo(() => {
    if (!picked) return [];
    return aiNodes.filter((n) => modalityOfNode(n) === picked.modality);
  }, [aiNodes, picked]);

  const pick = (option: ModelOption) => {
    const mod = option.modality as AiModality;
    setPicked({ provider: option.provider, model: option.model, modality: mod });
    // Default: check every same-modality node except those already on this
    // model (re-assigning them is a no-op, so they start unchecked).
    setChecked(
      new Set(
        aiNodes
          .filter((n) => modalityOfNode(n) === mod && modelOf(n) !== option.model)
          .map((n) => n.id),
      ),
    );
  };

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    // Only consider enabled (non-same) nodes — "已使用" ones can't be
    // toggled at all, so they mustn't flip the all-on / all-off branch.
    const enabled = candidates.filter((n) => modelOf(n) !== picked?.model);
    const allOn = enabled.length > 0 && enabled.every((n) => checked.has(n.id));
    setChecked(allOn ? new Set() : new Set(enabled.map((n) => n.id)));
  };

  const selectedCount = candidates.filter((n) => checked.has(n.id)).length;

  const apply = () => {
    if (!picked || selectedCount === 0) return;
    const changed = assignModel([...checked], picked.model);
    useToast.getState().show(
      changed > 0 ? `已将 ${changed} 个节点切换为 ${picked.model}` : "所选节点均已在用该模型",
      { ttlMs: 3500 },
    );
    // Keep the modal open so the user can switch another model or adjust
    // the selection; just clear the checked set so the Apply button goes
    // back to disabled until they re-tick something.
    setChecked(new Set());
  };

  if (!open) return null;

  const noModels = options.length === 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide modal--tall" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="model-assign__head-left">
            <h2>模型分配</h2>
            <span className="model-assign__sub">
              当前产线：{graph.name} · 只改选中节点的模型字段
            </span>
          </div>
          <Tooltip content="关闭">
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>

        {noModels ? (
          <div className="modal__body model-assign__empty">
            <p>尚未配置任何可用模型。</p>
            <button className="btn" onClick={onOpenSettings}>
              去设置 · 模型与密钥
            </button>
          </div>
        ) : (
          <>
            <div className="modal__body">
              <div className="model-assign">
                <div className="model-assign__side">
                  {MODALITY_ORDER.filter((mod) => (grouped.get(mod)?.length ?? 0) > 0).map((mod) => (
                    <div key={mod} className="model-assign__group">
                      <p className="model-assign__group-label">{MODALITY_LABEL[mod]}模型</p>
                      {(grouped.get(mod) ?? []).map(({ option, used }) => (
                        <button
                          key={`${option.provider}/${option.model}`}
                          className={`model-assign__model ${picked?.model === option.model ? "is-on" : ""}`}
                          onClick={() => pick(option)}
                        >
                          <span className={`model-assign__dot model-assign__dot--${mod}`} />
                          <span className="model-assign__model-name">{option.model}</span>
                          <span className="model-assign__model-count">
                            {used > 0 ? `${used} 节点` : "未使用"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="model-assign__main">
                  {!picked ? (
                    <p className="model-assign__hint">点击左侧模型，查看当前产线中可指派的节点。</p>
                  ) : candidates.length === 0 ? (
                    <p className="model-assign__hint">
                      当前产线没有{MODALITY_LABEL[picked.modality]}类节点。
                    </p>
                  ) : (
                    <>
                      <div className="model-assign__main-head">
                        <span className={`modality-badge modality--${picked.modality}`}>
                          {MODALITY_LABEL[picked.modality]}
                        </span>
                        <span className="model-assign__picked">{picked.model}</span>
                        <button className="model-assign__toggle" onClick={toggleAll}>
                          全选
                        </button>
                      </div>
                      <div className="model-assign__list">
                        {candidates.map((n) => {
                          const same = modelOf(n) === picked.model;
                          const on = !same && checked.has(n.id);
                          return (
                            <button
                              key={n.id}
                              className={`model-assign__node ${on ? "is-on" : ""} ${same ? "is-same" : ""}`}
                              onClick={() => { if (!same) toggle(n.id); }}
                              disabled={same}
                            >
                              <span className="model-assign__box" />
                              <span className="model-assign__node-name">{n.name}</span>
                              <span className="model-assign__node-kind">{n.kind}</span>
                              <span className={`model-assign__node-cur ${same ? "is-same" : ""}`}>
                                {same ? "已使用" : modelOf(n) || "(未配置)"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="model-assign__foot">
              <span className="model-assign__summary">
                {picked && selectedCount > 0 ? (
                  <>
                    将把 <b>{selectedCount}</b> 个节点的模型切换为 <b>{picked.model}</b>
                    （保存时自动快照，可 Ctrl+Z 撤销）
                  </>
                ) : (
                  "未选中任何节点"
                )}
              </span>
              <button className="btn" onClick={apply} disabled={!picked || selectedCount === 0}>
                确认应用
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
