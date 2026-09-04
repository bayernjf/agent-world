import type { FieldsProps } from "./types";

export default function GateFields({
  node,
  updateNode,
  beginEdit,
  commitEdit,
  t,
}: FieldsProps) {
  if (!node.gate) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.gate.criterion")}</span>
        <textarea
          rows={3}
          placeholder={t("nodes:inspector.gate.criterionPh")}
          value={node.gate.criterion}
          onFocus={beginEdit}
          onBlur={commitEdit}
          onChange={(e) =>
            updateNode(node.id, {
              gate: { ...node.gate!, criterion: e.target.value },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.gate.maxAttempts")}</span>
        <input
          type="number"
          min={1}
          max={10}
          value={node.gate.maxAttempts}
          onChange={(e) =>
            updateNode(node.id, {
              gate: { ...node.gate!, maxAttempts: Number(e.target.value) },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.gate.minScore")}</span>
        <input
          type="number"
          min={0}
          max={10}
          value={node.gate.minScore ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              gate: {
                ...node.gate!,
                minScore:
                  e.target.value === "" ? undefined : Number(e.target.value),
              },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.gate.minBrandCoverage")}</span>
        <input
          type="number"
          min={0}
          max={100}
          value={
            node.gate.minBrandCoverage != null
              ? Math.round(node.gate.minBrandCoverage * 100)
              : ""
          }
          onChange={(e) =>
            updateNode(node.id, {
              gate: {
                ...node.gate!,
                minBrandCoverage:
                  e.target.value === ""
                    ? undefined
                    : Number(e.target.value) / 100,
              },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.gate.onExhausted")}</span>
        <select
          value={node.gate.onExhausted}
          onChange={(e) =>
            updateNode(node.id, {
              gate: {
                ...node.gate!,
                onExhausted: e.target.value as "pass" | "scrap" | "halt",
              },
            })
          }
        >
          <option value="halt">{t("nodes:inspector.gate.onExhaustedHalt")}</option>
          <option value="scrap">{t("nodes:inspector.gate.onExhaustedScrap")}</option>
          <option value="pass">{t("nodes:inspector.gate.onExhaustedPass")}</option>
        </select>
      </label>
    </>
  );
}
