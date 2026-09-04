import type { FieldsProps } from "./types";

export default function FileParseFields({
  node,
  graph,
  updateNode,
  t,
}: FieldsProps) {
  if (!node.fileParse) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.common.source")}</span>
        <select
          className="select"
          value={node.fileParse.source ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              fileParse: {
                ...node.fileParse!,
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
        <span>{t("nodes:inspector.fileParse.maxImages")}</span>
        <input
          className="input"
          type="number"
          min={0}
          max={100}
          value={node.fileParse.maxImages}
          onChange={(e) =>
            updateNode(node.id, {
              fileParse: { ...node.fileParse!, maxImages: Number(e.target.value) },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.fileParse.note")}</p>
    </>
  );
}
