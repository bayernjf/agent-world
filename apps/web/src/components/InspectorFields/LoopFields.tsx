import type { FieldsProps } from "./types";

export default function LoopFields({ node, updateNode, t }: FieldsProps) {
  if (!node.loop) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.loop.items")}</span>
        <input
          type="text"
          className="input mono"
          placeholder={t("nodes:inspector.loop.itemsPh")}
          value={node.loop.items ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              loop: { ...node.loop!, items: e.target.value || undefined },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.loop.maxIterations")}</span>
        <input
          type="number"
          min={1}
          max={1000}
          className="input"
          value={node.loop.maxIterations ?? 100}
          onChange={(e) =>
            updateNode(node.id, {
              loop: {
                ...node.loop!,
                maxIterations: Math.max(1, Number(e.target.value) || 1),
              },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.loop.note")}</p>
    </>
  );
}
