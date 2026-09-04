import type { FieldsProps } from "./types";

export default function MapFields({ node, graph, updateNode, t }: FieldsProps) {
  if (!node.map) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.common.source")}</span>
        <select
          className="select"
          value={node.map.source ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              map: { ...node.map!, source: e.target.value || undefined },
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
        <span>{t("nodes:inspector.map.iterate")}</span>
        <input
          type="text"
          className="input mono"
          placeholder={t("nodes:inspector.map.iteratePh")}
          value={node.map.iterate ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              map: { ...node.map!, iterate: e.target.value || undefined },
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("nodes:inspector.map.template")}</span>
        <textarea
          className="textarea mono"
          rows={5}
          placeholder='{"标题": "${item.name}", "价格": "${item.price}"}'
          value={node.map.template ?? "{}"}
          onChange={(e) =>
            updateNode(node.id, {
              map: { ...node.map!, template: e.target.value },
            })
          }
        />
      </label>
      <p className="note">{t("nodes:inspector.map.note")}</p>
    </>
  );
}
