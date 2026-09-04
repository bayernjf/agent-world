import type { FieldsProps } from "./types";
import { TableStepEditor, replaceAt } from "./shared";

export default function TableFields({ node, graph, updateNode, t }: FieldsProps) {
  if (!node.table) return null;
  return (
    <>
      <label className="field">
        <span>{t("nodes:inspector.common.source")}</span>
        <select
          className="select"
          value={node.table.source ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              table: { ...node.table!, source: e.target.value || undefined },
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
      <div className="table-steps">
        <span className="table-steps__title">
          {t("nodes:inspector.table.stepsTitle")}
        </span>
        {(node.table.steps ?? []).map((step, i) => (
          <TableStepEditor
            key={i}
            index={i}
            step={step}
            onChange={(next) =>
              updateNode(node.id, {
                table: {
                  ...node.table!,
                  steps: replaceAt(node.table!.steps ?? [], i, next),
                },
              })
            }
            onRemove={() =>
              updateNode(node.id, {
                table: {
                  ...node.table!,
                  steps: (node.table!.steps ?? []).filter((_, j) => j !== i),
                },
              })
            }
          />
        ))}
        <button
          type="button"
          className="btn btn--small"
          onClick={() =>
            updateNode(node.id, {
              table: {
                ...node.table!,
                steps: [
                  ...(node.table!.steps ?? []),
                  {
                    op: "filter",
                    column: "",
                    operator: "eq",
                    value: "",
                  },
                ],
              },
            })
          }
        >
          {t("nodes:inspector.table.addStep")}
        </button>
      </div>
      <p className="note">{t("nodes:inspector.table.note")}</p>
    </>
  );
}
