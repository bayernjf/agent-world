import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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

const MODALITY_KEY: Record<Exclude<Modality, "embedding">, string> = {
  text: "nodes:modality.text",
  image: "nodes:modality.image",
  video: "nodes:modality.video",
  audio: "nodes:modality.audio",
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
  const { t } = useTranslation();
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
  // already use each one (the usedNodes / unused hint on the left list).
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

  // Only consider enabled (non-same) nodes — the "in use" ones can't be
  // toggled at all, so they mustn't flip the all-on / all-off branch.
  const assignable = candidates.filter((n) => modelOf(n) !== picked?.model);
  const allOn = assignable.length > 0 && assignable.every((n) => checked.has(n.id));

  const toggleAll = () => {
    setChecked(allOn ? new Set() : new Set(assignable.map((n) => n.id)));
  };

  const selectedCount = candidates.filter((n) => checked.has(n.id)).length;

  const apply = () => {
    if (!picked || selectedCount === 0) return;
    const changed = assignModel([...checked], picked.model);
    useToast.getState().show(
      changed > 0
        ? t("modals:modelAssign.toastApplied", { changed, model: picked.model })
        : t("modals:modelAssign.toastNoChange"),
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
            <h2>{t("modals:modelAssign.title")}</h2>
            <span className="model-assign__sub">
              {t("modals:modelAssign.sub", { name: graph.name })}
            </span>
          </div>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>

        {noModels ? (
          <div className="modal__body model-assign__empty">
            <p>{t("modals:modelAssign.empty")}</p>
            <button className="btn" onClick={onOpenSettings}>
              {t("modals:modelAssign.goSettings")}
            </button>
          </div>
        ) : (
          <>
            <div className="modal__body">
              <div className="model-assign">
                <div className="model-assign__side">
                  {MODALITY_ORDER.filter((mod) => (grouped.get(mod)?.length ?? 0) > 0).map((mod) => (
                    <div key={mod} className="model-assign__group">
                      <p className="model-assign__group-label">
                        {t("modals:modelAssign.groupLabel", {
                          modality: t(MODALITY_KEY[mod]),
                        })}
                      </p>
                      {(grouped.get(mod) ?? []).map(({ option, used }) => (
                        <button
                          key={`${option.provider}/${option.model}`}
                          className={`model-assign__model ${picked?.model === option.model ? "is-on" : ""}`}
                          onClick={() => pick(option)}
                        >
                          <span className={`model-assign__dot model-assign__dot--${mod}`} />
                          <span className="model-assign__model-name">{option.model}</span>
                          <span className="model-assign__model-count">
                            {used > 0
                              ? t("modals:modelAssign.usedNodes", { used })
                              : t("modals:modelAssign.unused")}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="model-assign__main">
                  {!picked ? (
                    <p className="model-assign__hint">{t("modals:modelAssign.pickHint")}</p>
                  ) : candidates.length === 0 ? (
                    <p className="model-assign__hint">
                      {t("modals:modelAssign.noNodes", {
                        modality: t(MODALITY_KEY[picked.modality]),
                      })}
                    </p>
                  ) : (
                    <>
                      <div className="model-assign__main-head">
                        <span className={`modality-badge modality--${picked.modality}`}>
                          {t(MODALITY_KEY[picked.modality])}
                        </span>
                        <span className="model-assign__picked">{picked.model}</span>
                        <button className="model-assign__toggle" onClick={toggleAll}>
                          {/* The action toggles, so the label must say which way it
                              is about to go — a static "select all" read as a promise
                              and then cleared an all-selected list (audit L8). */}
                          {allOn
                            ? t("modals:modelAssign.clearAll")
                            : t("modals:modelAssign.selectAll")}
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
                                {same
                                  ? t("modals:modelAssign.inUse")
                                  : modelOf(n) || t("modals:modelAssign.unset")}
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
                  <Trans
                    i18nKey="modals:modelAssign.summary"
                    values={{ nodes: selectedCount, model: picked.model }}
                    components={{ b: <b /> }}
                  />
                ) : (
                  t("modals:modelAssign.noSelection")
                )}
              </span>
              <button className="btn" onClick={apply} disabled={!picked || selectedCount === 0}>
                {t("modals:modelAssign.apply")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
