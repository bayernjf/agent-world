import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Diagnostic, FormConnector, Graph } from "@agent-world/core";

type FormField = FormConnector["fields"][number];
import Canvas, { type Mode } from "./canvas/Canvas";
import { KIND_KEY } from "./canvas/Plants";
import Minimap from "./canvas/Minimap";
import CanvasToolbar from "./components/CanvasToolbar";
import ControlPanel from "./components/ControlPanel";
import Inspector from "./components/Inspector";
import Logo from "./components/Logo";
import Settings from "./components/Settings";
import ShortcutsHelp from "./components/ShortcutsHelp";
import GraphSwitcher, { type GraphSummary } from "./components/GraphSwitcher";
import ConfirmDialog from "./components/ConfirmDialog";
import NewGraphDialog from "./components/NewGraphDialog";
import UndoRedo from "./components/UndoRedo";
import Toast from "./components/Toast";
import Timeline from "./components/Timeline";
import RunHistory from "./components/RunHistory";
import ReviewQueue from "./components/ReviewQueue";
import ModelAssignModal from "./components/ModelAssignModal";
import VariablesModal from "./components/VariablesModal";
import Tooltip from "./components/Tooltip";
import { useTips } from "./store/tips";
import FailurePanel from "./components/FailurePanel";
import FormConnectorModal from "./components/FormConnectorModal";
import CostReport from "./components/CostReport";
import EvalReport from "./components/EvalReport";
import ABDialog from "./components/ABDialog";
import ABReport from "./components/ABReport";
import BrandTermsModal from "./components/BrandTermsModal";
import TriggersPanel from "./components/TriggersPanel";
import ProductGallery from "./components/ProductGallery";
import Onboarding from "./components/Onboarding";
import UserMenu from "./components/UserMenu";
import KnowledgePanel from "./components/KnowledgePanel";
import GlossaryModal from "./components/GlossaryModal";
import VersionPanel from "./components/VersionPanel";
import RunCompare from "./components/RunCompare";
import CommandPalette, { type CommandItem } from "./components/CommandPalette";
import { api, DuplicateGraphNameError } from "./lib/api";
import { useToast } from "./store/toast";
import { getTemplate } from "@agent-world/core";
import { useGraph } from "./store/graph";
import { useRun } from "./store/run";

/** How often the HUD badge re-counts runs waiting on a human. */
const REVIEW_POLL_MS = 20_000;

export default function App() {
  const { t } = useTranslation();
  const {
    graph,
    setGraph,
    addNode,
    flushSave,
    undo,
    redo,
    selectedId,
    updateGraphVariables,
    inspectorOpen,
  } = useGraph();
  const { connect, reset, runId, loadRun } = useRun();
  const runStatus = useRun((s) => s.live.status);

  const [mode, setMode] = useState<Mode>("select");
  const [budget, setBudget] = useState(0.01);
  const [rawMaterial, setRawMaterial] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [canRun, setCanRun] = useState(false);
  /** Pop a center-screen error toast with a one-click copy button. */
  const showError = (msg: string) => {
    useToast.getState().show(msg, { ttlMs: 6000 });
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newGraphOpen, setNewGraphOpen] = useState(false);
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<GraphSummary | null>(null);
  const [controlCollapsed, setControlCollapsed] = useState(false);
  // 默认收起，与"无选中节点"状态一致——初始展开会在刷新首帧闪一下又被
  // selectedId effect 收起（下方 421-424 行），造成"出现又收起"的视觉闪烁。
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const saved = localStorage.getItem("inspector-width");
    return saved ? Number(saved) : 420;
  });
  const dragging = useRef(false);
  const dragWidth = useRef(420);
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      dragWidth.current = inspectorWidth;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const w = Math.min(720, Math.max(280, window.innerWidth - ev.clientX));
        dragWidth.current = w;
        setInspectorWidth(w);
      };
      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        localStorage.setItem("inspector-width", String(dragWidth.current));
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [inspectorWidth],
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  /** Runs parked on a human decision across every line — the HUD badge. */
  const [pendingReviews, setPendingReviews] = useState(0);
  const [modelAssignOpen, setModelAssignOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [abOpen, setABOpen] = useState(false);
  const [abGroup, setABGroup] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [triggersOpen, setTriggersOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [graphsReady, setGraphsReady] = useState(false);

  /** Case-insensitive, trimmed duplicate check across the local graph list. */
  const nameTaken = (name: string, excludeId?: string): GraphSummary | null => {
    const target = name.trim().toLowerCase();
    if (!target) return null;
    return (
      graphs.find(
        (g) => g.id !== excludeId && g.name.trim().toLowerCase() === target,
      ) ?? null
    );
  };

  /** Surface a friendly "name already used" message and bail. */
  const reportDuplicate = (
    name: string,
    dup: { name: string } | null,
  ): boolean => {
    if (!dup) return false;
    showError(`已存在同名产线「${name}」，请换一个名字。`);
    return true;
  };

  const tipsEnabled = useTips((s) => s.enabled);
  const toggleTips = useTips((s) => s.toggle);
  const bothCollapsed = controlCollapsed && inspectorCollapsed;
  const toggleBoth = () => {
    const next = !bothCollapsed;
    setControlCollapsed(next);
    setInspectorCollapsed(next);
  };

  const MODALITY_PROMPT_LABEL: Record<string, string> = {
    text: "文本",
    image: "图片",
    video: "视频",
    audio: "音频",
    embedding: "向量",
  };

  /** Soft warning when the user adds a node whose modality has no configured
   *  model. Adding still succeeds (model is left empty); dispatch is the
   *  gatekeeper that will refuse to run a graph with empty models. */
  const addNodeOrReport = (
    kind: Parameters<typeof addNode>[0],
    x: number,
    y: number,
  ) => {
    const r = addNode(kind, x, y);
    if (r.missingModality) {
      const label = MODALITY_PROMPT_LABEL[r.missingModality] ?? "对应";
      showError(
        `该节点需要${label}模型，但当前没有配置；节点已添加，请在「模型设置」中添加后再派发。`,
      );
    }
  };

  const commandItems: CommandItem[] = [
    // 节点
    {
      id: "add-source",
      label: "添加原料台",
      hint: "产线投料入口（原料台）",
      group: "node",
      onSelect: () => addNodeOrReport("source", 300, 360),
    },
    {
      id: "add-textgen",
      label: "添加文坊",
      hint: "LLM 文本生成（文坊），可挂技能卡",
      group: "node",
      onSelect: () => addNodeOrReport("textGen", 300, 480),
    },
    {
      id: "add-gate",
      label: "添加质检站",
      hint: "LLM-as-judge 质量检验门（质检站）",
      group: "node",
      onSelect: () => addNodeOrReport("gate", 500, 480),
    },
    {
      id: "add-image",
      label: "添加画坊",
      hint: "文字生成图片",
      group: "node",
      onSelect: () => addNodeOrReport("imageGen", 300, 600),
    },
    {
      id: "add-http",
      label: "添加 API 口岸",
      hint: "调用外部 REST API（API 口岸）",
      group: "node",
      onSelect: () => addNodeOrReport("http", 300, 720),
    },
    {
      id: "add-sink",
      label: "添加成品库",
      hint: "产线产物出口（成品库）",
      group: "node",
      onSelect: () => addNodeOrReport("sink", 300, 840),
    },
    {
      id: "add-video",
      label: "添加影坊",
      hint: "文字生成视频",
      group: "node",
      onSelect: () => addNodeOrReport("videoGen", 300, 720),
    },
    {
      id: "add-audio",
      label: "添加音坊",
      hint: "文字生成语音/音乐",
      group: "node",
      onSelect: () => addNodeOrReport("audioGen", 300, 840),
    },
    {
      id: "new-graph",
      label: "新建产线",
      hint: "从模板或空白创建",
      group: "node",
      onSelect: () => setNewGraphOpen(true),
    },
    // 查看
    {
      id: "history",
      label: "运行历史",
      hint: "查看、加载、删除",
      group: "view",
      onSelect: () => setHistoryOpen(true),
    },
    {
      id: "reviews",
      label: t("reviews:command.label"),
      hint: t("reviews:command.hint"),
      group: "view",
      onSelect: () => setReviewOpen(true),
    },
    {
      id: "cost",
      label: "成本报表",
      hint: "按产线 / 文坊 / 日期拆解",
      group: "view",
      onSelect: () => setCostOpen(true),
    },
    {
      id: "eval",
      label: "质量评估",
      hint: "通过率 / 返工 / 时长",
      group: "view",
      onSelect: () => setEvalOpen(true),
    },
    {
      id: "gallery",
      label: "成品库",
      hint: "跨运行产出物画廊",
      group: "view",
      onSelect: () => setGalleryOpen(true),
    },
    {
      id: "glossary",
      label: "术语对照表",
      hint: "标准术语 ⇄ Agent World 用词",
      group: "view",
      onSelect: () => setGlossaryOpen(true),
    },
    {
      id: "compare",
      label: "运行对比",
      hint: "两次运行的成本与节点输出",
      group: "view",
      onSelect: () => setCompareOpen(true),
    },
    // 自动化
    {
      id: "triggers",
      label: "触发器",
      hint: "Webhook / 定时 / 事件 / 批量",
      group: "automation",
      onSelect: () => setTriggersOpen(true),
    },
    {
      id: "ab",
      label: "A/B 实验",
      hint: "同一节点多套 prompt 对比",
      group: "automation",
      onSelect: () => setABOpen(true),
    },
    // 管理
    {
      id: "settings",
      label: "设置",
      hint: "Provider / 模型 / 单价 / 月度预算",
      group: "manage",
      onSelect: () => setSettingsOpen(true),
    },
    {
      id: "model-assign",
      label: "模型分配",
      hint: "按模态批量切换当前产线节点的模型",
      group: "manage",
      onSelect: () => setModelAssignOpen(true),
    },
    {
      id: "brand",
      label: "品牌词库",
      hint: "可一键载入到文坊",
      group: "manage",
      onSelect: () => setBrandOpen(true),
    },
    {
      id: "knowledge",
      label: "知识库",
      hint: "历史产线产出与质检结论",
      group: "manage",
      onSelect: () => setKnowledgeOpen(true),
    },
    {
      id: "version",
      label: "产线版本",
      hint: "快照 / 恢复",
      group: "manage",
      onSelect: () => setVersionOpen(true),
    },
    {
      id: "variables",
      label: "产线变量",
      hint: "跨运行持久化状态（${var.xxx} / set_variable）",
      group: "manage",
      onSelect: () => setVariablesOpen(true),
    },
    // 画布
    {
      id: "undo",
      label: "撤销",
      group: "canvas",
      shortcut: "⌘Z",
      onSelect: () => undo(),
    },
    {
      id: "redo",
      label: "重做",
      group: "canvas",
      shortcut: "⇧⌘Z",
      onSelect: () => redo(),
    },
    {
      id: "toggle-panels",
      label: bothCollapsed ? "展开侧栏" : "收起侧栏",
      group: "canvas",
      onSelect: toggleBoth,
    },
    {
      id: "toggle-tips",
      label: tipsEnabled ? "关闭文坊悬停信息" : "开启文坊悬停信息",
      group: "canvas",
      shortcut: "T",
      onSelect: toggleTips,
    },
  ];

  const refreshGraphs = useCallback(async () => {
    try {
      const list = await api.listGraphs();
      setGraphs(list);
      return list;
    } catch (e) {
      showError(String(e));
      return [];
    }
  }, []);

  /** Only the count is read here; the queue itself fetches the rows. */
  const refreshPendingReviews = useCallback(() => {
    api
      .listPendingReviews({ limit: 1 })
      .then((d) => setPendingReviews(d.total))
      // The badge is cosmetic: a failed poll must not toast every 20s.
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshPendingReviews();
    const timer = setInterval(refreshPendingReviews, REVIEW_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshPendingReviews]);

  // A run halting on the canvas lights the badge at once instead of at the next poll.
  useEffect(() => {
    if (runStatus === "halted") refreshPendingReviews();
  }, [runStatus, refreshPendingReviews]);

  const switchGraph = useCallback(
    async (id: string) => {
      if (id === graph.id) return;
      await flushSave();
      reset();
      try {
        const g = await api.getGraph(id);
        setGraph(g);
        useGraph.temporal.getState().clear();
        /* toast cleared by the producer */
      } catch (e) {
        showError(String(e));
      }
    },
    [graph.id, flushSave, reset, setGraph],
  );

  const createGraph = useCallback(
    async (template?: string, fieldValues?: Record<string, string>) => {
      if (template) {
        const tpl = getTemplate(template);
        if (tpl && nameTaken(tpl.name))
          return reportDuplicate(
            tpl.name,
            graphs.find(
              (g) =>
                g.name.trim().toLowerCase() === tpl.name.trim().toLowerCase(),
            ) ?? null,
          );
      }
      try {
        const g = await api.createGraph(
          template ? { template, fieldValues } : undefined,
        );
        await refreshGraphs();
        reset();
        setGraph(g);
        useGraph.temporal.getState().clear();
      } catch (e) {
        if (e instanceof DuplicateGraphNameError) {
          showError(e.message);
          await refreshGraphs();
          return;
        }
        showError(String(e));
      }
    },
    [refreshGraphs, reset, setGraph, graphs, nameTaken],
  );

  const duplicateGraph = useCallback(
    async (id: string) => {
      try {
        const g = await api.createGraph({ from: id });
        await refreshGraphs();
        reset();
        setGraph(g);
        useGraph.temporal.getState().clear();
      } catch (e) {
        if (e instanceof DuplicateGraphNameError) {
          showError(e.message);
          await refreshGraphs();
          return;
        }
        showError(String(e));
      }
    },
    [refreshGraphs, reset, setGraph],
  );

  const renameGraph = useCallback(
    async (id: string, name: string) => {
      const dup = nameTaken(name, id);
      if (dup) return reportDuplicate(name, dup);
      try {
        if (id === graph.id) {
          setGraph({ ...graph, name });
          await flushSave();
        } else {
          const g = await api.getGraph(id);
          await api.saveGraph({ ...g, name });
        }
        await refreshGraphs();
      } catch (e) {
        if (e instanceof DuplicateGraphNameError) {
          showError(e.message);
          await refreshGraphs();
          return;
        }
        showError(String(e));
      }
    },
    [graph, refreshGraphs, setGraph, flushSave, nameTaken],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await api.deleteGraph(targetId);
      let list = await refreshGraphs();
      if (targetId === graph.id) {
        if (list.length === 0) {
          let g: Graph;
          try {
            g = await api.createGraph();
          } catch (e) {
            if (e instanceof DuplicateGraphNameError) {
              showError(e.message);
              return;
            }
            throw e;
          }
          list = await refreshGraphs();
          reset();
          setGraph(g);
        } else {
          await switchGraph(list[0]!.id);
        }
      }
      useGraph.temporal.getState().clear();
    } catch (e) {
      showError(String(e));
    }
  }, [deleteTarget, graph.id, refreshGraphs, reset, setGraph, switchGraph]);

  useEffect(() => {
    refreshGraphs()
      .then((list) => {
        if (list.length > 0) {
          api
            .getGraph(list[0]!.id)
            .then((g) => {
              setGraph(g);
              useGraph.temporal.getState().clear();
            })
            .catch((e) => showError(String(e)));
        }
      })
      .finally(() => setGraphsReady(true));
  }, [refreshGraphs, setGraph]);

  // The compiler is dependency-free, so diagnostics could run locally; going
  // through the server keeps one implementation authoritative while we settle it.
  useEffect(() => {
    if (graph.nodes.length === 0) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .compile(graph)
        .then((r) => {
          if (cancelled) return;
          setDiagnostics(r.diagnostics);
          setCanRun(r.plan !== null);
        })
        .catch((e) => {
          if (cancelled) return;
          setDiagnostics([
            {
              severity: "error",
              message: `编译检查请求失败（${e}），请刷新页面重试`,
            },
          ]);
          setCanRun(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [graph]);

  // 4B.4: collect form-connector fields from every source node, if any.
  const collectFormFields = useCallback((): FormField[] => {
    const out: FormField[] = [];
    for (const n of graph.nodes) {
      if (n.kind === "source" && n.source?.connector?.type === "form") {
        out.push(...(n.source.connector.form?.fields ?? []));
      }
    }
    return out;
  }, [graph]);

  const [formFields, setFormFields] = useState<FormField[] | null>(null);

  const startRunWith = useCallback(
    async (connectorValues?: Record<string, string>) => {
      try {
        /* toast cleared by the producer */ reset();
        await api.saveGraph(graph);
        const { runId: id } = await api.startRun(
          graph.id,
          budget,
          rawMaterial.trim() || undefined,
          connectorValues,
        );
        connect(id);
      } catch (e) {
        showError(String(e));
      }
    },
    [graph, budget, rawMaterial, connect, reset],
  );

  const onRun = useCallback(() => {
    const fields = collectFormFields();
    if (fields.length) {
      setFormFields(fields);
      return;
    }
    void startRunWith();
  }, [collectFormFields, startRunWith]);

  const onFormSubmit = useCallback(
    (values: Record<string, string>) => {
      setFormFields(null);
      void startRunWith(values);
    },
    [startRunWith],
  );

  const onCancel = useCallback(async () => {
    if (runId) await api.cancelRun(runId).catch(() => undefined);
  }, [runId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // The Inspector panel is opened by an explicit canvas click
  // (store.inspectorOpen, see Canvas.onPointerUp), not by selection alone —
  // otherwise dragging a node into place would pop the panel open too.
  // Deselecting still collapses the panel.
  useEffect(() => {
    if (!selectedId) setInspectorCollapsed(true);
  }, [selectedId]);

  useEffect(() => {
    if (inspectorOpen) {
      setInspectorCollapsed(false);
      useGraph.getState().setInspectorOpen(false);
    }
  }, [inspectorOpen]);

  return (
    <>
      {graphsReady && graphs.length === 0 && (
        <Onboarding onCreate={createGraph} />
      )}
      <div className="app">
        <header className="hud">
          <div className="hud__brand">
            <Logo />
            <span className="hud__brand-text">
              AGENT<span>WORLD</span>
            </span>
          </div>
          <div className="hud__meta">
            <GraphSwitcher
              graphs={graphs}
              currentId={graph.id}
              onSwitch={switchGraph}
              onCreate={() => setNewGraphOpen(true)}
              onDuplicate={duplicateGraph}
              onDelete={(id) =>
                setDeleteTarget(graphs.find((g) => g.id === id) ?? null)
              }
              onRename={renameGraph}
            />
            <span className="muted">
              {graph.nodes.length > 0
                ? Object.entries(
                    graph.nodes.reduce<Record<string, number>>((acc, n) => {
                      acc[n.kind] = (acc[n.kind] ?? 0) + 1;
                      return acc;
                    }, {}),
                  )
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => {
                      const key = KIND_KEY[k as keyof typeof KIND_KEY];
                      return `${v} ${key ? t(key) : k}`;
                    })
                    .join(" · ")
                : "0 节点"}
            </span>
            <span className="muted">{graph.edges.length} 条管道</span>
          </div>
          <div className="hud__actions">
            <div className="hud__undo-redo">
              <UndoRedo />
            </div>
            <Tooltip content={bothCollapsed ? "展开全部侧栏" : "收起全部侧栏"}>
              <button className="chip stage__panel-toggle" onClick={toggleBoth}>
                {bothCollapsed ? "展开侧栏" : "收起侧栏"}
              </button>
            </Tooltip>
            <Tooltip
              content={`文坊悬停信息：${tipsEnabled ? "开" : "关"}（快捷键 T 切换）`}
            >
              <button
                className={`chip ${tipsEnabled ? "" : "chip--muted"}`}
                onClick={toggleTips}
              >
                提示
              </button>
            </Tooltip>
            <Tooltip content={t("reviews:nav.tooltip")}>
              <button
                className="chip"
                onClick={() => setReviewOpen(true)}
                aria-label={
                  pendingReviews > 0
                    ? t("reviews:nav.badge", { n: pendingReviews })
                    : t("reviews:nav.label")
                }
              >
                {t("reviews:nav.label")}
                {pendingReviews > 0 && (
                  <span className="chip__badge">{pendingReviews}</span>
                )}
              </button>
            </Tooltip>
            <Tooltip content="跨运行成品库：查看所有产线的历史产出，无需派发任务">
              <button className="chip" onClick={() => setGalleryOpen(true)}>
                成品库
              </button>
            </Tooltip>
            <Tooltip content="术语对照表：标准术语 ⇄ Agent World 用词">
              <button className="chip" onClick={() => setGlossaryOpen(true)}>
                术语表
              </button>
            </Tooltip>
            <ShortcutsHelp />
            <Tooltip content="打开命令面板：弹窗、添加节点、画布动作">
              <button
                className="chip hud__menu"
                onClick={() => setPaletteOpen(true)}
                aria-label="打开命令面板"
              >
                菜单 <kbd className="kbd-inline">⌘K</kbd>
              </button>
            </Tooltip>
            <UserMenu />
          </div>
        </header>

        <div
          className={`workspace ${controlCollapsed ? "workspace--control-collapsed" : ""}`}
        >
          <ControlPanel
            mode={mode}
            setMode={setMode}
            budget={budget}
            setBudget={setBudget}
            rawMaterial={rawMaterial}
            setRawMaterial={setRawMaterial}
            diagnostics={diagnostics}
            canRun={canRun}
            onRun={onRun}
            onCancel={onCancel}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHistory={() => setHistoryOpen(true)}
            onOpenModelAssign={() => setModelAssignOpen(true)}
          />

          <main className="stage">
            <div className="canvas-toolbar-row">
              <CanvasToolbar onError={showError} />
            </div>
            <Timeline />
            <FailurePanel onRerun={onRun} />
            <Canvas mode={mode} />
            <button
              className={`stage__control-toggle ${controlCollapsed ? "is-collapsed" : ""}`}
              onClick={() => setControlCollapsed((v) => !v)}
              title={controlCollapsed ? "展开控制面板" : "收起控制面板"}
            >
              {controlCollapsed ? "›" : "‹"}
            </button>
            <button
              className={`stage__inspector-toggle ${inspectorCollapsed ? "is-collapsed" : ""}`}
              style={
                inspectorCollapsed
                  ? undefined
                  : { right: `${inspectorWidth}px` }
              }
              onClick={() => setInspectorCollapsed((v) => !v)}
              title={inspectorCollapsed ? "展开详情" : "收起详情"}
            >
              {inspectorCollapsed ? "‹" : "›"}
            </button>
            <Minimap />
            <div
              className={`inspector-slot ${inspectorCollapsed ? "inspector-slot--hidden" : ""}`}
              style={
                {
                  "--inspector-width": `${inspectorWidth}px`,
                } as React.CSSProperties
              }
            >
              <div
                className="inspector-drag-handle"
                onMouseDown={onDragStart}
              />
              <Inspector onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          </main>
        </div>

        <RunHistory
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onOpen={(id) => {
            setHistoryOpen(false);
            void loadRun(id);
          }}
        />
        <ReviewQueue
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          onOpenRun={(id) => {
            setReviewOpen(false);
            void loadRun(id);
          }}
          onChanged={refreshPendingReviews}
        />
        <ModelAssignModal
          open={modelAssignOpen}
          onClose={() => setModelAssignOpen(false)}
          onOpenSettings={() => {
            setModelAssignOpen(false);
            setSettingsOpen(true);
          }}
        />
        <CostReport open={costOpen} onClose={() => setCostOpen(false)} />
        <EvalReport
          open={evalOpen}
          onClose={() => setEvalOpen(false)}
          graphId={graph.id}
        />
        <ABDialog
          open={abOpen}
          graph={graph}
          onClose={() => setABOpen(false)}
          onLaunched={(gid) => {
            setABOpen(false);
            setABGroup(gid);
          }}
        />
        <ABReport
          open={abGroup !== null}
          groupId={abGroup ?? ""}
          onClose={() => setABGroup(null)}
        />
        <ProductGallery
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
        />
        <BrandTermsModal open={brandOpen} onClose={() => setBrandOpen(false)} />
        <TriggersPanel
          open={triggersOpen}
          onClose={() => setTriggersOpen(false)}
          graphId={graph.id}
        />
        <KnowledgePanel
          open={knowledgeOpen}
          onClose={() => setKnowledgeOpen(false)}
        />
        <GlossaryModal
          open={glossaryOpen}
          onClose={() => setGlossaryOpen(false)}
        />
        <VariablesModal
          open={variablesOpen}
          variables={graph.variables}
          onClose={() => setVariablesOpen(false)}
          onSave={updateGraphVariables}
        />
        <VersionPanel
          open={versionOpen}
          graphId={graph.id}
          graphName={graph.name}
          onClose={() => setVersionOpen(false)}
          onRestored={() => {
            void refreshGraphs();
            setTimeout(() => window.location.reload(), 300);
          }}
        />
        <RunCompare
          open={compareOpen}
          graphId={graph.id}
          onClose={() => setCompareOpen(false)}
        />
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          items={commandItems}
        />
        {formFields && (
          <FormConnectorModal
            fields={formFields}
            onSubmit={onFormSubmit}
            onCancel={() => setFormFields(null)}
          />
        )}
        <Toast />
        <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <NewGraphDialog
          open={newGraphOpen}
          onClose={() => setNewGraphOpen(false)}
          onPick={(templateId, fieldValues) => {
            setNewGraphOpen(false);
            void createGraph(templateId, fieldValues);
          }}
        />
        <ConfirmDialog
          open={deleteTarget !== null}
          title="删除产线"
          description={
            deleteTarget
              ? `确定删除「${deleteTarget.name}」吗？该产线的所有运行记录不会被删除，但此操作不可撤销。`
              : ""
          }
          confirmLabel="删除"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </>
  );
}
