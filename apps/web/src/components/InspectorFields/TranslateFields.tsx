import type { FieldsProps } from "./types";
import { MissingModelHint } from "./shared";

export default function TranslateFields({
  node,
  graph,
  updateNode,
  t,
  onOpenSettings,
  textModelOptions,
}: FieldsProps) {
  if (!node.translate) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.common.source")}</span>
        <select
          className="select"
          value={node.translate.source ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              translate: {
                ...node.translate!,
                source: e.target.value || undefined,
              },
            })
          }
        >
          <option value="">{t("nodes:inspector.common.sourceAuto")}</option>
          {graph.nodes
            .filter((n) => n.id !== node.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name || n.id}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.translate.target")}</span>
        <input
          className="input"
          type="text"
          placeholder={t("nodes:inspector.translate.targetPh")}
          value={node.translate.target}
          onChange={(e) =>
            updateNode(node.id, {
              translate: { ...node.translate!, target: e.target.value },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.common.model")}</span>
        <select
          className="select"
          value={node.translate.model || "__unset__"}
          onChange={(e) => {
            if (e.target.value === "__unset__") return;
            updateNode(node.id, {
              translate: { ...node.translate!, model: e.target.value },
            });
          }}
        >
          <option value="__unset__" disabled hidden>
            {!node.translate.model
              ? t("nodes:inspector.common.modelUnsetDefault")
              : t("nodes:inspector.common.modelSelect")}
          </option>
          {textModelOptions.map((o) => (
            <option key={`${o.provider}::${o.model}`} value={o.model}>
              {o.model} · {o.provider}
            </option>
          ))}
          {!textModelOptions.some((o) => o.model === node.translate!.model) &&
            node.translate.model && (
              <option value={node.translate.model}>
                {node.translate.model}
                {t("nodes:inspector.common.modelCurrent")}
              </option>
            )}
        </select>
        <MissingModelHint
          hasModels={textModelOptions.length > 0}
          onOpenSettings={onOpenSettings}
        />
      </label>
      <label className="field">
        <span>
          {t("nodes:inspector.translate.temperature", {
            temp: node.translate.temperature.toFixed(2),
          })}
        </span>
        <input
          className="input"
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={node.translate.temperature}
          onChange={(e) =>
            updateNode(node.id, {
              translate: {
                ...node.translate!,
                temperature: Number(e.target.value),
              },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.translate.note")}</p>
    </>
  );
}
