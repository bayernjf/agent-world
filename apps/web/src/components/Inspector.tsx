import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  UNIT_LABELS,
  parseProductDocument,
  type Artifact,
  type AudioGenConfig,
  type Graph,
  type HttpNodeConfig,
  type TableStep,
  type VideoGenConfig,
} from "@agent-world/core";
import { ArtifactCard, renderMarkdown } from "../lib/artifact-renderers";
import { api, type AppConfig, type Modality } from "../lib/api";
import { useGraph } from "../store/graph";
import { useVisibleRuntime } from "../store/run";
import SkillPicker from "./SkillPicker";
import FinishedProduct from "./FinishedProduct";
import ProductBlocks from "./ProductBlocks";
import SourceImages from "./SourceImages";
import SourceFiles from "./SourceFiles";
import ConnectorEditor from "./ConnectorEditor";
import Tooltip from "./Tooltip";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";

function formatUnits(units: Record<string, number> | undefined): string | null {
  if (!units) return null;
  const parts = Object.entries(units)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v}${UNIT_LABELS[k] ?? k}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rs = Math.round(s % 60);
    return `${m}m ${rs}s`;
  }
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h ${rm}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function parsePairs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return out;
}

function formatPairs(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** 该模态没有任何可用模型时，提示并给出直达「设置」的入口。 */
function MissingModelHint({
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

function replaceAt<T>(arr: T[], i: number, v: T): T[] {
  const next = [...arr];
  next[i] = v;
  return next;
}

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
function TableStepEditor({
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

/** Cheap line-level diff — enough to see what a rework attempt actually changed. */
function diffLines(a: string, b: string) {
  const left = a.split(/(?<=\s)/);
  const right = b.split(/(?<=\s)/);
  const out: { text: string; kind: "same" | "add" | "del" }[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      out.push({ text: left[i]!, kind: "same" });
      i++;
      j++;
    } else if (j < right.length && !left.includes(right[j]!, i)) {
      out.push({ text: right[j]!, kind: "add" });
      j++;
    } else if (i < left.length) {
      out.push({ text: left[i]!, kind: "del" });
      i++;
    } else {
      out.push({ text: right[j]!, kind: "add" });
      j++;
    }
  }
  return out;
}

const ERROR_LABEL: Record<string, string> = {
  TIMEOUT: "nodes:inspector.errorLabel.TIMEOUT",
  RATE_LIMIT: "nodes:inspector.errorLabel.RATE_LIMIT",
  PROVIDER_ERROR: "nodes:inspector.errorLabel.PROVIDER_ERROR",
  SCRIPT_ERROR: "nodes:inspector.errorLabel.SCRIPT_ERROR",
  AUTH: "nodes:inspector.errorLabel.AUTH",
  VALIDATION: "nodes:inspector.errorLabel.VALIDATION",
  BUDGET: "nodes:inspector.errorLabel.BUDGET",
  UNKNOWN: "nodes:inspector.errorLabel.UNKNOWN",
  UNSUPPORTED: "nodes:inspector.errorLabel.UNSUPPORTED",
  SUBPROCESS: "nodes:inspector.errorLabel.SUBPROCESS",
};

/** 富渲染节点文本产出：含 product-json 走结构化成品，否则走 Markdown。 */
function renderNodeOutput(text: string): React.ReactNode {
  const doc = parseProductDocument(text);
  if (doc) return <ProductBlocks doc={doc} />;
  // parse 失败：常因模型在 product-json 的字段里写了未转义引号，导致 JSON 非法。
  // 兜底策略——把整段围栏剥掉再渲染 Markdown，避免把半成品源码裸露给用户。
  if (/```product-json/i.test(text)) {
    const cleaned = text.replace(/```product-json[\s\S]*?```/gi, "").trim();
    if (cleaned)
      return <div className="artifact-md">{renderMarkdown(cleaned)}</div>;
    return (
      <div className="artifact-md muted">
        {i18n.t("nodes:inspector.structuredParseFailed")}
      </div>
    );
  }
  return <div className="artifact-md">{renderMarkdown(text)}</div>;
}

/** 过滤掉"内容本身就是 product-json 围栏"的中间产物，避免与富成品重复展示。 */
function isProductJsonSource(a: Artifact): boolean {
  return (
    (a.kind === "text" || a.kind === "json") &&
    !!a.content?.includes("```product-json")
  );
}

type MainTab = "output" | "config" | "skills";
const MAIN_TAB_ORDER: MainTab[] = ["output", "config", "skills"];
const MAIN_TAB_STORE = "agent-world.inspector.mainTab";

function readStoredMainTab(): MainTab {
  try {
    const v = localStorage.getItem(MAIN_TAB_STORE);
    return v === "output" || v === "config" || v === "skills" ? v : "output";
  } catch {
    return "output";
  }
}

/** The 技能 tab only exists on agent nodes, so a remembered tab can be invalid. */
function clampMainTab(tab: MainTab, isTextGen: boolean): MainTab {
  return tab === "skills" && !isTextGen ? "output" : tab;
}

function nextMainTab(current: MainTab, isTextGen: boolean): MainTab {
  const order = MAIN_TAB_ORDER.filter((t) => t !== "skills" || isTextGen);
  const i = order.indexOf(current);
  return order[(i + 1) % order.length]!;
}

export default function Inspector({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const { graph, selectedId, updateNode, saveState, reloadGraph } = useGraph();
  const runtime = useVisibleRuntime();
  // Saved graphs for the subprocess node's graph picker (refresh on mount).
  const [graphs, setGraphs] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    void api
      .listGraphs()
      .then((g) => setGraphs(g.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => undefined);
  }, []);
  const [tab, setTab] = useState<number | "diff">(1);
  const [mainTab, setMainTabState] = useState<MainTab>(readStoredMainTab);
  const setMainTab = (t: MainTab) => {
    setMainTabState(t);
    try {
      localStorage.setItem(MAIN_TAB_STORE, t);
    } catch {
      /* storage unavailable (private mode) — the tab still works for this session */
    }
  };

  // Brief glow after E cycles the tabs, so the hidden shortcut is noticeable.
  const [tabFlash, setTabFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerTabFlash = () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setTabFlash(true);
    flashTimer.current = setTimeout(() => setTabFlash(false), 700);
  };
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const [showReasoning, setShowReasoning] = useState(false);
  const [settings, setSettings] = useState<AppConfig | null>(null);

  // Group a free-text edit (name, prompt, criterion, image URL) into a single
  // undo entry: pause tracking on focus, then on blur append the pre-edit graph
  // as one history entry. Without this every keystroke would be undoable.
  const editStartRef = useRef<Graph | null>(null);
  const beginEdit = () => {
    editStartRef.current = graph;
    useGraph.temporal.getState().pause();
  };
  const commitEdit = () => {
    const temporal = useGraph.temporal.getState();
    const start = editStartRef.current;
    temporal.resume();
    if (start && start !== graph) {
      const setTemporal = useGraph.temporal as unknown as {
        setState: (
          fn: (st: { pastStates: unknown[]; futureStates: unknown[] }) => {
            pastStates: unknown[];
            futureStates: unknown[];
          },
        ) => void;
      };
      setTemporal.setState((st) => ({
        pastStates: [...st.pastStates, { graph: start }],
        futureStates: [],
      }));
    }
    editStartRef.current = null;
  };

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);
  // Moving between nodes keeps the tab the user last used; only fall back when
  // that tab does not exist on the newly selected node kind.
  useEffect(() => {
    const isTextGen =
      graph.nodes.find((n) => n.id === selectedId)?.kind === "textGen";
    setMainTabState((cur) => clampMainTab(cur, !!isTextGen));
  }, [selectedId, graph]);

  // E cycles 产出 → 配置 → 技能, alongside the existing single-key canvas bindings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !selectedId) return;
      if (e.key !== "e" && e.key !== "E") return;
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      )
        return;
      e.preventDefault();
      const isTextGen =
        graph.nodes.find((n) => n.id === selectedId)?.kind === "textGen";
      setMainTab(nextMainTab(mainTab, !!isTextGen));
      triggerTabFlash();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mainTab, selectedId, graph, triggerTabFlash]);
  // Each node kind only drives one modality, so its model select must
  // only show models matching that modality. Empty list -> the select
  // renders an "未配置" placeholder nudging the user to Settings, and
  // dispatch remains the hard gatekeeper (it errors before sending).
  const allModelOptions = settings
    ? Object.entries(settings.providers)
        .filter(([, pp]) => pp.enabled !== false)
        .flatMap(([pname, pp]) =>
          pp.models.map((m) => ({
            model: m,
            provider: pname,
            modality: (pp.modalities?.[m] ?? "text") as Modality,
          })),
        )
        .filter((o) => o.provider !== "fake")
    : [];

  const videoModelOptions = allModelOptions.filter(
    (o) => o.modality === "video",
  );
  const audioModelOptions = allModelOptions.filter(
    (o) => o.modality === "audio",
  );
  const textModelOptions = allModelOptions.filter((o) => o.modality === "text");
  const imageModelOptions = allModelOptions.filter(
    (o) => o.modality === "image",
  );

  const node = graph.nodes.find((n) => n.id === selectedId);
  if (!node) {
    return (
      <aside className="panel inspector">
        <div className="panel__bar">
          <span>{t("nodes:inspector.nodeDetail")}</span>
        </div>
        <p className="empty">{t("nodes:inspector.selectNode")}</p>
      </aside>
    );
  }

  const rt = runtime.nodes[node.id];
  const attempts = Object.keys(rt?.outputs ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  const showDiff = tab === "diff" && attempts.length >= 2;
  const activeAttempt = typeof tab === "number" ? tab : attempts.at(-1)!;

  const prev = attempts.at(-2);
  const last = attempts.at(-1);
  const reasoning =
    rt && activeAttempt ? rt.reasoning?.[activeAttempt] : undefined;
  const artifacts = rt?.artifacts ?? [];
  const saveIndicator =
    saveState === "saving"
      ? t("nodes:inspector.saving")
      : saveState === "saved"
        ? t("nodes:inspector.saved")
        : saveState === "error"
          ? t("nodes:inspector.saveFailed")
          : "";

  return (
    <aside className="panel inspector">
      <div className="panel__bar">
        <span>{node.name}</span>
        <span className="muted">{node.kind}</span>
        {rt?.lastVerdict?.score != null && (
          <span
            className={`chip chip--score chip--score-${rt.lastVerdict.score >= 7 ? "good" : rt.lastVerdict.score >= 4 ? "warn" : "bad"}`}
            title={t("nodes:inspector.qualityScore", {
              score: rt.lastVerdict.score,
              reason: rt.lastVerdict.reason,
            })}
          >
            {t("nodes:inspector.quality", { score: rt.lastVerdict.score })}
          </span>
        )}
      </div>

      <div className={`inspector__tabs${tabFlash ? " is-flash" : ""}`}>
        <button
          type="button"
          className={`tab ${mainTab === "output" ? "is-on" : ""}`}
          onClick={() => setMainTab("output")}
        >
          {t("nodes:inspector.tabOutput")}
        </button>
        <button
          type="button"
          className={`tab ${mainTab === "config" ? "is-on" : ""}`}
          onClick={() => setMainTab("config")}
        >
          {t("nodes:inspector.tabConfig")}
        </button>
        {node.kind === "textGen" && (
          <button
            type="button"
            className={`tab ${mainTab === "skills" ? "is-on" : ""}`}
            onClick={() => setMainTab("skills")}
          >
            {t("nodes:inspector.tabSkills")}
          </button>
        )}
        <span
          className="inspector__tab-hint"

          aria-label={t("nodes:inspector.tabSkillsAria")}
        >
          <kbd className="kbd-inline">E</kbd>
        </span>
      </div>

      <div className="inspector__body">
        {mainTab === "config" && (
          <>
            {saveState === "conflict" && (
              <div className="conflict-banner" role="alert">
                <span>{t("nodes:inspector.conflict")}</span>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => void reloadGraph()}
                >
                  {t("nodes:inspector.reload")}
                </button>
              </div>
            )}
            <label className="field">
              <span>
                {t("nodes:inspector.name")}{" "}
                {saveIndicator && (
                  <em className="save-state">{saveIndicator}</em>
                )}
              </span>
              <input
                value={node.name}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) => updateNode(node.id, { name: e.target.value })}
              />
            </label>

            {node.kind === "source" && (
              <SourceImages
                nodeId={node.id}
                images={node.source?.images ?? []}
                onBeginEdit={beginEdit}
                onCommitEdit={commitEdit}
              />
            )}

            {node.kind === "source" && (
              <SourceFiles
                nodeId={node.id}
                files={node.source?.files ?? []}
                onBeginEdit={beginEdit}
                onCommitEdit={commitEdit}
              />
            )}

            {node.kind === "source" && (
              <>
                <div className="source-brief">
                  <div className="source-brief__head label">
                    {t("nodes:inspector.source.briefTitle")}
                  </div>
                  <label className="field">
                    <span>{t("nodes:inspector.source.productName")}</span>
                    <input
                      value={node.source?.productName ?? ""}
                      placeholder={t("nodes:inspector.source.productName")}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          source: {
                            ...(node.source ?? {}),
                            productName: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.source.brand")}</span>
                    <input
                      value={node.source?.brand ?? ""}
                      placeholder={t("nodes:inspector.source.brand")}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          source: {
                            ...(node.source ?? {}),
                            brand: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.source.audience")}</span>
                    <input
                      value={node.source?.audience ?? ""}
                      placeholder={t("nodes:inspector.source.audience")}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          source: {
                            ...(node.source ?? {}),
                            audience: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.source.priceRange")}</span>
                    <input
                      value={node.source?.priceRange ?? ""}
                      placeholder={t("nodes:inspector.source.priceRange")}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          source: {
                            ...(node.source ?? {}),
                            priceRange: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.source.tone")}</span>
                    <input
                      value={node.source?.tone ?? ""}
                      placeholder={t("nodes:inspector.source.tone")}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          source: {
                            ...(node.source ?? {}),
                            tone: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.source.prohibited")}</span>
                    <textarea
                      rows={2}
                      value={node.source?.prohibited ?? ""}
                      placeholder={t("nodes:inspector.source.prohibitedPh")}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          source: {
                            ...(node.source ?? {}),
                            prohibited: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.source.brandTerms")}</span>
                    <textarea
                      rows={2}
                      value={node.source?.brandTerms ?? ""}
                      placeholder={t("nodes:inspector.source.brandTermsPh")}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          source: {
                            ...(node.source ?? {}),
                            brandTerms: e.target.value,
                          },
                        })
                      }
                    />
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={async () => {
                        const terms = await api.listBrandTerms();
                        const cur = (node.source?.brandTerms ?? "")
                          .split(/[\n,，、;；\s]+/)
                          .map((s) => s.trim())
                          .filter(Boolean);
                        const merged = [
                          ...new Set([...cur, ...terms.map((t) => t.term)]),
                        ].join("、");
                        updateNode(node.id, {
                          source: {
                            ...(node.source ?? {}),
                            brandTerms: merged,
                          },
                        });
                      }}
                    >
                      {t("nodes:inspector.source.loadBrandTerms")}
                    </button>
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.source.notes")}</span>
                    <textarea
                      rows={3}
                      value={node.source?.notes ?? ""}
                      placeholder={t("nodes:inspector.source.notesPh")}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          source: {
                            ...(node.source ?? {}),
                            notes: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                </div>

                <ConnectorEditor
                  connector={node.source?.connector}
                  onChange={(c) =>
                    updateNode(node.id, {
                      source: { ...(node.source ?? {}), connector: c },
                    })
                  }
                  onBeginEdit={beginEdit}
                  onCommitEdit={commitEdit}
                />
              </>
            )}

            {node.kind === "textGen" && node.textGen && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.common.model")}</span>
                  <select
                    className="select"
                    value={node.textGen.model || "__unset__"}
                    onChange={(e) => {
                      if (e.target.value === "__unset__") return;
                      updateNode(node.id, {
                        textGen: { ...node.textGen!, model: e.target.value },
                      });
                    }}
                  >
                    <option value="__unset__" disabled hidden>
                      {!node.textGen.model
                        ? t("nodes:inspector.common.modelUnset", {
                            modality: t("nodes:modality.text"),
                          })
                        : t("nodes:inspector.common.modelSelect")}
                    </option>
                    {textModelOptions.map((o) => (
                      <option key={`${o.provider}::${o.model}`} value={o.model}>
                        {o.model} · {o.provider}
                      </option>
                    ))}
                    {!textModelOptions.some(
                      (o) => o.model === node.textGen!.model,
                    ) &&
                      node.textGen.model && (
                        <option value={node.textGen.model}>
                          {node.textGen.model}
                          {t("nodes:inspector.common.modelCurrent")}
                        </option>
                      )}
                  </select>
                  <MissingModelHint
                    hasModels={textModelOptions.length > 0}
                    onOpenSettings={onOpenSettings}
                  />
                </label>
                <label className="field">
                  <span>
                    {t("nodes:inspector.textGen.temperature", {
                      temp: node.textGen.temperature.toFixed(2),
                    })}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={node.textGen.temperature}
                    onChange={(e) =>
                      updateNode(node.id, {
                        textGen: {
                          ...node.textGen!,
                          temperature: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.textGen.budget")}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder={t("nodes:inspector.textGen.budgetPh")}
                    value={node.textGen.budgetUsd ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        textGen: {
                          ...node.textGen!,
                          budgetUsd:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.textGen.inputPolicy")}</span>
                  <select
                    className="select"
                    value={node.textGen.inputPolicy?.mode ?? "all"}
                    onChange={(e) =>
                      updateNode(node.id, {
                        textGen: {
                          ...node.textGen!,
                          inputPolicy: {
                            ...(node.textGen!.inputPolicy ?? {
                              mode: "all" as const,
                            }),
                            mode: e.target.value as
                              "all" | "last" | "truncate" | "summary",
                          },
                        },
                      })
                    }
                  >
                    <option value="all">
                      {t("nodes:inspector.textGen.inputPolicyAll")}
                    </option>
                    <option value="last">
                      {t("nodes:inspector.textGen.inputPolicyLast")}
                    </option>
                    <option value="truncate">
                      {t("nodes:inspector.textGen.inputPolicyTruncate")}
                    </option>
                    <option value="summary">
                      {t("nodes:inspector.textGen.inputPolicySummary")}
                    </option>
                  </select>
                </label>
                <p className="note">
                  {(() => {
                    switch (node.textGen.inputPolicy?.mode ?? "all") {
                      case "all":
                        return t("nodes:inspector.textGen.inputPolicyNoteAll");
                      case "last":
                        return t("nodes:inspector.textGen.inputPolicyNoteLast");
                      case "truncate":
                        return t(
                          "nodes:inspector.textGen.inputPolicyNoteTruncate",
                        );
                      case "summary":
                        return t(
                          "nodes:inspector.textGen.inputPolicyNoteSummary",
                        );
                      default:
                        return "";
                    }
                  })()}
                </p>
                {(node.textGen.inputPolicy?.mode === "truncate" ||
                  node.textGen.inputPolicy?.mode === "summary") && (
                  <label className="field">
                    <span>{t("nodes:inspector.textGen.maxChars")}</span>
                    <input
                      type="number"
                      min="500"
                      step="500"
                      value={node.textGen.inputPolicy?.maxChars ?? 8000}
                      onChange={(e) =>
                        updateNode(node.id, {
                          textGen: {
                            ...node.textGen!,
                            inputPolicy: {
                              mode:
                                node.textGen?.inputPolicy?.mode ?? "truncate",
                              maxChars: Number(e.target.value),
                            },
                          },
                        })
                      }
                    />
                  </label>
                )}
                <label className="field">
                  <span>{t("nodes:inspector.textGen.prompt")}</span>
                  <textarea
                    rows={4}
                    value={node.textGen.prompt}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        textGen: { ...node.textGen!, prompt: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.textGen.imageDirectives")}</span>
                  <textarea
                    rows={3}
                    placeholder={t("nodes:inspector.textGen.imageDirectivesPh")}
                    value={node.textGen.imageDirectives ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        textGen: {
                          ...node.textGen!,
                          imageDirectives: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                {/* 技能卡已移至「技能」标签页 */}
              </>
            )}

            {node.kind === "imageGen" && node.imageGen && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.imageGen.model")}</span>
                  <select
                    className="select"
                    value={node.imageGen.model || "__unset__"}
                    onChange={(e) => {
                      if (e.target.value === "__unset__") return;
                      updateNode(node.id, {
                        imageGen: { ...node.imageGen!, model: e.target.value },
                      });
                    }}
                  >
                    <option value="__unset__" disabled hidden>
                      {!node.imageGen.model
                        ? t("nodes:inspector.common.modelUnset", {
                            modality: t("nodes:modality.image"),
                          })
                        : t("nodes:inspector.common.modelSelect")}
                    </option>
                    {imageModelOptions.map((o) => (
                      <option key={`${o.provider}::${o.model}`} value={o.model}>
                        {o.model} · {o.provider}
                      </option>
                    ))}
                    {!imageModelOptions.some(
                      (o) => o.model === node.imageGen!.model,
                    ) &&
                      node.imageGen.model && (
                        <option value={node.imageGen.model}>
                          {node.imageGen.model}
                          {t("nodes:inspector.common.modelCurrent")}
                        </option>
                      )}
                  </select>
                  <MissingModelHint
                    hasModels={imageModelOptions.length > 0}
                    onOpenSettings={onOpenSettings}
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.imageGen.size")}</span>
                  <input
                    type="text"
                    placeholder={t("nodes:inspector.imageGen.sizePh")}
                    value={node.imageGen.size ?? ""}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        imageGen: {
                          ...node.imageGen!,
                          size: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.imageGen.prompt")}</span>
                  <textarea
                    rows={4}
                    placeholder={t("nodes:inspector.imageGen.promptPh")}
                    value={node.imageGen.prompt ?? ""}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        imageGen: { ...node.imageGen!, prompt: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.imageGen.count")}</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={node.imageGen.n ?? 1}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        imageGen: {
                          ...node.imageGen!,
                          n: Math.min(
                            8,
                            Math.max(1, Number(e.target.value) || 1),
                          ),
                        },
                      })
                    }
                  />
                </label>
                <details className="adv">
                  <summary>{t("nodes:inspector.common.customEndpoint")}</summary>
                  <label className="field">
                    <span>{t("nodes:inspector.imageGen.baseUrl")}</span>
                    <input
                      type="text"
                      placeholder="https://your-sd-server/v1"
                      value={node.imageGen.baseUrl ?? ""}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          imageGen: {
                            ...node.imageGen!,
                            baseUrl: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.common.apiKeyOptional")}</span>
                    <input
                      type="password"
                      placeholder="sk-..."
                      value={node.imageGen.apiKey ?? ""}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          imageGen: {
                            ...node.imageGen!,
                            apiKey: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                </details>
              </>
            )}

            {node.kind === "videoGen" && node.videoGen && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.videoGen.model")}</span>
                  <select
                    className="select"
                    value={node.videoGen.model || "__unset__"}
                    onChange={(e) => {
                      if (e.target.value === "__unset__") return;
                      updateNode(node.id, {
                        videoGen: { ...node.videoGen!, model: e.target.value },
                      });
                    }}
                  >
                    <option value="__unset__" disabled hidden>
                      {!node.videoGen.model
                        ? t("nodes:inspector.common.modelUnset", {
                            modality: t("nodes:modality.video"),
                          })
                        : t("nodes:inspector.common.modelSelect")}
                    </option>
                    {videoModelOptions.map((o) => (
                      <option key={`${o.provider}::${o.model}`} value={o.model}>
                        {o.model} · {o.provider}
                      </option>
                    ))}
                    {!videoModelOptions.some(
                      (o) => o.model === node.videoGen!.model,
                    ) &&
                      node.videoGen.model && (
                        <option value={node.videoGen.model}>
                          {node.videoGen.model}
                          {t("nodes:inspector.common.modelCurrent")}
                        </option>
                      )}
                  </select>
                  <MissingModelHint
                    hasModels={videoModelOptions.length > 0}
                    onOpenSettings={onOpenSettings}
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.videoGen.prompt")}</span>
                  <textarea
                    rows={4}
                    placeholder={t("nodes:inspector.videoGen.promptPh")}
                    value={node.videoGen.prompt ?? ""}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        videoGen: { ...node.videoGen!, prompt: e.target.value },
                      })
                    }
                  />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>{t("nodes:inspector.videoGen.duration")}</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      placeholder={t("nodes:inspector.videoGen.durationPh")}
                      value={node.videoGen.duration ?? ""}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          videoGen: {
                            ...node.videoGen!,
                            duration: e.target.value
                              ? Math.min(
                                  60,
                                  Math.max(1, Number(e.target.value)),
                                )
                              : undefined,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.videoGen.aspect")}</span>
                    <select
                      className="select"
                      value={node.videoGen.aspect ?? ""}
                      onChange={(e) =>
                        updateNode(node.id, {
                          videoGen: {
                            ...node.videoGen!,
                            aspect: (e.target.value ||
                              undefined) as VideoGenConfig["aspect"],
                          },
                        })
                      }
                    >
                      <option value="">
                        {t("nodes:inspector.videoGen.aspectDefault")}
                      </option>
                      <option value="16:9">
                        {t("nodes:inspector.videoGen.aspect169")}
                      </option>
                      <option value="9:16">
                        {t("nodes:inspector.videoGen.aspect916")}
                      </option>
                      <option value="1:1">
                        {t("nodes:inspector.videoGen.aspect11")}
                      </option>
                      <option value="4:3">4:3</option>
                      <option value="3:4">3:4</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>{t("nodes:inspector.videoGen.count")}</span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={node.videoGen.n ?? 1}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        videoGen: {
                          ...node.videoGen!,
                          n: Math.min(
                            4,
                            Math.max(1, Number(e.target.value) || 1),
                          ),
                        },
                      })
                    }
                  />
                </label>
                <details className="adv">
                  <summary>{t("nodes:inspector.common.customEndpoint")}</summary>
                  <label className="field">
                    <span>{t("nodes:inspector.videoGen.baseUrl")}</span>
                    <input
                      type="text"
                      placeholder="https://your-video-server/v1"
                      value={node.videoGen.baseUrl ?? ""}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          videoGen: {
                            ...node.videoGen!,
                            baseUrl: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.common.apiKey")}</span>
                    <input
                      type="password"
                      placeholder="sk-..."
                      value={node.videoGen.apiKey ?? ""}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          videoGen: {
                            ...node.videoGen!,
                            apiKey: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                </details>
              </>
            )}

            {node.kind === "audioGen" && node.audioGen && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.audioGen.model")}</span>
                  <select
                    className="select"
                    value={node.audioGen.model || "__unset__"}
                    onChange={(e) => {
                      if (e.target.value === "__unset__") return;
                      updateNode(node.id, {
                        audioGen: { ...node.audioGen!, model: e.target.value },
                      });
                    }}
                  >
                    <option value="__unset__" disabled hidden>
                      {!node.audioGen.model
                        ? t("nodes:inspector.common.modelUnset", {
                            modality: t("nodes:modality.audio"),
                          })
                        : t("nodes:inspector.common.modelSelect")}
                    </option>
                    {audioModelOptions.map((o) => (
                      <option key={`${o.provider}::${o.model}`} value={o.model}>
                        {o.model} · {o.provider}
                      </option>
                    ))}
                    {!audioModelOptions.some(
                      (o) => o.model === node.audioGen!.model,
                    ) &&
                      node.audioGen.model && (
                        <option value={node.audioGen.model}>
                          {node.audioGen.model}
                          {t("nodes:inspector.common.modelCurrent")}
                        </option>
                      )}
                  </select>
                  <MissingModelHint
                    hasModels={audioModelOptions.length > 0}
                    onOpenSettings={onOpenSettings}
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.audioGen.prompt")}</span>
                  <textarea
                    rows={4}
                    placeholder={t("nodes:inspector.audioGen.promptPh")}
                    value={node.audioGen.prompt ?? ""}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        audioGen: { ...node.audioGen!, prompt: e.target.value },
                      })
                    }
                  />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>{t("nodes:inspector.audioGen.voice")}</span>
                    <input
                      type="text"
                      placeholder={t("nodes:inspector.audioGen.voicePh")}
                      value={node.audioGen.voice ?? ""}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          audioGen: {
                            ...node.audioGen!,
                            voice: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.audioGen.format")}</span>
                    <select
                      className="select"
                      value={node.audioGen.format ?? "mp3"}
                      onChange={(e) =>
                        updateNode(node.id, {
                          audioGen: {
                            ...node.audioGen!,
                            format: e.target.value as AudioGenConfig["format"],
                          },
                        })
                      }
                    >
                      <option value="mp3">mp3</option>
                      <option value="wav">wav</option>
                      <option value="opus">opus</option>
                      <option value="aac">aac</option>
                      <option value="flac">flac</option>
                    </select>
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>{t("nodes:inspector.audioGen.speed")}</span>
                    <input
                      type="number"
                      min={0.25}
                      max={4}
                      step={0.25}
                      placeholder={t("nodes:inspector.audioGen.speedPh")}
                      value={node.audioGen.speed ?? ""}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          audioGen: {
                            ...node.audioGen!,
                            speed: e.target.value
                              ? Math.min(
                                  4,
                                  Math.max(0.25, Number(e.target.value)),
                                )
                              : undefined,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.audioGen.count")}</span>
                    <input
                      type="number"
                      min={1}
                      max={4}
                      value={node.audioGen.n ?? 1}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          audioGen: {
                            ...node.audioGen!,
                            n: Math.min(
                              4,
                              Math.max(1, Number(e.target.value) || 1),
                            ),
                          },
                        })
                      }
                    />
                  </label>
                </div>
                <details className="adv">
                  <summary>{t("nodes:inspector.common.customEndpoint")}</summary>
                  <label className="field">
                    <span>{t("nodes:inspector.audioGen.baseUrl")}</span>
                    <input
                      type="text"
                      placeholder="https://your-audio-server/v1"
                      value={node.audioGen.baseUrl ?? ""}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          audioGen: {
                            ...node.audioGen!,
                            baseUrl: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("nodes:inspector.common.apiKey")}</span>
                    <input
                      type="password"
                      placeholder="sk-..."
                      value={node.audioGen.apiKey ?? ""}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          audioGen: {
                            ...node.audioGen!,
                            apiKey: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                </details>
              </>
            )}

            {node.kind === "gate" && node.gate && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.gate.criterion")}</span>
                  <textarea
                    rows={3}
                    placeholder={t("nodes:inspector.gate.criterionPh")}
                    value={node.gate.criterion}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        gate: { ...node.gate!, criterion: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.gate.maxAttempts")}</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={node.gate.maxAttempts}
                    onChange={(e) =>
                      updateNode(node.id, {
                        gate: {
                          ...node.gate!,
                          maxAttempts: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.gate.minScore")}</span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={node.gate.minScore ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        gate: {
                          ...node.gate!,
                          minScore:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.gate.minBrandCoverage")}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={
                      node.gate.minBrandCoverage != null
                        ? Math.round(node.gate.minBrandCoverage * 100)
                        : ""
                    }
                    onChange={(e) =>
                      updateNode(node.id, {
                        gate: {
                          ...node.gate!,
                          minBrandCoverage:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value) / 100,
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.gate.onExhausted")}</span>
                  <select
                    value={node.gate.onExhausted}
                    onChange={(e) =>
                      updateNode(node.id, {
                        gate: {
                          ...node.gate!,
                          onExhausted: e.target.value as
                            "pass" | "scrap" | "halt",
                        },
                      })
                    }
                  >
                    <option value="halt">
                      {t("nodes:inspector.gate.onExhaustedHalt")}
                    </option>
                    <option value="scrap">
                      {t("nodes:inspector.gate.onExhaustedScrap")}
                    </option>
                    <option value="pass">
                      {t("nodes:inspector.gate.onExhaustedPass")}
                    </option>
                  </select>
                </label>
              </>
            )}

            {node.kind === "compliance" && node.compliance && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.compliance.platform")}</span>
                  <select
                    value={node.compliance.platform}
                    onChange={(e) =>
                      updateNode(node.id, {
                        compliance: {
                          ...node.compliance!,
                          platform: e.target.value as
                            | "taobao"
                            | "xiaohongshu"
                            | "douyin"
                            | "wechat"
                            | "custom",
                        },
                      })
                    }
                  >
                    <option value="taobao">
                      {t("nodes:inspector.compliance.platformTaobao")}
                    </option>
                    <option value="xiaohongshu">
                      {t("nodes:inspector.compliance.platformXiaohongshu")}
                    </option>
                    <option value="douyin">
                      {t("nodes:inspector.compliance.platformDouyin")}
                    </option>
                    <option value="wechat">
                      {t("nodes:inspector.compliance.platformWechat")}
                    </option>
                    <option value="custom">
                      {t("nodes:inspector.compliance.platformCustom")}
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.compliance.extraBanned")}</span>
                  <textarea
                    rows={2}
                    placeholder={t("nodes:inspector.compliance.extraBannedPh")}
                    value={node.compliance.extraBanned}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        compliance: { ...node.compliance!, extraBanned: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="field field--row">
                  <span>{t("nodes:inspector.compliance.autoFix")}</span>
                  <input
                    type="checkbox"
                    checked={node.compliance.autoFix}
                    onChange={(e) =>
                      updateNode(node.id, {
                        compliance: { ...node.compliance!, autoFix: e.target.checked },
                      })
                    }
                  />
                </label>
                <label className="field field--row">
                  <span>{t("nodes:inspector.compliance.failOnViolation")}</span>
                  <input
                    type="checkbox"
                    checked={node.compliance.failOnViolation}
                    onChange={(e) =>
                      updateNode(node.id, {
                        compliance: { ...node.compliance!, failOnViolation: e.target.checked },
                      })
                    }
                  />
                </label>
                <div className="field__hint">
                  {t("nodes:inspector.compliance.hint")}
                </div>
              </>
            )}

            {node.kind === "publish" && node.publish && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.publish.platform")}</span>
                  <select
                    value={node.publish.platform}
                    onChange={(e) =>
                      updateNode(node.id, {
                        publish: {
                          ...node.publish!,
                          platform: e.target.value as
                            | "taobao"
                            | "xiaohongshu"
                            | "douyin"
                            | "wechat"
                            | "custom",
                        },
                      })
                    }
                  >
                    <option value="taobao">{t("nodes:inspector.compliance.platformTaobao")}</option>
                    <option value="xiaohongshu">
                      {t("nodes:inspector.compliance.platformXiaohongshu")}
                    </option>
                    <option value="douyin">{t("nodes:inspector.compliance.platformDouyin")}</option>
                    <option value="wechat">{t("nodes:inspector.compliance.platformWechat")}</option>
                    <option value="custom">{t("nodes:inspector.compliance.platformCustom")}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.publish.title")}</span>
                  <input
                    value={node.publish.title ?? ""}
                    placeholder={t("nodes:inspector.publish.titlePh")}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        publish: { ...node.publish!, title: e.target.value },
                      })
                    }
                  />
                </label>
                <div className="field__hint">{t("nodes:inspector.publish.hint")}</div>
              </>
            )}

            {node.kind === "http" && node.http && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.http.method")}</span>
                  <select
                    className="select"
                    value={node.http.method}
                    onChange={(e) =>
                      updateNode(node.id, {
                        http: {
                          ...node.http!,
                          method: e.target.value as HttpNodeConfig["method"],
                        },
                      })
                    }
                  >
                    {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.http.url")}</span>
                  <input
                    type="text"
                    placeholder={t("nodes:inspector.http.urlPh")}
                    value={node.http.url}
                    onChange={(e) =>
                      updateNode(node.id, {
                        http: { ...node.http!, url: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.http.query")}</span>
                  <textarea
                    rows={3}
                    placeholder="page: 1&#10;limit: 10"
                    value={formatPairs(node.http.query ?? {})}
                    onChange={(e) =>
                      updateNode(node.id, {
                        http: {
                          ...node.http!,
                          query: parsePairs(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.http.headers")}</span>
                  <textarea
                    rows={3}
                    placeholder="Authorization: Bearer xxx"
                    value={formatPairs(node.http.headers ?? {})}
                    onChange={(e) =>
                      updateNode(node.id, {
                        http: {
                          ...node.http!,
                          headers: parsePairs(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.http.body")}</span>
                  <textarea
                    rows={4}
                    placeholder='{"foo": "${source}"}'
                    value={node.http.body ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        http: { ...node.http!, body: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.common.timeoutMs")}</span>
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    value={node.http.timeoutMs}
                    onChange={(e) =>
                      updateNode(node.id, {
                        http: {
                          ...node.http!,
                          timeoutMs: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.http.outputMode")}</span>
                  <select
                    className="select"
                    value={node.http.outputMode}
                    onChange={(e) =>
                      updateNode(node.id, {
                        http: {
                          ...node.http!,
                          outputMode: e.target
                            .value as HttpNodeConfig["outputMode"],
                        },
                      })
                    }
                  >
                    <option value="auto">
                      {t("nodes:inspector.http.outputModeAuto")}
                    </option>
                    <option value="json">
                      {t("nodes:inspector.http.outputModeJson")}
                    </option>
                    <option value="text">
                      {t("nodes:inspector.http.outputModeText")}
                    </option>
                    <option value="file">
                      {t("nodes:inspector.http.outputModeFile")}
                    </option>
                  </select>
                </label>
                <label className="field field--row">
                  <input
                    type="checkbox"
                    checked={node.http.failOnError}
                    onChange={(e) =>
                      updateNode(node.id, {
                        http: { ...node.http!, failOnError: e.target.checked },
                      })
                    }
                  />
                  <span>{t("nodes:inspector.http.failOnError")}</span>
                </label>
                <p className="note">{t("nodes:inspector.http.note")}</p>
              </>
            )}

            {node.kind === "code" && node.code && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.code.language")}</span>
                  <select
                    className="select"
                    value={node.code.language}
                    onChange={(e) =>
                      updateNode(node.id, {
                        code: {
                          ...node.code!,
                          language: e.target.value as "javascript" | "python",
                        },
                      })
                    }
                  >
                    <option value="javascript">
                      {t("nodes:inspector.code.languageJs")}
                    </option>
                    <option value="python">
                      {t("nodes:inspector.code.languagePy")}
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.code.script")}</span>
                  <textarea
                    className="mono"
                    rows={9}
                    placeholder={
                      'const fs = require("fs");\nconst input = JSON.parse(fs.readFileSync(0, "utf8"));\n// 上游数据在 input.inputs.<上游节点id>\nconsole.log(JSON.stringify({ doubled: Number(input.inputs.source) * 2 }));'
                    }
                    value={node.code.code}
                    onChange={(e) =>
                      updateNode(node.id, {
                        code: { ...node.code!, code: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.common.timeoutMs")}</span>
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    value={node.code.timeoutMs}
                    onChange={(e) =>
                      updateNode(node.id, {
                        code: {
                          ...node.code!,
                          timeoutMs: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <p className="note">{t("nodes:inspector.code.note")}</p>
              </>
            )}

            {node.kind === "branch" && node.branch && (
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
                                r.id === rule.id
                                  ? { ...r, when: e.target.value }
                                  : r,
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
                                r.id === rule.id
                                  ? { ...r, target: e.target.value }
                                  : r,
                              ),
                            },
                          })
                        }
                      >
                        <option value="">
                          {t("nodes:inspector.branch.selectTarget")}
                        </option>
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
                    <option value="">
                      {t("nodes:inspector.branch.dropMessage")}
                    </option>
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
            )}

            {node.kind === "map" && node.map && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.common.source")}</span>
                  <select
                    className="select"
                    value={node.map.source ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        map: {
                          ...node.map!,
                          source: e.target.value || undefined,
                        },
                      })
                    }
                  >
                    <option value="">
                      {t("nodes:inspector.common.sourceAuto")}
                    </option>
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
                        map: {
                          ...node.map!,
                          iterate: e.target.value || undefined,
                        },
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
            )}

            {node.kind === "loop" && node.loop && (
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
                        loop: {
                          ...node.loop!,
                          items: e.target.value || undefined,
                        },
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
                          maxIterations: Math.max(
                            1,
                            Number(e.target.value) || 1,
                          ),
                        },
                      })
                    }
                  />
                </label>
                <p className="note">{t("nodes:inspector.loop.note")}</p>
              </>
            )}

            {node.kind === "parallel" && node.parallel && (
              <>
                <label className="field">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={node.parallel.asObject ?? false}
                    onChange={(e) =>
                      updateNode(node.id, {
                        parallel: {
                          ...node.parallel!,
                          asObject: e.target.checked,
                        },
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
                        parallel: {
                          ...node.parallel!,
                          pick: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </label>
                <p className="note">{t("nodes:inspector.parallel.note")}</p>
              </>
            )}

            {node.kind === "table" && node.table && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.common.source")}</span>
                  <select
                    className="select"
                    value={node.table.source ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        table: {
                          ...node.table!,
                          source: e.target.value || undefined,
                        },
                      })
                    }
                  >
                    <option value="">
                      {t("nodes:inspector.common.sourceAuto")}
                    </option>
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
                            steps: (node.table!.steps ?? []).filter(
                              (_, j) => j !== i,
                            ),
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
            )}

            {node.kind === "database" && node.database && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.database.path")}</span>
                  <input
                    className="input mono"
                    placeholder={t("nodes:inspector.database.pathPh")}
                    value={node.database.path ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        database: {
                          ...node.database!,
                          path: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.database.setupSql")}</span>
                  <textarea
                    className="textarea mono"
                    rows={4}
                    placeholder={
                      "CREATE TABLE people (name TEXT, age INTEGER);\nINSERT INTO people VALUES ('Alice', 30);"
                    }
                    value={node.database.setupSql ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        database: {
                          ...node.database!,
                          setupSql: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.database.sql")}</span>
                  <textarea
                    className="textarea mono"
                    rows={5}
                    placeholder="SELECT * FROM people WHERE age >= ?"
                    value={node.database.sql ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        database: { ...node.database!, sql: e.target.value },
                      })
                    }
                  />
                </label>
                <p className="note">{t("nodes:inspector.database.note")}</p>
              </>
            )}

            {node.kind === "fileParse" && node.fileParse && (
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
                    <option value="">
                      {t("nodes:inspector.common.sourceAuto")}
                    </option>
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
                        fileParse: {
                          ...node.fileParse!,
                          maxImages: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <p className="note">{t("nodes:inspector.fileParse.note")}</p>
              </>
            )}

            {node.kind === "translate" && node.translate && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.common.source")}</span>
                  <select
                    className="select"
                    value={node.translate.source ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        translate: {
                          ...node.translate!,
                          source: e.target.value || undefined,
                        },
                      })
                    }
                  >
                    <option value="">
                      {t("nodes:inspector.common.sourceAuto")}
                    </option>
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
                  <span>{t("nodes:inspector.translate.target")}</span>
                  <input
                    className="input"
                    type="text"
                    placeholder={t("nodes:inspector.translate.targetPh")}
                    value={node.translate.target}
                    onChange={(e) =>
                      updateNode(node.id, {
                        translate: {
                          ...node.translate!,
                          target: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.common.model")}</span>
                  <select
                    className="select"
                    value={node.translate.model || "__unset__"}
                    onChange={(e) => {
                      if (e.target.value === "__unset__") return;
                      updateNode(node.id, {
                        translate: {
                          ...node.translate!,
                          model: e.target.value,
                        },
                      });
                    }}
                  >
                    <option value="__unset__" disabled hidden>
                      {!node.translate.model
                        ? t("nodes:inspector.common.modelUnsetDefault")
                        : t("nodes:inspector.common.modelSelect")}
                    </option>
                    {textModelOptions.map((o) => (
                      <option key={`${o.provider}::${o.model}`} value={o.model}>
                        {o.model} · {o.provider}
                      </option>
                    ))}
                    {!textModelOptions.some(
                      (o) => o.model === node.translate!.model,
                    ) &&
                      node.translate.model && (
                        <option value={node.translate.model}>
                          {node.translate.model}
                          {t("nodes:inspector.common.modelCurrent")}
                        </option>
                      )}
                  </select>
                  <MissingModelHint
                    hasModels={textModelOptions.length > 0}
                    onOpenSettings={onOpenSettings}
                  />
                </label>
                <label className="field">
                  <span>
                    {t("nodes:inspector.translate.temperature", {
                      temp: node.translate.temperature.toFixed(2),
                    })}
                  </span>
                  <input
                    className="input"
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={node.translate.temperature}
                    onChange={(e) =>
                      updateNode(node.id, {
                        translate: {
                          ...node.translate!,
                          temperature: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <p className="note">{t("nodes:inspector.translate.note")}</p>
              </>
            )}

            {node.kind === "ocr" && node.ocr && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.common.source")}</span>
                  <select
                    className="select"
                    value={node.ocr.source ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        ocr: {
                          ...node.ocr!,
                          source: e.target.value || undefined,
                        },
                      })
                    }
                  >
                    <option value="">
                      {t("nodes:inspector.common.sourceAuto")}
                    </option>
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
                  <span>{t("nodes:inspector.ocr.lang")}</span>
                  <select
                    className="select"
                    value={node.ocr.lang}
                    onChange={(e) =>
                      updateNode(node.id, {
                        ocr: { ...node.ocr!, lang: e.target.value },
                      })
                    }
                  >
                    <option value="eng">{t("nodes:inspector.ocr.langEng")}</option>
                    <option value="chi_sim">
                      {t("nodes:inspector.ocr.langChiSim")}
                    </option>
                    <option value="chi_tra">
                      {t("nodes:inspector.ocr.langChiTra")}
                    </option>
                    <option value="jpn">{t("nodes:inspector.ocr.langJpn")}</option>
                    <option value="kor">{t("nodes:inspector.ocr.langKor")}</option>
                    <option value="spa">{t("nodes:inspector.ocr.langSpa")}</option>
                    <option value="fra">{t("nodes:inspector.ocr.langFra")}</option>
                    <option value="deu">{t("nodes:inspector.ocr.langDeu")}</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.ocr.langPath")}</span>
                  <input
                    className="input"
                    type="text"
                    placeholder={t("nodes:inspector.ocr.langPathPh")}
                    value={node.ocr.langPath ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        ocr: {
                          ...node.ocr!,
                          langPath: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </label>
                <p className="note">{t("nodes:inspector.ocr.note")}</p>
              </>
            )}

            {node.kind === "convert" && node.convert && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.common.source")}</span>
                  <select
                    className="select"
                    value={node.convert.source ?? ""}
                    onChange={(e) =>
                      updateNode(node.id, {
                        convert: {
                          ...node.convert!,
                          source: e.target.value || undefined,
                        },
                      })
                    }
                  >
                    <option value="">
                      {t("nodes:inspector.common.sourceAuto")}
                    </option>
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
                    <option value="image">
                      {t("nodes:inspector.convert.toImage")}
                    </option>
                    <option value="png">{t("nodes:inspector.convert.toPng")}</option>
                    <option value="jpeg">
                      {t("nodes:inspector.convert.toJpeg")}
                    </option>
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
            )}

            {node.kind === "search" && node.search && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.search.query")}</span>
                  <input
                    className="input"
                    type="text"
                    placeholder={t("nodes:inspector.search.queryPh")}
                    value={node.search.query}
                    onChange={(e) =>
                      updateNode(node.id, {
                        search: { ...node.search!, query: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.search.provider")}</span>
                  <select
                    className="select"
                    value={node.search.provider}
                    onChange={(e) =>
                      updateNode(node.id, {
                        search: {
                          ...node.search!,
                          provider: e.target.value as
                            "duckduckgo" | "tavily" | "serpapi" | "google",
                        },
                      })
                    }
                  >
                    <option value="duckduckgo">
                      {t("nodes:inspector.search.providerDdg")}
                    </option>
                    <option value="tavily">Tavily</option>
                    <option value="serpapi">SerpAPI</option>
                    <option value="google">Google CSE</option>
                  </select>
                </label>
                {node.search.provider !== "duckduckgo" && (
                  <>
                    <label className="field">
                      <span>{t("nodes:inspector.search.apiKey")}</span>
                      <input
                        type="password"
                        placeholder={t("nodes:inspector.search.apiKeyPh")}
                        value={node.search.apiKey ?? ""}
                        onFocus={beginEdit}
                        onBlur={commitEdit}
                        onChange={(e) =>
                          updateNode(node.id, {
                            search: {
                              ...node.search!,
                              apiKey: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </label>
                    {node.search.provider === "google" && (
                      <label className="field">
                        <span>{t("nodes:inspector.search.cx")}</span>
                        <input
                          className="input"
                          type="text"
                          placeholder="e.g. a1b2c3d4e5"
                          value={node.search.cx ?? ""}
                          onFocus={beginEdit}
                          onBlur={commitEdit}
                          onChange={(e) =>
                            updateNode(node.id, {
                              search: {
                                ...node.search!,
                                cx: e.target.value || undefined,
                              },
                            })
                          }
                        />
                      </label>
                    )}
                  </>
                )}
                <label className="field">
                  <span>{t("nodes:inspector.search.maxResults")}</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={20}
                    value={node.search.maxResults}
                    onChange={(e) =>
                      updateNode(node.id, {
                        search: {
                          ...node.search!,
                          maxResults: Number(e.target.value) || 5,
                        },
                      })
                    }
                  />
                </label>
                <p className="note">{t("nodes:inspector.search.note")}</p>
              </>
            )}

            {node.kind === "notify" && node.notify && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.notify.provider")}</span>
                  <select
                    className="select"
                    value={node.notify.provider}
                    onChange={(e) =>
                      updateNode(node.id, {
                        notify: {
                          ...node.notify!,
                          provider: e.target.value as
                            "feishu" | "dingtalk" | "wecom" | "email",
                        },
                      })
                    }
                  >
                    <option value="feishu">
                      {t("nodes:inspector.notify.providerFeishu")}
                    </option>
                    <option value="dingtalk">
                      {t("nodes:inspector.notify.providerDingtalk")}
                    </option>
                    <option value="wecom">
                      {t("nodes:inspector.notify.providerWecom")}
                    </option>
                    <option value="slack">
                      {t("nodes:inspector.notify.providerSlack")}
                    </option>
                    <option value="email">
                      {t("nodes:inspector.notify.providerEmail")}
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.notify.format")}</span>
                  <select
                    className="select"
                    value={node.notify.format}
                    onChange={(e) =>
                      updateNode(node.id, {
                        notify: {
                          ...node.notify!,
                          format: e.target.value as "text" | "markdown",
                        },
                      })
                    }
                  >
                    <option value="text">
                      {t("nodes:inspector.notify.formatText")}
                    </option>
                    <option value="markdown">
                      {t("nodes:inspector.notify.formatMarkdown")}
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.notify.message")}</span>
                  <textarea
                    rows={3}
                    placeholder={t("nodes:inspector.notify.messagePh")}
                    value={node.notify.message}
                    onChange={(e) =>
                      updateNode(node.id, {
                        notify: { ...node.notify!, message: e.target.value },
                      })
                    }
                  />
                </label>
                {node.notify.provider !== "email" && (
                  <label className="field">
                    <span>{t("nodes:inspector.notify.webhookUrl")}</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…"
                      value={node.notify.webhookUrl ?? ""}
                      onChange={(e) =>
                        updateNode(node.id, {
                          notify: {
                            ...node.notify!,
                            webhookUrl: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                )}
                {node.notify.provider === "dingtalk" && (
                  <label className="field">
                    <span>{t("nodes:inspector.notify.secret")}</span>
                    <input
                      className="input"
                      type="text"
                      placeholder={t("nodes:inspector.notify.secretPh")}
                      value={node.notify.secret ?? ""}
                      onChange={(e) =>
                        updateNode(node.id, {
                          notify: {
                            ...node.notify!,
                            secret: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                )}
                {node.notify.provider === "slack" && (
                  <label className="field">
                    <span>{t("nodes:inspector.notify.channel")}</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="C…（Slack channel id）"
                      value={node.notify.channel ?? ""}
                      onChange={(e) =>
                        updateNode(node.id, {
                          notify: {
                            ...node.notify!,
                            channel: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                )}
                {node.notify.provider === "email" && (
                  <>
                    <label className="field">
                      <span>{t("nodes:inspector.notify.to")}</span>
                      <input
                        className="input"
                        type="text"
                        placeholder="someone@example.com"
                        value={node.notify.to ?? ""}
                        onChange={(e) =>
                          updateNode(node.id, {
                            notify: {
                              ...node.notify!,
                              to: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>{t("nodes:inspector.notify.subject")}</span>
                      <input
                        className="input"
                        type="text"
                        placeholder={t("nodes:inspector.notify.subjectPh")}
                        value={node.notify.subject ?? ""}
                        onChange={(e) =>
                          updateNode(node.id, {
                            notify: {
                              ...node.notify!,
                              subject: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </label>
                  </>
                )}
                <p className="note">{t("nodes:inspector.notify.note")}</p>
              </>
            )}

            {node.kind === "vcs" && node.vcs && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.vcs.provider")}</span>
                  <select
                    className="select"
                    value={node.vcs.provider}
                    onChange={(e) =>
                      updateNode(node.id, {
                        vcs: {
                          ...node.vcs!,
                          provider: e.target.value as "github" | "gitlab",
                        },
                      })
                    }
                  >
                    <option value="github">
                      {t("nodes:inspector.vcs.providerGithub")}
                    </option>
                    <option value="gitlab">
                      {t("nodes:inspector.vcs.providerGitlab")}
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.vcs.action")}</span>
                  <select
                    className="select"
                    value={node.vcs.action}
                    onChange={(e) =>
                      updateNode(node.id, {
                        vcs: {
                          ...node.vcs!,
                          action: e.target.value as
                            | "create_pr"
                            | "comment_issue"
                            | "trigger_workflow"
                            | "list_issues",
                        },
                      })
                    }
                  >
                    <option value="create_pr">
                      {t("nodes:inspector.vcs.actionCreatePr")}
                    </option>
                    <option value="comment_issue">
                      {t("nodes:inspector.vcs.actionCommentIssue")}
                    </option>
                    <option value="trigger_workflow">
                      {t("nodes:inspector.vcs.actionTriggerWorkflow")}
                    </option>
                    <option value="list_issues">
                      {t("nodes:inspector.vcs.actionListIssues")}
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span>{t("nodes:inspector.vcs.token")}</span>
                  <input
                    type="password"
                    placeholder="ghp_... / glpat-..."
                    value={node.vcs.token ?? ""}
                    onFocus={beginEdit}
                    onBlur={commitEdit}
                    onChange={(e) =>
                      updateNode(node.id, {
                        vcs: {
                          ...node.vcs!,
                          token: e.target.value || undefined,
                        },
                      })
                    }
                  />
                </label>
                {node.vcs.provider === "gitlab" && (
                  <label className="field">
                    <span>{t("nodes:inspector.vcs.baseUrl")}</span>
                    <input
                      className="input"
                      type="text"
                      placeholder="https://git.corp.example/api/v4"
                      value={node.vcs.baseUrl ?? ""}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) =>
                        updateNode(node.id, {
                          vcs: {
                            ...node.vcs!,
                            baseUrl: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                )}
                {node.vcs.provider === "github" ? (
                  <div className="field-row">
                    <label className="field">
                      <span>Owner</span>
                      <input
                        className="input"
                        type="text"
                        value={node.vcs.owner ?? ""}
                        onChange={(e) =>
                          updateNode(node.id, {
                            vcs: {
                              ...node.vcs!,
                              owner: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Repo</span>
                      <input
                        className="input"
                        type="text"
                        value={node.vcs.repo ?? ""}
                        onChange={(e) =>
                          updateNode(node.id, {
                            vcs: {
                              ...node.vcs!,
                              repo: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <label className="field">
                    <span>{t("nodes:inspector.vcs.projectId")}</span>
                    <input
                      className="input"
                      type="text"
                      placeholder={t("nodes:inspector.vcs.projectIdPh")}
                      value={node.vcs.projectId ?? ""}
                      onChange={(e) =>
                        updateNode(node.id, {
                          vcs: {
                            ...node.vcs!,
                            projectId: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                )}
                {(node.vcs.action === "create_pr" ||
                  node.vcs.action === "comment_issue") && (
                  <label className="field">
                    <span>
                      {node.vcs.action === "create_pr"
                        ? t("nodes:inspector.vcs.prTitle")
                        : t("nodes:inspector.vcs.commentBody")}
                    </span>
                    <input
                      className="input"
                      type="text"
                      value={
                        node.vcs.action === "create_pr"
                          ? (node.vcs!.title ?? "")
                          : (node.vcs!.body ?? "")
                      }
                      onChange={(e) =>
                        updateNode(node.id, {
                          vcs: {
                            ...node.vcs!,
                            ...(node.vcs!.action === "create_pr"
                              ? { title: e.target.value }
                              : { body: e.target.value }),
                          },
                        })
                      }
                    />
                  </label>
                )}
                {node.vcs.action === "create_pr" && (
                  <div className="field-row">
                    <label className="field">
                      <span>{t("nodes:inspector.vcs.head")}</span>
                      <input
                        className="input"
                        type="text"
                        value={node.vcs.head ?? ""}
                        onChange={(e) =>
                          updateNode(node.id, {
                            vcs: {
                              ...node.vcs!,
                              head: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>{t("nodes:inspector.vcs.base")}</span>
                      <input
                        className="input"
                        type="text"
                        value={node.vcs.base ?? ""}
                        onChange={(e) =>
                          updateNode(node.id, {
                            vcs: {
                              ...node.vcs!,
                              base: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                )}
                {node.vcs.action === "comment_issue" && (
                  <label className="field">
                    <span>{t("nodes:inspector.vcs.number")}</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={node.vcs.number ?? ""}
                      onChange={(e) =>
                        updateNode(node.id, {
                          vcs: {
                            ...node.vcs!,
                            number: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          },
                        })
                      }
                    />
                  </label>
                )}
                {node.vcs.action === "trigger_workflow" && (
                  <div className="field-row">
                    {node.vcs.provider === "github" && (
                      <label className="field">
                        <span>{t("nodes:inspector.vcs.workflowId")}</span>
                        <input
                          className="input"
                          type="text"
                          value={node.vcs.workflowId ?? ""}
                          onChange={(e) =>
                            updateNode(node.id, {
                              vcs: {
                                ...node.vcs!,
                                workflowId: e.target.value || undefined,
                              },
                            })
                          }
                        />
                      </label>
                    )}
                    <label className="field">
                      <span>{t("nodes:inspector.vcs.ref")}</span>
                      <input
                        className="input"
                        type="text"
                        value={node.vcs.ref ?? ""}
                        onChange={(e) =>
                          updateNode(node.id, {
                            vcs: {
                              ...node.vcs!,
                              ref: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                )}
                {node.vcs.action === "list_issues" && (
                  <label className="field">
                    <span>{t("nodes:inspector.vcs.state")}</span>
                    <select
                      className="select"
                      value={node.vcs.state ?? "open"}
                      onChange={(e) =>
                        updateNode(node.id, {
                          vcs: {
                            ...node.vcs!,
                            state: e.target.value as "open" | "closed" | "all",
                          },
                        })
                      }
                    >
                      <option value="open">open</option>
                      <option value="closed">closed</option>
                      <option value="all">all</option>
                    </select>
                  </label>
                )}
                <p className="note">{t("nodes:inspector.vcs.note")}</p>
              </>
            )}

            {node.kind === "human" && node.human && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.human.prompt")}</span>
                  <input
                    className="input"
                    type="text"
                    value={node.human.prompt}
                    placeholder={t("nodes:inspector.human.promptPh")}
                    onChange={(e) =>
                      updateNode(node.id, {
                        human: { ...node.human!, prompt: e.target.value },
                      })
                    }
                  />
                </label>
                <p className="note">{t("nodes:inspector.human.note")}</p>
              </>
            )}

            {node.kind === "subprocess" && node.subprocess && (
              <>
                <label className="field">
                  <span>{t("nodes:inspector.subprocess.graphId")}</span>
                  <select
                    className="input"
                    value={node.subprocess.graphId}
                    onChange={(e) =>
                      updateNode(node.id, {
                        subprocess: {
                          ...node.subprocess!,
                          graphId: e.target.value,
                        },
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
                          maxDepth: Math.max(
                            1,
                            Math.min(10, Number(e.target.value) || 1),
                          ),
                        },
                      })
                    }
                  />
                </label>
                <p className="note">{t("nodes:inspector.subprocess.note")}</p>
              </>
            )}
          </>
        )}
        {mainTab === "output" && (
          <>
            {rt?.error && (
              <section className="error-box">
                <h3 className="label">
                  {rt.errorCode
                    ? ERROR_LABEL[rt.errorCode]
                      ? t(ERROR_LABEL[rt.errorCode]!)
                      : t("nodes:inspector.errorLabel.UNKNOWN")
                    : t("nodes:inspector.errorLabel.UNKNOWN")}
                </h3>
                <p className="error-msg">{rt.error}</p>
                {rt.errorCode && (
                  <code className="error-code">{rt.errorCode}</code>
                )}
              </section>
            )}

            {rt && (
              <section className="usage">
                <h3 className="label">{t("nodes:inspector.thisRun")}</h3>
                <dl>
                  <div>
                    <dt>{t("nodes:inspector.runStatus")}</dt>
                    <dd>{rt.status}</dd>
                  </div>
                  <div>
                    <dt>{t("nodes:inspector.runAttempt")}</dt>
                    <dd>{rt.attempt}</dd>
                  </div>
                  {rt.startedAt && (
                    <div>
                      <dt>{t("nodes:inspector.runDuration")}</dt>
                      <dd>
                        {formatDuration(
                          (rt.finishedAt ?? Date.now()) - rt.startedAt,
                        )}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>token</dt>
                    <dd>
                      {rt.tokensIn} / {rt.tokensOut}
                      {rt.cachedTokens > 0 && (
                        <em className="muted"> (cache {rt.cachedTokens})</em>
                      )}
                    </dd>
                  </div>
                  {formatUnits(rt.units) && (
                    <div>
                      <dt>{t("nodes:inspector.runUsage")}</dt>
                      <dd>{formatUnits(rt.units)}</dd>
                    </div>
                  )}
                  {rt.costUsd > 0 && (
                    <div>
                      <dt>{t("nodes:inspector.runCost")}</dt>
                      <dd>${rt.costUsd.toFixed(5)}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}

            {node.kind === "sink" && attempts.length > 0 && (
              <FinishedProduct
                sinkId={node.id}
                graph={graph}
                runtime={runtime}
              />
            )}

            {node.kind !== "sink" && attempts.length > 0 && (
              <section className="attempts">
                <h3 className="label">{t("nodes:inspector.tabOutput")}</h3>
                <div className="tabs">
                  {attempts.map((a) => (
                    <button
                      key={a}
                      className={`chip ${tab === a ? "is-on" : ""}`}
                      onClick={() => setTab(a)}
                    >
                      {t("nodes:inspector.attempt", { n: a })}
                    </button>
                  ))}
                  {attempts.length >= 2 && (
                    <button
                      className={`chip ${tab === "diff" ? "is-on" : ""}`}
                      onClick={() => setTab("diff")}
                    >
                      {t("nodes:inspector.compare")}
                    </button>
                  )}
                </div>

                {reasoning && (
                  <div className="reasoning">
                    <button
                      className="link"
                      onClick={() => setShowReasoning((v) => !v)}
                    >
                      {showReasoning
                        ? t("nodes:inspector.reasoningHide")
                        : t("nodes:inspector.reasoningShow")}
                    </button>
                    {showReasoning && (
                      <pre className="output reasoning__text">{reasoning}</pre>
                    )}
                  </div>
                )}

                {rt?.toolCalls && rt.toolCalls.length > 0 && (
                  <div className="tool-calls">
                    <span className="tool-calls__label">
                      {t("nodes:inspector.toolCalls")}
                    </span>
                    {rt.toolCalls.map((tc) => (
                      <div key={tc.callId} className="tool-call">
                        <div className="tool-call__head">
                          <span className="tool-call__name">{tc.name}</span>
                          {tc.error ? (
                            <span className="tool-call__status tool-call__status--err">
                              {t("nodes:inspector.errorLabel.UNKNOWN")}
                            </span>
                          ) : (
                            <span className="tool-call__status">
                              {t("nodes:inspector.toolStatusDone")}
                            </span>
                          )}
                        </div>
                        <pre className="tool-call__args">
                          {typeof tc.args === "string"
                            ? tc.args
                            : JSON.stringify(tc.args, null, 2)}
                        </pre>
                        {tc.result !== undefined && (
                          <pre className="tool-call__result">
                            {typeof tc.result === "string"
                              ? tc.result
                              : JSON.stringify(tc.result, null, 2)}
                          </pre>
                        )}
                        {tc.error && (
                          <pre className="tool-call__error">{tc.error}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {showDiff ? (
                  <pre className="output output--diff">
                    {diffLines(
                      rt!.outputs[prev!] ?? "",
                      rt!.outputs[last!] ?? "",
                    ).map((p, i) => (
                      <span key={i} className={`d-${p.kind}`}>
                        {p.text}
                      </span>
                    ))}
                  </pre>
                ) : (
                  <div className="output output--rich">
                    {renderNodeOutput(rt?.outputs[activeAttempt] ?? "")}
                  </div>
                )}

                {artifacts.filter((a) => !isProductJsonSource(a)).length >
                  0 && (
                  <div className="artifacts">
                    <h4 className="label">{t("nodes:inspector.artifacts")}</h4>
                    <div className="artifacts__grid">
                      {artifacts
                        .filter((a) => !isProductJsonSource(a))
                        .map((a: Artifact) => (
                          <ArtifactCard
                            key={a.id}
                            a={{ ...a, cost: rt?.costUsd ?? null }}
                          />
                        ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}
        {mainTab === "skills" && node.kind === "textGen" && (
          <SkillPicker
            mounted={node.textGen?.skills ?? []}
            onChange={(skills) =>
              updateNode(node.id, { textGen: { ...node.textGen!, skills } })
            }
          />
        )}
      </div>
    </aside>
  );
}
