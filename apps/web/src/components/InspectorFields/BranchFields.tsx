import type { FieldsProps } from "./types";

export default function BranchFields({ node, graph, updateNode, t }: FieldsProps) {
  if (!node.branch) return null;
  return (
    <>
      <div className="field">
        <span>{t("nodes:inspector.branch.rulesTitle")}</span>
        {(node.branch.rules ?? []).map((rule) => (
          <div key={rule.id} className="branch-rule">
            <input
              type="text"
              className="branch-rule__when mono"
              placeholder='${"{"}api.score{"}"} > 5'
              value={rule.when}
              onChange={(e) =>
                updateNode(node.id, {
                  branch: {
                    ...node.branch!,
                    rules: (node.branch!.rules ?? []).map((r) =>
                      r.id === rule.id ? { ...r, when: e.target.value } : r,
                    ),
                  },
                })
              }
            />
            <select
              className="select branch-rule__target"
              value={rule.target}
              onChange={(e) =>
                updateNode(node.id, {
                  branch: {
                    ...node.branch!,
                    rules: (node.branch!.rules ?? []).map((r) =>
                      r.id === rule.id ? { ...r, target: e.target.value } : r,
                    ),
                  },
                })
              }
            >
              <option value="">{t("nodes:inspector.branch.selectTarget")}</option>
              {graph.nodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name || n.id}
                  </option>
                ))}
            </select>
            <button
              className="branch-rule__del"
              onClick={() =>
                updateNode(node.id, {
                  branch: {
                    ...node.branch!,
                    rules: (node.branch!.rules ?? []).filter(
                      (r) => r.id !== rule.id,
                    ),
                  },
                })
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn btn--ghost"
          onClick={() =>
            updateNode(node.id, {
              branch: {
                ...node.branch!,
                rules: [
                  ...(node.branch!.rules ?? []),
                  { id: `r${Date.now()}`, when: "true", target: "" },
                ],
              },
            })
          }
        >
          {t("nodes:inspector.branch.addRule")}
        </button>
      </div>
      <label className="field">
        <span>{t("nodes:inspector.branch.defaultTarget")}</span>
        <select
          className="select"
          value={node.branch.defaultTarget ?? ""}
          onChange={(e) =>
            updateNode(node.id, {
              branch: {
                ...node.branch!,
                defaultTarget: e.target.value || undefined,
              },
            })
          }
        >
          <option value="">{t("nodes:inspector.branch.dropMessage")}</option>
          {graph.nodes
            .filter((n) => n.id !== node.id)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name || n.id}
              </option>
            ))}
        </select>
      </label>
      <p className="note">{t("nodes:inspector.branch.note")}</p>
    </>
  );
}
