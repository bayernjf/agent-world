import type { FieldsProps } from "./types";

export default function ConvertFields({
  node,
  graph,
  updateNode,
  t,
}: FieldsProps) {
  if (!node.convert) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.common.source")}</span>
        <select
          className="select"
          value={node.convert.source ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              convert: { ...node.convert!, source: e.target.value || undefined },
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
        <span>{t("nodes:inspector.convert.to")}</span>
        <select
          className="select"
          value={node.convert.to}
          onChange={(e) =>
            updateNode(node.id, {
              convert: {
                ...node.convert!,
                to: e.target.value as "image" | "png" | "jpeg",
              },
            })
          }
        >
          <option value="image">{t("nodes:inspector.convert.toImage")}</option>
          <option value="png">{t("nodes:inspector.convert.toPng")}</option>
          <option value="jpeg">{t("nodes:inspector.convert.toJpeg")}</option>
        </select>
      </label>
      {node.convert.to === "jpeg" && (
        <label className="field">
          <span>{t("nodes:inspector.convert.quality")}</span>
          <input
            className="input"
            type="number"
            min={1}
            max={100}
            value={node.convert.quality}
            onChange={(e) =>
              updateNode(node.id, {
                convert: {
                  ...node.convert!,
                  quality: Number(e.target.value) || 85,
                },
              })
            }
          />
        </label>
      )}
      <p className="note">{t("nodes:inspector.convert.note")}</p>
    </>
  );
}
