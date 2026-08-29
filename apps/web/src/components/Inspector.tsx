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
import ConnectorEditor from "./ConnectorEditor";

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
function MissingModelHint({ hasModels, onOpenSettings }: { hasModels: boolean; onOpenSettings: () => void }) {
  if (hasModels) return null;
  return (
    <p className="field__hint">
      尚未配置该类型模型，运行前需先
      <button type="button" className="link" onClick={onOpenSettings}>
        前往「设置 · 模型与密钥」
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
  parse: "解析（CSV/JSON → 表格）",
  filter: "筛选行",
  sort: "排序",
  aggregate: "聚合统计",
  output: "输出格式",
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
            if (op === "parse") onChange({ op: "parse", format: "csv", hasHeader: true, delimiter: "," });
            else if (op === "filter") onChange({ op: "filter", column: "", operator: "eq", value: "" });
            else if (op === "sort") onChange({ op: "sort", column: "", direction: "asc" });
            else if (op === "aggregate") onChange({ op: "aggregate", aggs: [{ column: "", fn: "count" }] });
            else onChange({ op: "output", format: "json" });
          }}
        >
          {Object.entries(STEP_OP_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--small btn--ghost" onClick={onRemove} title="删除该步骤">
          ✕
        </button>
      </div>

      {step.op === "parse" && (
        <>
          {stepField(
            "格式",
            <select
              className="select"
              value={step.format}
              onChange={(e) => onChange({ ...step, format: e.target.value as "csv" | "json" })}
            >
              <option value="csv">CSV 文本</option>
              <option value="json">JSON 数组</option>
            </select>,
          )}
          {step.format === "csv" && (
            <>
              {stepField(
                "分隔符",
                <input
                  type="text"
                  className="input mono"
                  value={step.delimiter}
                  maxLength={4}
                  onChange={(e) => onChange({ ...step, delimiter: e.target.value || "," })}
                />,
              )}
              <label className="field">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={step.hasHeader}
                  onChange={(e) => onChange({ ...step, hasHeader: e.target.checked })}
                />
                <span>首行为表头</span>
              </label>
            </>
          )}
        </>
      )}

      {step.op === "filter" && (
        <>
          {stepField(
            "列名",
            <input
              type="text"
              className="input mono"
              value={step.column}
              onChange={(e) => onChange({ ...step, column: e.target.value })}
            />,
          )}
          {stepField(
            "操作符",
            <select
              className="select"
              value={step.operator}
              onChange={(e) =>
                onChange({
                  ...step,
                  operator: e.target.value as "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains",
                })
              }
            >
              <option value="eq">等于</option>
              <option value="ne">不等于</option>
              <option value="gt">大于</option>
              <option value="gte">大于等于</option>
              <option value="lt">小于</option>
              <option value="lte">小于等于</option>
              <option value="contains">包含（忽略大小写）</option>
            </select>,
          )}
          {stepField(
            "比较值",
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
            "列名",
            <input
              type="text"
              className="input mono"
              value={step.column}
              onChange={(e) => onChange({ ...step, column: e.target.value })}
            />,
          )}
          {stepField(
            "方向",
            <select
              className="select"
              value={step.direction}
              onChange={(e) => onChange({ ...step, direction: e.target.value as "asc" | "desc" })}
            >
              <option value="asc">升序</option>
              <option value="desc">降序</option>
            </select>,
          )}
        </>
      )}

      {step.op === "aggregate" && (
        <>
          {stepField(
            "分组列（留空 = 全表聚合）",
            <input
              type="text"
              className="input mono"
              value={step.groupBy ?? ""}
              onChange={(e) => onChange({ ...step, groupBy: e.target.value || undefined })}
            />,
          )}
          {step.aggs.map((agg, i) => (
            <div key={i} className="table-step__agg">
              <input
                type="text"
                className="input mono"
                placeholder="列名"
                value={agg.column}
                onChange={(e) =>
                  onChange({ ...step, aggs: replaceAt(step.aggs, i, { ...agg, column: e.target.value }) })
                }
              />
              <select
                className="select"
                value={agg.fn}
                onChange={(e) =>
                  onChange({ ...step, aggs: replaceAt(step.aggs, i, { ...agg, fn: e.target.value as typeof agg.fn }) })
                }
              >
                <option value="count">计数</option>
                <option value="sum">求和</option>
                <option value="avg">平均</option>
                <option value="min">最小</option>
                <option value="max">最大</option>
              </select>
              <input
                type="text"
                className="input mono"
                placeholder="输出列名"
                value={agg.as ?? ""}
                onChange={(e) =>
                  onChange({ ...step, aggs: replaceAt(step.aggs, i, { ...agg, as: e.target.value || undefined }) })
                }
              />
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => onChange({ ...step, aggs: step.aggs.filter((_, j) => j !== i) })}
                title="删除该聚合"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--small"
            onClick={() => onChange({ ...step, aggs: [...step.aggs, { column: "", fn: "count" }] })}
          >
            + 添加聚合
          </button>
        </>
      )}

      {step.op === "output" && (
        <>
          {stepField(
            "输出格式",
            <select
              className="select"
              value={step.format}
              onChange={(e) => onChange({ ...step, format: e.target.value as "json" | "csv" })}
            >
              <option value="json">JSON（{"{ rows, count, columns }"} 对象）</option>
              <option value="csv">CSV 文本（额外产出）</option>
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
  TIMEOUT: "超时",
  RATE_LIMIT: "限流",
  PROVIDER_ERROR: "模型服务错误",
  AUTH: "密钥错误",
  VALIDATION: "质检未通过",
  BUDGET: "节点预算超限",
  UNKNOWN: "未知错误",
  UNSUPPORTED: "暂不支持",
};

/** 富渲染节点文本产出：含 product-json 走结构化成品，否则走 Markdown。 */
function renderNodeOutput(text: string): React.ReactNode {
  const doc = parseProductDocument(text);
  if (doc) return <ProductBlocks doc={doc} />;
  // parse 失败：常因模型在 product-json 的字段里写了未转义引号，导致 JSON 非法。
  // 兜底策略——把整段围栏剥掉再渲染 Markdown，避免把半成品源码裸露给用户。
  if (/```product-json/i.test(text)) {
    const cleaned = text.replace(/```product-json[\s\S]*?```/gi, "").trim();
    if (cleaned) return <div className="artifact-md">{renderMarkdown(cleaned)}</div>;
    return (
      <div className="artifact-md muted">
        结构化成品解析失败（JSON 不合法），暂无法富渲染。
      </div>
    );
  }
  return <div className="artifact-md">{renderMarkdown(text)}</div>;
}

/** 过滤掉"内容本身就是 product-json 围栏"的中间产物，避免与富成品重复展示。 */
function isProductJsonSource(a: Artifact): boolean {
  return (a.kind === "text" || a.kind === "json") && !!a.content?.includes("```product-json");
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
function clampMainTab(tab: MainTab, isAgent: boolean): MainTab {
  return tab === "skills" && !isAgent ? "output" : tab;
}

function nextMainTab(current: MainTab, isAgent: boolean): MainTab {
  const order = MAIN_TAB_ORDER.filter((t) => t !== "skills" || isAgent);
  const i = order.indexOf(current);
  return order[(i + 1) % order.length]!;
}

export default function Inspector({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { graph, selectedId, updateNode, saveState, reloadGraph } = useGraph();
  const runtime = useVisibleRuntime();
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
        setState: (fn: (st: { pastStates: unknown[]; futureStates: unknown[] }) => {
          pastStates: unknown[];
          futureStates: unknown[];
        }) => void;
      };
      setTemporal.setState((st) => ({
        pastStates: [...st.pastStates, { graph: start }],
        futureStates: [],
      }));
    }
    editStartRef.current = null;
  };

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);
  // Moving between nodes keeps the tab the user last used; only fall back when
  // that tab does not exist on the newly selected node kind.
  useEffect(() => {
    const isAgent = graph.nodes.find((n) => n.id === selectedId)?.kind === "agent";
    setMainTabState((cur) => clampMainTab(cur, !!isAgent));
  }, [selectedId, graph]);

  // E cycles 产出 → 配置 → 技能, alongside the existing single-key canvas bindings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !selectedId) return;
      if (e.key !== "e" && e.key !== "E") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      e.preventDefault();
      const isAgent = graph.nodes.find((n) => n.id === selectedId)?.kind === "agent";
      setMainTab(nextMainTab(mainTab, !!isAgent));
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

  const videoModelOptions = allModelOptions.filter((o) => o.modality === "video");
  const audioModelOptions = allModelOptions.filter((o) => o.modality === "audio");
  const textModelOptions = allModelOptions.filter((o) => o.modality === "text");
  const imageModelOptions = allModelOptions.filter((o) => o.modality === "image");

  const node = graph.nodes.find((n) => n.id === selectedId);
  if (!node) {
    return (
      <aside className="panel inspector">
        <div className="panel__bar">
          <span>厂房详情</span>
        </div>
        <p className="empty">选中一座厂房查看详情</p>
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
  const reasoning = rt && activeAttempt ? rt.reasoning[activeAttempt] : undefined;
  const artifacts = rt?.artifacts ?? [];
  const saveIndicator =
    saveState === "saving"
      ? "保存中…"
      : saveState === "saved"
        ? "已保存"
        : saveState === "error"
          ? "保存失败"
          : "";

  return (
    <aside className="panel inspector">
      <div className="panel__bar">
        <span>{node.name}</span>
        <span className="muted">{node.kind}</span>
        {rt?.lastVerdict?.score != null && (
          <span
            className={`chip chip--score chip--score-${rt.lastVerdict.score >= 7 ? "good" : rt.lastVerdict.score >= 4 ? "warn" : "bad"}`}
            title={`质检评分 ${rt.lastVerdict.score}/10 — ${rt.lastVerdict.reason}`}
          >
            质量 {rt.lastVerdict.score}/10
          </span>
        )}
      </div>

      <div className={`inspector__tabs${tabFlash ? " is-flash" : ""}`}>
        <button
          type="button"
          className={`tab ${mainTab === "output" ? "is-on" : ""}`}
          onClick={() => setMainTab("output")}
        >产出</button>
        <button
          type="button"
          className={`tab ${mainTab === "config" ? "is-on" : ""}`}
          onClick={() => setMainTab("config")}
        >配置</button>
        {node.kind === "agent" && (
          <button
            type="button"
            className={`tab ${mainTab === "skills" ? "is-on" : ""}`}
            onClick={() => setMainTab("skills")}
          >技能</button>
        )}
        <span
          className="inspector__tab-hint"
          data-tip="按 E 循环切换标签页"
          aria-label="按 E 循环切换标签页"
        >
          <kbd className="kbd-inline">E</kbd>
        </span>
      </div>

      <div className="inspector__body">
        {mainTab === "config" && (<>
        {saveState === "conflict" && (
          <div className="conflict-banner" role="alert">
            <span>该产线已在其他标签页被修改，当前改动未保存。</span>
            <button type="button" className="btn btn--small" onClick={() => void reloadGraph()}>
              重新载入
            </button>
          </div>
        )}
        <label className="field">
          <span>名称 {saveIndicator && <em className="save-state">{saveIndicator}</em>}</span>
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
          <>
          <div className="source-brief">
            <div className="source-brief__head label">创作简报（可选）</div>
          <label className="field">
            <span>商品名称</span>
            <input
              value={node.source?.productName ?? ""}
              placeholder="商品名称"
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  source: { ...(node.source ?? {}), productName: e.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>品牌 / 店铺</span>
            <input
              value={node.source?.brand ?? ""}
              placeholder="品牌 / 店铺"
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  source: { ...(node.source ?? {}), brand: e.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>目标人群（如 20-30岁通勤女生）</span>
            <input
              value={node.source?.audience ?? ""}
              placeholder="目标人群（如 20-30岁通勤女生）"
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  source: { ...(node.source ?? {}), audience: e.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>价格定位（如 中端 99-199 元）</span>
            <input
              value={node.source?.priceRange ?? ""}
              placeholder="价格定位（如 中端 99-199 元）"
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  source: { ...(node.source ?? {}), priceRange: e.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>语气调性（如 真诚种草、口语化）</span>
            <input
              value={node.source?.tone ?? ""}
              placeholder="语气调性（如 真诚种草、口语化）"
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  source: { ...(node.source ?? {}), tone: e.target.value },
                })
              }
            />
          </label>
            <label className="field">
              <span>禁用词 / 禁用说法</span>
              <textarea
                rows={2}
                value={node.source?.prohibited ?? ""}
                placeholder="用逗号或换行分隔，如 最、第一、国家级"
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, {
                    source: { ...(node.source ?? {}), prohibited: e.target.value },
                  })
                }
              />
            </label>
            <label className="field">
              <span>品牌词（建议融入）</span>
              <textarea
                rows={2}
                value={node.source?.brandTerms ?? ""}
                placeholder="用逗号或换行分隔，如 显瘦、透气、百搭"
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, {
                    source: { ...(node.source ?? {}), brandTerms: e.target.value },
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
                  const merged = [...new Set([...cur, ...terms.map((t) => t.term)])].join("、");
                  updateNode(node.id, {
                    source: { ...(node.source ?? {}), brandTerms: merged },
                  });
                }}
              >
                从品牌词库载入
              </button>
            </label>
            <label className="field">
              <span>补充说明</span>
              <textarea
                rows={3}
                value={node.source?.notes ?? ""}
                placeholder="其他想让写手知道的背景、卖点、参考风格等"
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, {
                    source: { ...(node.source ?? {}), notes: e.target.value },
                  })
                }
              />
            </label>
          </div>

          <ConnectorEditor
            connector={node.source?.connector}
            onChange={(c) => updateNode(node.id, { source: { ...(node.source ?? {}), connector: c } })}
            onBeginEdit={beginEdit}
            onCommitEdit={commitEdit}
          />
          </>
        )}

        {node.kind === "agent" && node.agent && (
          <>
            <label className="field">
              <span>模型</span>
              <select
                className="select"
                value={node.agent.model || "__unset__"}
                onChange={(e) => {
                  if (e.target.value === "__unset__") return;
                  updateNode(node.id, { agent: { ...node.agent!, model: e.target.value } });
                }}
              >
                <option value="__unset__" disabled hidden>
                  {!node.agent.model
                    ? "（未配置 — 请先在「模型设置」中添加文本模型）"
                    : "（请选择）"}
                </option>
                {textModelOptions.map((o) => (
                  <option key={`${o.provider}::${o.model}`} value={o.model}>
                    {o.model} · {o.provider}
                  </option>
                ))}
                {!textModelOptions.some((o) => o.model === node.agent!.model) && node.agent.model && (
                  <option value={node.agent.model}>{node.agent.model} (当前)</option>
                )}
              </select>
              <MissingModelHint hasModels={textModelOptions.length > 0} onOpenSettings={onOpenSettings} />
            </label>
            <label className="field">
              <span>温度 ({node.agent.temperature.toFixed(2)})</span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={node.agent.temperature}
                onChange={(e) =>
                  updateNode(node.id, {
                    agent: { ...node.agent!, temperature: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              <span>节点预算 (USD，留空不限制)</span>
              <input
                type="number"
                min="0"
                step="0.001"
                placeholder="不限制"
                value={node.agent.budgetUsd ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    agent: {
                      ...node.agent!,
                      budgetUsd: e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="field">
              <span>输入策略</span>
              <select
                className="select"
                value={node.agent.inputPolicy?.mode ?? "all"}
                onChange={(e) =>
                  updateNode(node.id, {
                    agent: {
                      ...node.agent!,
                      inputPolicy: {
                        ...(node.agent!.inputPolicy ?? { mode: "all" as const }),
                        mode: e.target.value as "all" | "last" | "truncate" | "summary",
                      },
                    },
                  })
                }
              >
                <option value="all">全部拼接（默认）</option>
                <option value="last">仅最近上游</option>
                <option value="truncate">截断保留尾部</option>
                <option value="summary">摘要压缩（超阈值时）</option>
              </select>
            </label>
            <p className="note">
              {(() => {
                switch (node.agent.inputPolicy?.mode ?? "all") {
                  case "all":
                    return "默认：把全部上游输出按顺序拼接后作为输入。";
                  case "last":
                    return "只取最近一个上游节点的输出作为输入。";
                  case "truncate":
                    return "超过「最大字符数」时丢弃前面的内容、保留尾部最近片段（不调用模型，零额外开销）。";
                  case "summary":
                    return "超过「最大字符数」时调用 LLM 滚动摘要压缩、保留关键信息（更省 context，但会产生少量额外 token 消耗）；未超阈值则原样传递。";
                  default:
                    return "";
                }
              })()}
            </p>
            {(node.agent.inputPolicy?.mode === "truncate" ||
              node.agent.inputPolicy?.mode === "summary") && (
              <label className="field">
                <span>最大字符数</span>
                <input
                  type="number"
                  min="500"
                  step="500"
                  value={node.agent.inputPolicy?.maxChars ?? 8000}
                  onChange={(e) =>
                    updateNode(node.id, {
                      agent: {
                        ...node.agent!,
                        inputPolicy: {
                          mode: node.agent?.inputPolicy?.mode ?? "truncate",
                          maxChars: Number(e.target.value),
                        },
                      },
                    })
                  }
                />
              </label>
            )}
            <label className="field">
              <span>指令</span>
              <textarea
                rows={4}
                value={node.agent.prompt}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, { agent: { ...node.agent!, prompt: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>排版指令（图片位置/比例，下次运行生效）</span>
              <textarea
                rows={3}
                placeholder="例：主图用竖图 3:4 居中；场景图卡用 2 列网格；细节图靠右"
                value={node.agent.imageDirectives ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    agent: { ...node.agent!, imageDirectives: e.target.value },
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
              <span>生图模型</span>
              <select
                className="select"
                value={node.imageGen.model || "__unset__"}
                onChange={(e) => {
                  if (e.target.value === "__unset__") return;
                  updateNode(node.id, { imageGen: { ...node.imageGen!, model: e.target.value } });
                }}
              >
                <option value="__unset__" disabled hidden>
                  {!node.imageGen.model
                    ? "（未配置 — 请先在「模型设置」中添加图片模型）"
                    : "（请选择）"}
                </option>
                {imageModelOptions.map((o) => (
                  <option key={`${o.provider}::${o.model}`} value={o.model}>
                    {o.model} · {o.provider}
                  </option>
                ))}
                {!imageModelOptions.some((o) => o.model === node.imageGen!.model) && node.imageGen.model && (
                  <option value={node.imageGen.model}>{node.imageGen.model} (当前)</option>
                )}
              </select>
              <MissingModelHint hasModels={imageModelOptions.length > 0} onOpenSettings={onOpenSettings} />
            </label>
            <label className="field">
              <span>尺寸 (如 1024x1024)</span>
              <input
                type="text"
                placeholder="1024x1024"
                value={node.imageGen.size ?? ""}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, {
                    imageGen: { ...node.imageGen!, size: e.target.value || undefined },
                  })
                }
              />
            </label>
            <label className="field">
              <span>生图提示词（留空则按品牌简报自动生成）</span>
              <textarea
                rows={4}
                placeholder="如：清新日系风格的主图，突出产品质感"
                value={node.imageGen.prompt ?? ""}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, { imageGen: { ...node.imageGen!, prompt: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>生成数量 (1–8)</span>
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
                      n: Math.min(8, Math.max(1, Number(e.target.value) || 1)),
                    },
                  })
                }
              />
            </label>
            <details className="adv">
              <summary>自定义端点（可选）</summary>
              <label className="field">
                <span>生图端点 baseURL</span>
                <input
                  type="text"
                  placeholder="https://your-sd-server/v1"
                  value={node.imageGen.baseUrl ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, { imageGen: { ...node.imageGen!, baseUrl: e.target.value || undefined } })
                  }
                />
              </label>
              <label className="field">
                <span>密钥（可选，留空用 provider 的 key）</span>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={node.imageGen.apiKey ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, { imageGen: { ...node.imageGen!, apiKey: e.target.value || undefined } })
                  }
                />
              </label>
            </details>
          </>
        )}

        {node.kind === "videoGen" && node.videoGen && (
          <>
            <label className="field">
              <span>视频模型</span>
              <select
                className="select"
                value={node.videoGen.model || "__unset__"}
                onChange={(e) => {
                  if (e.target.value === "__unset__") return;
                  updateNode(node.id, { videoGen: { ...node.videoGen!, model: e.target.value } });
                }}
              >
                <option value="__unset__" disabled hidden>
                  {!node.videoGen.model
                    ? "（未配置 — 请先在「模型设置」中添加视频模型）"
                    : "（请选择）"}
                </option>
                {videoModelOptions.map((o) => (
                  <option key={`${o.provider}::${o.model}`} value={o.model}>
                    {o.model} · {o.provider}
                  </option>
                ))}
                {!videoModelOptions.some((o) => o.model === node.videoGen!.model) && node.videoGen.model && (
                  <option value={node.videoGen.model}>{node.videoGen.model} (当前)</option>
                )}
              </select>
              <MissingModelHint hasModels={videoModelOptions.length > 0} onOpenSettings={onOpenSettings} />
            </label>
            <label className="field">
              <span>视频提示词（留空则用上游文本）</span>
              <textarea
                rows={4}
                placeholder="如：产品在阳光下旋转展示，背景为渐变色"
                value={node.videoGen.prompt ?? ""}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, { videoGen: { ...node.videoGen!, prompt: e.target.value } })
                }
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>时长 (秒)</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  placeholder="5"
                  value={node.videoGen.duration ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, {
                      videoGen: {
                        ...node.videoGen!,
                        duration: e.target.value ? Math.min(60, Math.max(1, Number(e.target.value))) : undefined,
                      },
                    })
                  }
                />
              </label>
              <label className="field">
                <span>宽高比</span>
                <select
                  className="select"
                  value={node.videoGen.aspect ?? ""}
                  onChange={(e) =>
                    updateNode(node.id, {
                      videoGen: { ...node.videoGen!, aspect: (e.target.value || undefined) as VideoGenConfig["aspect"] },
                    })
                  }
                >
                  <option value="">默认</option>
                  <option value="16:9">16:9 横屏</option>
                  <option value="9:16">9:16 竖屏</option>
                  <option value="1:1">1:1 方形</option>
                  <option value="4:3">4:3</option>
                  <option value="3:4">3:4</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>生成数量 (1–4)</span>
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
                      n: Math.min(4, Math.max(1, Number(e.target.value) || 1)),
                    },
                  })
                }
              />
            </label>
            <details className="adv">
              <summary>自定义端点（可选）</summary>
              <label className="field">
                <span>视频端点 baseURL</span>
                <input
                  type="text"
                  placeholder="https://your-video-server/v1"
                  value={node.videoGen.baseUrl ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, { videoGen: { ...node.videoGen!, baseUrl: e.target.value || undefined } })
                  }
                />
              </label>
              <label className="field">
                <span>密钥（可选）</span>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={node.videoGen.apiKey ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, { videoGen: { ...node.videoGen!, apiKey: e.target.value || undefined } })
                  }
                />
              </label>
            </details>
          </>
        )}

        {node.kind === "audioGen" && node.audioGen && (
          <>
            <label className="field">
              <span>音频模型</span>
              <select
                className="select"
                value={node.audioGen.model || "__unset__"}
                onChange={(e) => {
                  if (e.target.value === "__unset__") return;
                  updateNode(node.id, { audioGen: { ...node.audioGen!, model: e.target.value } });
                }}
              >
                <option value="__unset__" disabled hidden>
                  {!node.audioGen.model
                    ? "（未配置 — 请先在「模型设置」中添加音频模型）"
                    : "（请选择）"}
                </option>
                {audioModelOptions.map((o) => (
                  <option key={`${o.provider}::${o.model}`} value={o.model}>
                    {o.model} · {o.provider}
                  </option>
                ))}
                {!audioModelOptions.some((o) => o.model === node.audioGen!.model) && node.audioGen.model && (
                  <option value={node.audioGen.model}>{node.audioGen.model} (当前)</option>
                )}
              </select>
              <MissingModelHint hasModels={audioModelOptions.length > 0} onOpenSettings={onOpenSettings} />
            </label>
            <label className="field">
              <span>文本 / 提示词（留空则用上游文本）</span>
              <textarea
                rows={4}
                placeholder="TTS：要朗读的文本；音乐：风格描述"
                value={node.audioGen.prompt ?? ""}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, { audioGen: { ...node.audioGen!, prompt: e.target.value } })
                }
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>语音 (TTS)</span>
                <input
                  type="text"
                  placeholder="alloy / echo / fable..."
                  value={node.audioGen.voice ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, { audioGen: { ...node.audioGen!, voice: e.target.value || undefined } })
                  }
                />
              </label>
              <label className="field">
                <span>输出格式</span>
                <select
                  className="select"
                  value={node.audioGen.format ?? "mp3"}
                  onChange={(e) =>
                    updateNode(node.id, {
                      audioGen: { ...node.audioGen!, format: e.target.value as AudioGenConfig["format"] },
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
                <span>语速 (0.25–4.0)</span>
                <input
                  type="number"
                  min={0.25}
                  max={4}
                  step={0.25}
                  placeholder="1.0"
                  value={node.audioGen.speed ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, {
                      audioGen: {
                        ...node.audioGen!,
                        speed: e.target.value ? Math.min(4, Math.max(0.25, Number(e.target.value))) : undefined,
                      },
                    })
                  }
                />
              </label>
              <label className="field">
                <span>生成数量 (1–4)</span>
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
                        n: Math.min(4, Math.max(1, Number(e.target.value) || 1)),
                      },
                    })
                  }
                />
              </label>
            </div>
            <details className="adv">
              <summary>自定义端点（可选）</summary>
              <label className="field">
                <span>音频端点 baseURL</span>
                <input
                  type="text"
                  placeholder="https://your-audio-server/v1"
                  value={node.audioGen.baseUrl ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, { audioGen: { ...node.audioGen!, baseUrl: e.target.value || undefined } })
                  }
                />
              </label>
              <label className="field">
                <span>密钥（可选）</span>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={node.audioGen.apiKey ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, { audioGen: { ...node.audioGen!, apiKey: e.target.value || undefined } })
                  }
                />
              </label>
            </details>
          </>
        )}

        {node.kind === "gate" && node.gate && (
          <>
            <label className="field">
              <span>质检标准</span>
              <textarea
                rows={3}
                placeholder="产出必须满足什么条件？不合格将沿返工线退回。"
                value={node.gate.criterion}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, { gate: { ...node.gate!, criterion: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>返工次数上限</span>
              <input
                type="number"
                min={1}
                max={10}
                value={node.gate.maxAttempts}
                onChange={(e) =>
                  updateNode(node.id, {
                    gate: { ...node.gate!, maxAttempts: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              <span>质量分门槛（0–10，留空不卡）</span>
              <input
                type="number"
                min={0}
                max={10}
                value={node.gate.minScore ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    gate: {
                      ...node.gate!,
                      minScore: e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="field">
              <span>品牌词覆盖率门槛（0–100%，留空不卡）</span>
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
                        e.target.value === "" ? undefined : Number(e.target.value) / 100,
                    },
                  })
                }
              />
            </label>
            <label className="field">
              <span>次数耗尽后</span>
              <select
                value={node.gate.onExhausted}
                onChange={(e) =>
                  updateNode(node.id, {
                    gate: {
                      ...node.gate!,
                      onExhausted: e.target.value as "pass" | "scrap" | "halt",
                    },
                  })
                }
              >
                <option value="halt">停线等人工</option>
                <option value="scrap">报废</option>
                <option value="pass">放行</option>
              </select>
            </label>
          </>
        )}

        {node.kind === "http" && node.http && (
          <>
            <label className="field">
              <span>方法</span>
              <select
                className="select"
                value={node.http.method}
                onChange={(e) =>
                  updateNode(node.id, {
                    http: { ...node.http!, method: e.target.value as HttpNodeConfig["method"] },
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
              <span>URL</span>
              <input
                type="text"
                placeholder="https://api.example.com/data"
                value={node.http.url}
                onChange={(e) =>
                  updateNode(node.id, { http: { ...node.http!, url: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>Query 参数（每行 key: value）</span>
              <textarea
                rows={3}
                placeholder="page: 1&#10;limit: 10"
                value={formatPairs(node.http.query ?? {})}
                onChange={(e) =>
                  updateNode(node.id, {
                    http: { ...node.http!, query: parsePairs(e.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              <span>请求头（每行 key: value）</span>
              <textarea
                rows={3}
                placeholder="Authorization: Bearer xxx"
                value={formatPairs(node.http.headers ?? {})}
                onChange={(e) =>
                  updateNode(node.id, {
                    http: { ...node.http!, headers: parsePairs(e.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              <span>请求体</span>
              <textarea
                rows={4}
                placeholder='{"foo": "${source}"}'
                value={node.http.body ?? ""}
                onChange={(e) =>
                  updateNode(node.id, { http: { ...node.http!, body: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>超时（毫秒）</span>
              <input
                type="number"
                min={1000}
                step={1000}
                value={node.http.timeoutMs}
                onChange={(e) =>
                  updateNode(node.id, {
                    http: { ...node.http!, timeoutMs: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              <span>输出模式</span>
              <select
                className="select"
                value={node.http.outputMode}
                onChange={(e) =>
                  updateNode(node.id, {
                    http: { ...node.http!, outputMode: e.target.value as HttpNodeConfig["outputMode"] },
                  })
                }
              >
                <option value="auto">自动（JSON 响应存为 json artifact）</option>
                <option value="json">强制 JSON</option>
                <option value="text">强制文本</option>
                <option value="file">文件（二进制下载，供文件解析节点使用）</option>
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
              <span>非 2xx 响应视为节点失败</span>
            </label>
            <p className="note">
              URL / 请求头 / Query / 请求体支持变量插值：${"{"}上游节点id{".字段}"}，例如 ${"{"}source.price{"}"}。
            </p>
          </>
        )}

        {node.kind === "code" && node.code && (
          <>
            <label className="field">
              <span>语言</span>
              <select
                className="select"
                value={node.code.language}
                onChange={(e) =>
                  updateNode(node.id, {
                    code: { ...node.code!, language: e.target.value as "javascript" | "python" },
                  })
                }
              >
                <option value="javascript">JavaScript (Node.js)</option>
                <option value="python">Python 3</option>
              </select>
            </label>
            <label className="field">
              <span>脚本</span>
              <textarea
                className="mono"
                rows={9}
                placeholder={'const fs = require("fs");\nconst input = JSON.parse(fs.readFileSync(0, "utf8"));\n// 上游数据在 input.inputs.<上游节点id>\nconsole.log(JSON.stringify({ doubled: Number(input.inputs.source) * 2 }));'}
                value={node.code.code}
                onChange={(e) =>
                  updateNode(node.id, { code: { ...node.code!, code: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>超时（毫秒）</span>
              <input
                type="number"
                min={1000}
                step={1000}
                value={node.code.timeoutMs}
                onChange={(e) =>
                  updateNode(node.id, {
                    code: { ...node.code!, timeoutMs: Number(e.target.value) },
                  })
                }
              />
            </label>
            <p className="note">
              脚本经 stdin 收到 JSON：{"{"}"inputs": {"{"}上游节点id: 值{"}"}{"}"}{"}"}；stdout 输出单个 JSON
              对象/数组 → json artifact，其他文本 → text artifact；退出码非 0 或超时视为节点失败。脚本内可引用上游
              变量：${"{"}source.price{"}"}。
            </p>
          </>
        )}

        {node.kind === "branch" && node.branch && (
          <>
            <div className="field">
              <span>分支规则（按顺序匹配第一个命中）</span>
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
                    <option value="">选择目标…</option>
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
                    title="删除该分支"
                    onClick={() =>
                      updateNode(node.id, {
                        branch: {
                          ...node.branch!,
                          rules: (node.branch!.rules ?? []).filter((r) => r.id !== rule.id),
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
                      rules: [...(node.branch!.rules ?? []), { id: `r${Date.now()}`, when: "true", target: "" }],
                    },
                  })
                }
              >
                + 添加规则
              </button>
            </div>
            <label className="field">
              <span>默认分支（未命中任何规则）</span>
              <select
                className="select"
                value={node.branch.defaultTarget ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    branch: { ...node.branch!, defaultTarget: e.target.value || undefined },
                  })
                }
              >
                <option value="">丢弃报文</option>
                {graph.nodes
                  .filter((n) => n.id !== node.id)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name || n.id}
                    </option>
                  ))}
              </select>
            </label>
            <p className="note">
              条件表达式示例：${"{"}api.price{"}"} &gt; 100 &amp;&amp; ${"{"}api.stock{"}"} &gt; 0。支持 == !={" "}
              &gt; &lt; &gt;= &lt;= &amp;&amp; || ! 与括号；未命中且无默认分支时报文被丢弃，该分支下游不执行。
            </p>
          </>
        )}

        {node.kind === "map" && node.map && (
          <>
            <label className="field">
              <span>数据来源（上游节点）</span>
              <select
                className="select"
                value={node.map.source ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    map: { ...node.map!, source: e.target.value || undefined },
                  })
                }
              >
                <option value="">自动（唯一上游）</option>
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
              <span>迭代数组路径（可选）</span>
              <input
                type="text"
                className="input mono"
                placeholder="如 data.items；留空则映射单个对象"
                value={node.map.iterate ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    map: { ...node.map!, iterate: e.target.value || undefined },
                  })
                }
              />
            </label>
            <label className="field">
              <span>输出模板（JSON）</span>
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
            <p className="note">
              模板是合法 JSON，${"{"}...{"}"} 写在字符串值内：${"{"}item.name{"}"} 引用当前项、${"{"}上游节点id.字段{"}"} 引用任意上游。纯占位符（如
              "${"{"}item.addr{"}"}"）自动保留数字/对象类型；配置了迭代数组时对每项生成一份并输出数组。
            </p>
          </>
        )}

        {node.kind === "loop" && node.loop && (
          <>
            <label className="field">
              <span>循环数组表达式</span>
              <input
                type="text"
                className="input mono"
                placeholder='如 ${"{"}api.data{"}"} 或 ${"{"}api.data.items{"}"}'
                value={node.loop.items ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    loop: { ...node.loop!, items: e.target.value || undefined },
                  })
                }
              />
            </label>
            <label className="field">
              <span>最大迭代次数（防呆）</span>
              <input
                type="number"
                min={1}
                max={1000}
                className="input"
                value={node.loop.maxIterations ?? 100}
                onChange={(e) =>
                  updateNode(node.id, {
                    loop: { ...node.loop!, maxIterations: Math.max(1, Number(e.target.value) || 1) },
                  })
                }
              />
            </label>
            <p className="note">
              对数组的每一项执行下游子图（循环体），循环体内可通过 ${"{"}item.字段{"}"} 引用当前项；循环结束后聚合每轮
              输出为 {"{"} "results": [...] {"}"} 供下游引用。超过最大迭代次数会被截断。
            </p>
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
                    parallel: { ...node.parallel!, asObject: e.target.checked },
                  })
                }
              />
              <span>按节点输出对象（{"{ 上游节点id: 值 }"}）</span>
            </label>
            <label className="field">
              <span>提取字段路径（可选）</span>
              <input
                type="text"
                className="input mono"
                placeholder="如 data.text；留空取完整输出"
                value={node.parallel.pick ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    parallel: { ...node.parallel!, pick: e.target.value || undefined },
                  })
                }
              />
            </label>
            <p className="note">
              等待所有上游分支完成后聚合输出（数组或对象）。各分支本身已并行执行，本节点提供显式的结构化汇合点。
            </p>
          </>
        )}

        {node.kind === "table" && node.table && (
          <>
            <label className="field">
              <span>数据来源（上游节点）</span>
              <select
                className="select"
                value={node.table.source ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    table: { ...node.table!, source: e.target.value || undefined },
                  })
                }
              >
                <option value="">自动（唯一上游）</option>
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
              <span className="table-steps__title">处理步骤（按顺序执行）</span>
              {(node.table.steps ?? []).map((step, i) => (
                <TableStepEditor
                  key={i}
                  index={i}
                  step={step}
                  onChange={(next) =>
                    updateNode(node.id, {
                      table: { ...node.table!, steps: replaceAt(node.table!.steps ?? [], i, next) },
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
                        { op: "filter", column: "", operator: "eq", value: "" },
                      ],
                    },
                  })
                }
              >
                + 添加步骤
              </button>
            </div>
            <p className="note">
              输入：上游 CSV 文本（需先加「解析」步骤）、JSON 数组或 {"{"}rows: [...]{"}"}。输出
              {"{"}rows, count, columns{"}"}；「输出格式 = CSV」时额外产出一份 CSV 文本。空步骤列表会把输入原样包装成表格。
            </p>
          </>
        )}

        {node.kind === "database" && node.database && (
          <>
            <label className="field">
              <span>数据库文件（SQLite）</span>
              <input
                className="input mono"
                placeholder="留空 = 内存数据库（每次运行临时创建）"
                value={node.database.path ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    database: { ...node.database!, path: e.target.value || undefined },
                  })
                }
              />
            </label>
            <label className="field">
              <span>初始化 SQL（可多条，结果丢弃）</span>
              <textarea
                className="textarea mono"
                rows={4}
                placeholder={"CREATE TABLE people (name TEXT, age INTEGER);\nINSERT INTO people VALUES ('Alice', 30);"}
                value={node.database.setupSql ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    database: { ...node.database!, setupSql: e.target.value },
                  })
                }
              />
            </label>
            <label className="field">
              <span>主 SQL（单条）</span>
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
            <p className="note">
              查询语句输出 {"{"}rows, count, columns{"}"}，可直连下游「表格」节点继续筛选/排序/聚合；
              INSERT/UPDATE/DELETE 等输出 {"{"}affectedRows, lastInsertId{"}"}。文件路径相对 server 工作目录
              （packages/server）解析。SQL 语法错误或参数不匹配时节点运行失败。
            </p>
          </>
        )}

        {node.kind === "fileParse" && node.fileParse && (
          <>
            <label className="field">
              <span>数据来源（上游节点）</span>
              <select
                className="select"
                value={node.fileParse.source ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    fileParse: { ...node.fileParse!, source: e.target.value || undefined },
                  })
                }
              >
                <option value="">自动（唯一上游）</option>
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
              <span>最大提取图片数（0 = 不提取）</span>
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
            <p className="note">
              从上游的 file artifact 提取文本与内嵌图片（PDF / DOCX / PPTX）。文本输出为 text
              artifact（可直接供 agent 节点消费）；图片输出为 image artifact。
              上游可用「HTTP 节点 + 输出模式 = 文件」下载文档，或接入其他产出 file 的节点。
            </p>
          </>
        )}

        </>)}
        {mainTab === "output" && (<>
        {rt?.error && (
          <section className="error-box">
            <h3 className="label">{rt.errorCode ? ERROR_LABEL[rt.errorCode] ?? "错误" : "错误"}</h3>
            <p className="error-msg">{rt.error}</p>
            {rt.errorCode && <code className="error-code">{rt.errorCode}</code>}
          </section>
        )}

        {rt && (
          <section className="usage">
            <h3 className="label">本次运行</h3>
            <dl>
              <div>
                <dt>状态</dt>
                <dd>{rt.status}</dd>
              </div>
              <div>
                <dt>尝试</dt>
                <dd>{rt.attempt}</dd>
              </div>
              {rt.startedAt && (
                <div>
                  <dt>耗时</dt>
                  <dd>{formatDuration((rt.finishedAt ?? Date.now()) - rt.startedAt)}</dd>
                </div>
              )}
              <div>
                <dt>token</dt>
                <dd>
                  {rt.tokensIn} / {rt.tokensOut}
                  {rt.cachedTokens > 0 && <em className="muted"> (cache {rt.cachedTokens})</em>}
                </dd>
              </div>
              {formatUnits(rt.units) && (
                <div>
                  <dt>用量</dt>
                  <dd>{formatUnits(rt.units)}</dd>
                </div>
              )}
              {rt.costUsd > 0 && (
                <div>
                  <dt>电费</dt>
                  <dd>${rt.costUsd.toFixed(5)}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {node.kind === "sink" && attempts.length > 0 && (
          <FinishedProduct sinkId={node.id} graph={graph} runtime={runtime} />
        )}

        {node.kind !== "sink" && attempts.length > 0 && (
          <section className="attempts">
            <h3 className="label">产出</h3>
            <div className="tabs">
              {attempts.map((a) => (
                <button
                  key={a}
                  className={`chip ${tab === a ? "is-on" : ""}`}
                  onClick={() => setTab(a)}
                >
                  尝试 {a}
                </button>
              ))}
              {attempts.length >= 2 && (
                <button
                  className={`chip ${tab === "diff" ? "is-on" : ""}`}
                  onClick={() => setTab("diff")}
                >
                  对比
                </button>
              )}
            </div>

            {reasoning && (
              <div className="reasoning">
                <button className="link" onClick={() => setShowReasoning((v) => !v)}>
                  {showReasoning ? "隐藏" : "查看"}思考过程
                </button>
                {showReasoning && <pre className="output reasoning__text">{reasoning}</pre>}
              </div>
            )}

            {rt?.toolCalls && rt.toolCalls.length > 0 && (
              <div className="tool-calls">
                <span className="tool-calls__label">工具调用</span>
                {rt.toolCalls.map((tc) => (
                  <div key={tc.callId} className="tool-call">
                    <div className="tool-call__head">
                      <span className="tool-call__name">{tc.name}</span>
                      {tc.error ? (
                        <span className="tool-call__status tool-call__status--err">错误</span>
                      ) : (
                        <span className="tool-call__status">完成</span>
                      )}
                    </div>
                    <pre className="tool-call__args">
                      {typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args, null, 2)}
                    </pre>
                    {tc.result !== undefined && (
                      <pre className="tool-call__result">
                        {typeof tc.result === "string"
                          ? tc.result
                          : JSON.stringify(tc.result, null, 2)}
                      </pre>
                    )}
                    {tc.error && <pre className="tool-call__error">{tc.error}</pre>}
                  </div>
                ))}
              </div>
            )}

            {showDiff ? (
              <pre className="output output--diff">
                {diffLines(rt!.outputs[prev!] ?? "", rt!.outputs[last!] ?? "").map((p, i) => (
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

            {artifacts.filter((a) => !isProductJsonSource(a)).length > 0 && (
              <div className="artifacts">
                <h4 className="label">产出物</h4>
                <div className="artifacts__grid">
                  {artifacts
                    .filter((a) => !isProductJsonSource(a))
                    .map((a: Artifact) => (
                      <ArtifactCard key={a.id} a={{ ...a, cost: rt?.costUsd ?? null }} />
                    ))}
                </div>
              </div>
            )}
          </section>
        )}
        </>)}
        {mainTab === "skills" && node.kind === "agent" && (
          <SkillPicker
            mounted={node.agent?.skills ?? []}
            onChange={(skills) =>
              updateNode(node.id, { agent: { ...node.agent!, skills } })
            }
          />
        )}
      </div>
    </aside>
  );
}


