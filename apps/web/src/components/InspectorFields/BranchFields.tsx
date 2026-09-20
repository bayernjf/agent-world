import { deriveStateMachine } from "@agent-world/core";
import type { FieldsProps } from "./types";

export default function BranchFields({ node, graph, updateNode, t }: FieldsProps) {
  if (!node.branch) return null;
  // State-machine-as-variables: derive read-only state transitions from the
  // `${var.xxx} == 'state'` rules so the flow is visible while editing.
  const stateViews = deriveStateMachine(graph).filter((v) =>
    v.transitions.some((tr) => tr.branchNodeId === node.id),
  );
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
      {stateViews.map((view) => (
        <div
          className="field state-flow"
          data-testid={`state-flow-${view.variable}`}
          key={view.variable}
        >
          <span>{t("nodes:inspector.branch.stateFlowTitle")}</span>
          <div className="state-flow__head">
            <code className="mono state-flow__var">{`var.${view.variable}`}</code>
            <span
              className={
                view.hasDeclaration
                  ? "state-flow__initial"
                  : "state-flow__initial state-flow__initial--warn"
              }
            >
              {view.hasDeclaration
                ? t("nodes:inspector.branch.stateInitial", {
                    value: formatStateValue(view.initial),
                  })
                : t("nodes:inspector.branch.stateUndeclared")}
            </span>
          </div>
          {view.transitions
            .filter((tr) => tr.branchNodeId === node.id)
            .map((tr) => (
              <div className="state-flow__transition" key={tr.ruleId}>
                <span className="state-flow__chip">{formatStateValue(tr.value)}</span>
                <span className="state-flow__arrow" aria-hidden="true">
                  →
                </span>
                <span className="state-flow__target">{tr.targetName}</span>
              </div>
            ))}
          {node.branch!.defaultTarget && (
            <div className="state-flow__transition">
              <span className="state-flow__chip state-flow__chip--default">
                {t("nodes:inspector.branch.stateDefault")}
              </span>
              <span className="state-flow__arrow" aria-hidden="true">
                →
              </span>
              <span className="state-flow__target">
                {graph.nodes.find((n) => n.id === node.branch!.defaultTarget)?.name ??
                  node.branch!.defaultTarget}
              </span>
            </div>
          )}
        </div>
      ))}
      <p className="note">{t("nodes:inspector.branch.note")}</p>
    </>
  );
}

function formatStateValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  return String(v);
}
