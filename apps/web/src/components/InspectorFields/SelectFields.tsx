import type { SelectConfig } from "@agent-world/core";
import type { FieldsProps } from "./types";

export default function SelectFields({ node, updateNode, t }: FieldsProps) {
  if (!node.select) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.select.mode")}</span>
        <select
          value={node.select.mode}
          onChange={(e) =>
            updateNode(node.id, {
              select: { ...node.select!, mode: e.target.value as SelectConfig["mode"] },
            })
          }
        >
          <option value="llm_score">
            {t("nodes:inspector.select.modeLlmScore")}
          </option>
          <option value="rule">{t("nodes:inspector.select.modeRule")}</option>
          <option value="human">{t("nodes:inspector.select.modeHuman")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.select.topK")}</span>
        <input
          type="number"
          min={1}
          max={8}
          value={node.select.topK}
          onChange={(e) =>
            updateNode(node.id, {
              select: {
                ...node.select!,
                topK: Math.max(1, Number(e.target.value) || 1),
              },
            })
          }
        />
      </label>
      {node.select.mode === "llm_score" && (
        <>
          <label className="field">
            <span>{t("nodes:inspector.select.rubric")}</span>
            <textarea
              rows={2}
              value={node.select.rubric}
              onChange={(e) =>
                updateNode(node.id, {
                  select: { ...node.select!, rubric: e.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>{t("nodes:inspector.select.model")}</span>
            <input
              type="text"
              value={node.select.model ?? ""}
              onChange={(e) =>
                updateNode(node.id, {
                  select: { ...node.select!, model: e.target.value },
                })
              }
            />
          </label>
        </>
      )}
      {node.select.mode === "rule" && (
        <label className="field">
          <span>{t("nodes:inspector.select.ruleField")}</span>
          <select
            value={node.select.rule?.field ?? "length"}
            onChange={(e) =>
              updateNode(node.id, {
                select: {
                  ...node.select!,
                  rule: {
                    field: e.target.value as NonNullable<
                      SelectConfig["rule"]
                    >["field"],
                    desc: node.select!.rule?.desc ?? true,
                  },
                },
              })
            }
          >
            <option value="length">
              {t("nodes:inspector.select.ruleLength")}
            </option>
            <option value="brandCoverage">
              {t("nodes:inspector.select.ruleBrand")}
            </option>
            <option value="jsonPath">
              {t("nodes:inspector.select.ruleJsonPath")}
            </option>
          </select>
        </label>
      )}
      <div className="field__hint">{t("nodes:inspector.select.hint")}</div>
    </>
  );
}
