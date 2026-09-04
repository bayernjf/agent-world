import type { FieldsProps } from "./types";
import { MissingModelHint } from "./shared";

export default function TextGenFields({
  node,
  updateNode,
  beginEdit,
  commitEdit,
  t,
  onOpenSettings,
  textModelOptions,
}: FieldsProps) {
  if (!node.textGen) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.common.model")}</span>
        <select
          className="select"
          value={node.textGen.model || "__unset__"}
          onChange={(e) => {
            if (e.target.value === "__unset__") return;
            updateNode(node.id, {
              textGen: { ...node.textGen!, model: e.target.value },
            });
          }}
        >
          <option value="__unset__" disabled hidden>
            {!node.textGen.model
              ? t("nodes:inspector.common.modelUnset", {
                  modality: t("nodes:modality.text"),
                })
              : t("nodes:inspector.common.modelSelect")}
          </option>
          {textModelOptions.map((o) => (
            <option key={`${o.provider}::${o.model}`} value={o.model}>
              {o.model} · {o.provider}
            </option>
          ))}
          {!textModelOptions.some((o) => o.model === node.textGen!.model) &&
            node.textGen.model && (
              <option value={node.textGen.model}>
                {node.textGen.model}
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
          {t("nodes:inspector.textGen.temperature", {
            temp: node.textGen.temperature.toFixed(2),
          })}
        </span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={node.textGen.temperature}
          onChange={(e) =>
            updateNode(node.id, {
              textGen: {
                ...node.textGen!,
                temperature: Number(e.target.value),
              },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.textGen.budget")}</span>
        <input
          type="number"
          min="0"
          step="0.001"
          placeholder={t("nodes:inspector.textGen.budgetPh")}
          value={node.textGen.budgetUsd ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              textGen: {
                ...node.textGen!,
                budgetUsd:
                  e.target.value === "" ? null : Number(e.target.value),
              },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.textGen.inputPolicy")}</span>
        <select
          className="select"
          value={node.textGen.inputPolicy?.mode ?? "all"}
          onChange={(e) =>
            updateNode(node.id, {
              textGen: {
                ...node.textGen!,
                inputPolicy: {
                  ...(node.textGen!.inputPolicy ?? { mode: "all" as const }),
                  mode: e.target.value as
                    | "all"
                    | "last"
                    | "truncate"
                    | "summary",
                },
              },
            })
          }
        >
          <option value="all">
            {t("nodes:inspector.textGen.inputPolicyAll")}
          </option>
          <option value="last">
            {t("nodes:inspector.textGen.inputPolicyLast")}
          </option>
          <option value="truncate">
            {t("nodes:inspector.textGen.inputPolicyTruncate")}
          </option>
          <option value="summary">
            {t("nodes:inspector.textGen.inputPolicySummary")}
          </option>
        </select>
      </label>
      <p className="note">
        {(() => {
          switch (node.textGen.inputPolicy?.mode ?? "all") {
            case "all":
              return t("nodes:inspector.textGen.inputPolicyNoteAll");
            case "last":
              return t("nodes:inspector.textGen.inputPolicyNoteLast");
            case "truncate":
              return t("nodes:inspector.textGen.inputPolicyNoteTruncate");
            case "summary":
              return t("nodes:inspector.textGen.inputPolicyNoteSummary");
            default:
              return "";
          }
        })()}
      </p>
      {(node.textGen.inputPolicy?.mode === "truncate" ||
        node.textGen.inputPolicy?.mode === "summary") && (
        <label className="field">
          <span>{t("nodes:inspector.textGen.maxChars")}</span>
          <input
            type="number"
            min="500"
            step="500"
            value={node.textGen.inputPolicy?.maxChars ?? 8000}
            onChange={(e) =>
              updateNode(node.id, {
                textGen: {
                  ...node.textGen!,
                  inputPolicy: {
                    mode: node.textGen?.inputPolicy?.mode ?? "truncate",
                    maxChars: Number(e.target.value),
                  },
                },
              })
            }
          />
        </label>
      )}
      <label className="field">
        <span>{t("nodes:inspector.textGen.prompt")}</span>
        <textarea
          rows={4}
          value={node.textGen.prompt}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              textGen: { ...node.textGen!, prompt: e.target.value },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.textGen.imageDirectives")}</span>
        <textarea
          rows={3}
          placeholder={t("nodes:inspector.textGen.imageDirectivesPh")}
          value={node.textGen.imageDirectives ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              textGen: {
                ...node.textGen!,
                imageDirectives: e.target.value,
              },
            })
          }
        />
      </label>
    </>
  );
}
