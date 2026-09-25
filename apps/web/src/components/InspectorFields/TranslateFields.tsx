import type { FieldsProps } from "./types";
import { MissingModelHint, ModelSelect, RetryField } from "./shared";
import { defaultModelFor } from "../../store/graph";

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
        <ModelSelect
          value={node.translate.model ?? ""}
          options={textModelOptions}
          modalityLabel={t("nodes:modality.text")}
          followTarget={defaultModelFor("textGen")?.model ?? null}
          t={t}
          onChange={(model) => updateNode(node.id, { translate: { ...node.translate!, model } })}
        />
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
      <RetryField
        value={node.translate!.retry?.maxRetries ?? 2}
        onChange={(maxRetries) =>
          updateNode(node.id, {
            translate: {
              ...node.translate!,
              retry: {
                ...(node.translate!.retry ?? {
                  maxRetries: 2,
                  baseDelayMs: 1000,
                  maxDelayMs: 30000,
                }),
                maxRetries,
              },
            },
          })
        }
        t={t}
      />
    </>
  );
}
