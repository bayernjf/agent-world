import { useEffect, useRef, useState } from "react";
import {
  UNIT_LABELS,
  parseProductDocument,
  type Artifact,
  type Graph,
} from "@agent-world/core";
import { ArtifactCard, renderMarkdown } from "../lib/artifact-renderers";
import { api, type AppConfig, type Modality } from "../lib/api";
import { useGraph } from "../store/graph";
import { useVisibleRuntime } from "../store/run";
import SkillPicker from "./SkillPicker";
import FinishedProduct from "./FinishedProduct";
import VariantComparison from "./VariantComparison";
import ProductBlocks from "./ProductBlocks";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { FIELD_COMPONENTS } from "./InspectorFields/registry";
import type { FieldsProps, ModelOption } from "./InspectorFields/types";

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
  const { graph, selectedId, updateNode, saveState, reloadGraph, arrangeLanes, duplicateLanes } = useGraph();
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
  const allModelOptions: ModelOption[] = settings
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

  // The config panel for the selected node kind, resolved from the registry.
  const Fields = FIELD_COMPONENTS[node.kind];
  const fieldsProps: FieldsProps = {
    node,
    graph,
    updateNode,
    beginEdit,
    commitEdit,
    t,
    onOpenSettings,
    textModelOptions,
    imageModelOptions,
    videoModelOptions,
    audioModelOptions,
    graphs,
    duplicateLanes,
    arrangeLanes,
  };

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

            {Fields && <Fields {...fieldsProps} />}
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

            {(node.kind === "select" || node.kind === "fanout") && (
              <VariantComparison graph={graph} runtime={runtime} nodeId={node.id} />
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
