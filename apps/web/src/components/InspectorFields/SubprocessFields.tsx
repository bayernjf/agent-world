import type { FieldsProps } from "./types";

export default function SubprocessFields({
  node,
  updateNode,
  t,
  graphs,
}: FieldsProps) {
  if (!node.subprocess) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.subprocess.graphId")}</span>
        <select
          className="input"
          value={node.subprocess.graphId}
          onChange={(e) =>
            updateNode(node.id, {
              subprocess: { ...node.subprocess!, graphId: e.target.value },
            })
          }
        >
          {graphs.length === 0 && (
            <option value="">
              {t("nodes:inspector.subprocess.graphEmpty")}
            </option>
          )}
          {graphs.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.subprocess.maxDepth")}</span>
        <input
          className="input"
          type="number"
          min={1}
          max={10}
          value={node.subprocess.maxDepth}
          onChange={(e) =>
            updateNode(node.id, {
              subprocess: {
                ...node.subprocess!,
                maxDepth: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
              },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.subprocess.note")}</p>
    </>
  );
}
