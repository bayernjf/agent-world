import type { ReactNode } from "react";
import type { TableStep } from "@agent-world/core";
import Tooltip from "../Tooltip";
import i18n from "../../i18n";

/* ------------------------------------------------------------------ */
/* Small pure helpers shared by the http / table field components.      */
/* ------------------------------------------------------------------ */

export function parsePairs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return out;
}

export function formatPairs(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

export function replaceAt<T>(arr: T[], i: number, v: T): T[] {
  const next = [...arr];
  next[i] = v;
  return next;
}

/* ------------------------------------------------------------------ */
/* Missing-model hint (model selects).                                  */
/* ------------------------------------------------------------------ */

/** 该模态没有任何可用模型时，提示并给出直达「设置」的入口。 */
export function MissingModelHint({
  hasModels,
  onOpenSettings,
}: {
  hasModels: boolean;
  onOpenSettings: () => void;
}) {
  if (hasModels) return null;
  return (
    <p className="field__hint">
      {i18n.t("nodes:inspector.missingModel")}
      <button type="button" className="link" onClick={onOpenSettings}>
        {i18n.t("nodes:inspector.goSettings")}
      </button>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* TableStepEditor (table node).                                        */
/* ------------------------------------------------------------------ */

const STEP_OP_LABELS: Record<TableStep["op"], string> = {
  parse: "nodes:inspector.stepOp.parse",
  filter: "nodes:inspector.stepOp.filter",
  sort: "nodes:inspector.stepOp.sort",
  aggregate: "nodes:inspector.stepOp.aggregate",
  output: "nodes:inspector.stepOp.output",
};

function stepField(label: string, children: ReactNode) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** 单步编辑：根据 op 渲染对应的参数字段。 */
export function TableStepEditor({
  step,
  index,
  onChange,
  onRemove,
}: {
  step: TableStep;
  index: number;
  onChange: (next: TableStep) => void;
  onRemove: () => void;
}) {
  return (
    <div className="table-step">
      <div className="table-step__head">
        <span className="table-step__index">#{index + 1}</span>
        <select
          className="select"
          value={step.op}
          onChange={(e) => {
            const op = e.target.value as TableStep["op"];
            if (op === "parse")
              onChange({
                op: "parse",
                format: "csv",
                hasHeader: true,
                delimiter: ",",
              });
            else if (op === "filter")
              onChange({ op: "filter", column: "", operator: "eq", value: "" });
            else if (op === "sort")
              onChange({ op: "sort", column: "", direction: "asc" });
            else if (op === "aggregate")
              onChange({
                op: "aggregate",
                aggs: [{ column: "", fn: "count" }],
              });
            else onChange({ op: "output", format: "json" });
          }}
        >
          {Object.entries(STEP_OP_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Tooltip content={i18n.t("nodes:inspector.deleteStep")}>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={onRemove}
          >
            ✕
          </button>
        </Tooltip>
      </div>

      {step.op === "parse" && (
        <>
          {stepField(
            i18n.t("nodes:inspector.format"),
            <select
              className="select"
              value={step.format}
              onChange={(e) =>
                onChange({ ...step, format: e.target.value as "csv" | "json" })
              }
            >
              <option value="csv">{i18n.t("nodes:inspector.csvText")}</option>
              <option value="json">{i18n.t("nodes:inspector.jsonArray")}</option>
            </select>,
          )}
          {step.format === "csv" && (
            <>
              {stepField(
                i18n.t("nodes:inspector.delimiter"),
                <input
                  type="text"
                  className="input mono"
                  value={step.delimiter}
                  maxLength={4}
                  onChange={(e) =>
                    onChange({ ...step, delimiter: e.target.value || "," })
                  }
                />,
              )}
              <label className="field">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={step.hasHeader}
                  onChange={(e) =>
                    onChange({ ...step, hasHeader: e.target.checked })
                  }
                />
                <span>{i18n.t("nodes:inspector.hasHeader")}</span>
              </label>
            </>
          )}
        </>
      )}

      {step.op === "filter" && (
        <>
          {stepField(
            i18n.t("nodes:inspector.column"),
            <input
              type="text"
              className="input mono"
              value={step.column}
              onChange={(e) => onChange({ ...step, column: e.target.value })}
            />,
          )}
          {stepField(
            i18n.t("nodes:inspector.operator"),
            <select
              className="select"
              value={step.operator}
              onChange={(e) =>
                onChange({
                  ...step,
                  operator: e.target.value as
                    "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains",
                })
              }
            >
              <option value="eq">{i18n.t("nodes:inspector.opEq")}</option>
              <option value="ne">{i18n.t("nodes:inspector.opNe")}</option>
              <option value="gt">{i18n.t("nodes:inspector.opGt")}</option>
              <option value="gte">{i18n.t("nodes:inspector.opGte")}</option>
              <option value="lt">{i18n.t("nodes:inspector.opLt")}</option>
              <option value="lte">{i18n.t("nodes:inspector.opLte")}</option>
              <option value="contains">{i18n.t("nodes:inspector.opContains")}</option>
            </select>,
          )}
          {stepField(
            i18n.t("nodes:inspector.value"),
            <input
              type="text"
              className="input mono"
              value={step.value}
              onChange={(e) => onChange({ ...step, value: e.target.value })}
            />,
          )}
        </>
      )}

      {step.op === "sort" && (
        <>
          {stepField(
            i18n.t("nodes:inspector.column"),
            <input
              type="text"
              className="input mono"
              value={step.column}
              onChange={(e) => onChange({ ...step, column: e.target.value })}
            />,
          )}
          {stepField(
            i18n.t("nodes:inspector.direction"),
            <select
              className="select"
              value={step.direction}
              onChange={(e) =>
                onChange({
                  ...step,
                  direction: e.target.value as "asc" | "desc",
                })
              }
            >
              <option value="asc">{i18n.t("nodes:inspector.asc")}</option>
              <option value="desc">{i18n.t("nodes:inspector.desc")}</option>
            </select>,
          )}
        </>
      )}

      {step.op === "aggregate" && (
        <>
          {stepField(
            i18n.t("nodes:inspector.groupBy"),
            <input
              type="text"
              className="input mono"
              value={step.groupBy ?? ""}
              onChange={(e) =>
                onChange({ ...step, groupBy: e.target.value || undefined })
              }
            />,
          )}
          {step.aggs.map((agg, i) => (
            <div key={i} className="table-step__agg">
              <input
                type="text"
                className="input mono"
                placeholder={i18n.t("nodes:inspector.columnPlaceholder")}
                value={agg.column}
                onChange={(e) =>
                  onChange({
                    ...step,
                    aggs: replaceAt(step.aggs, i, {
                      ...agg,
                      column: e.target.value,
                    }),
                  })
                }
              />
              <select
                className="select"
                value={agg.fn}
                onChange={(e) =>
                  onChange({
                    ...step,
                    aggs: replaceAt(step.aggs, i, {
                      ...agg,
                      fn: e.target.value as typeof agg.fn,
                    }),
                  })
                }
              >
                <option value="count">{i18n.t("nodes:inspector.aggCount")}</option>
                <option value="sum">{i18n.t("nodes:inspector.aggSum")}</option>
                <option value="avg">{i18n.t("nodes:inspector.aggAvg")}</option>
                <option value="min">{i18n.t("nodes:inspector.aggMin")}</option>
                <option value="max">{i18n.t("nodes:inspector.aggMax")}</option>
              </select>
              <input
                type="text"
                className="input mono"
                placeholder={i18n.t("nodes:inspector.outputColumn")}
                value={agg.as ?? ""}
                onChange={(e) =>
                  onChange({
                    ...step,
                    aggs: replaceAt(step.aggs, i, {
                      ...agg,
                      as: e.target.value || undefined,
                    }),
                  })
                }
              />
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() =>
                  onChange({
                    ...step,
                    aggs: step.aggs.filter((_, j) => j !== i),
                  })
                }
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--small"
            onClick={() =>
              onChange({
                ...step,
                aggs: [...step.aggs, { column: "", fn: "count" }],
              })
            }
          >
            {i18n.t("nodes:inspector.addAgg")}
          </button>
        </>
      )}

      {step.op === "output" && (
        <>
          {stepField(
            i18n.t("nodes:inspector.stepOp.output"),
            <select
              className="select"
              value={step.format}
              onChange={(e) =>
                onChange({ ...step, format: e.target.value as "json" | "csv" })
              }
            >
              <option value="json">
                {i18n.t("nodes:inspector.jsonObject")}
              </option>
              <option value="csv">{i18n.t("nodes:inspector.csvExtra")}</option>
            </select>,
          )}
        </>
      )}
    </div>
  );
}
