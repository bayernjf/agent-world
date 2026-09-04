import type { FieldsProps } from "./types";

export default function ParallelFields({ node, updateNode, t }: FieldsProps) {
  if (!node.parallel) return null;
  return (
    <>
      <label className="field">
        <input
          type="checkbox"
          className="checkbox"
          checked={node.parallel.asObject ?? false}
          onChange={(e) =>
            updateNode(node.id, {
              parallel: { ...node.parallel!, asObject: e.target.checked },
            })
          }
        />
        <span>{t("nodes:inspector.parallel.asObject")}</span>
      </label>
      <label className="field">
        <span>{t("nodes:inspector.parallel.pick")}</span>
        <input
          type="text"
          className="input mono"
          placeholder={t("nodes:inspector.parallel.pickPh")}
          value={node.parallel.pick ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              parallel: { ...node.parallel!, pick: e.target.value || undefined },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.parallel.note")}</p>
    </>
  );
}
