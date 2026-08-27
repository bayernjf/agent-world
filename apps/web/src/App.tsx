import { useCallback, useEffect, useState } from "react";
import type { Diagnostic, FormConnector } from "@agent-world/core";

type FormField = FormConnector["fields"][number];
import Canvas, { type Mode } from "./canvas/Canvas";
import Minimap from "./canvas/Minimap";
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
import KnowledgePanel from "./components/KnowledgePanel";
import VersionPanel from "./components/VersionPanel";
import RunCompare from "./components/RunCompare";
import CommandPalette, { type CommandItem } from "./components/CommandPalette";
import { api } from "./lib/api";
import { useGraph } from "./store/graph";
import { useRun } from "./store/run";

export default function App() {
  const { graph, setGraph, addNode, flushSave, undo, redo } = useGraph();
  const { connect, reset, runId, loadRun } = useRun();

  const [mode, setMode] = useState<Mode>("select");
  const [budget, setBudget] = useState(0.01);
  const [rawMaterial, setRawMaterial] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [canRun, setCanRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newGraphOpen, setNewGraphOpen] = useState(false);
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<GraphSummary | null>(null);
  const [controlCollapsed, setControlCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [abOpen, setABOpen] = useState(false);
  const [abGroup, setABGroup] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [triggersOpen, setTriggersOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [graphsReady, setGraphsReady] = useState(false);
  const tipsEnabled = useTips((s) => s.enabled);
  const toggleTips = useTips((s) => s.toggle);
  const bothCollapsed = controlCollapsed && inspectorCollapsed;
  const toggleBoth = () => {
    const next = !bothCollapsed;
    setControlCollapsed(next);
    setInspectorCollapsed(next);
  };

  const commandItems: CommandItem[] = [
    // 节点
    { id: "add-agent", label: "添加厂房", hint: "Agent 节点", group: "节点", onSelect: () => addNode("agent", 300, 480) },
    { id: "add-gate", label: "添加质检站", hint: "Gate 节点", group: "节点", onSelect: () => addNode("gate", 500, 480) },
    { id: "add-image", label: "添加 AI 生图", hint: "ImageGen 节点", group: "节点", onSelect: () => addNode("imageGen", 300, 600) },
    { id: "new-graph", label: "新建产线", hint: "从模板或空白创建", group: "节点", onSelect: () => setNewGraphOpen(true) },
    // 查看
    { id: "history", label: "运行历史", hint: "查看、加载、删除", group: "查看", onSelect: () => setHistoryOpen(true) },
    { id: "cost", label: "成本报表", hint: "按产线 / 厂房 / 日期拆解", group: "查看", onSelect: () => setCostOpen(true) },
    { id: "eval", label: "质量评估", hint: "通过率 / 返工 / 时长", group: "查看", onSelect: () => setEvalOpen(true) },
    { id: "gallery", label: "成品库", hint: "跨运行产出物画廊", group: "查看", onSelect: () => setGalleryOpen(true) },
    { id: "compare", label: "运行对比", hint: "两次运行的成本与节点输出", group: "查看", onSelect: () => setCompareOpen(true) },
    // 自动化
    { id: "triggers", label: "触发器", hint: "Webhook / 定时 / 事件 / 批量", group: "自动化", onSelect: () => setTriggersOpen(true) },
    { id: "ab", label: "A/B 实验", hint: "同一节点多套 prompt 对比", group: "自动化", onSelect: () => setABOpen(true) },
    // 管理
    { id: "settings", label: "设置", hint: "Provider / 模型 / 单价 / 月度预算", group: "管理", onSelect: () => setSettingsOpen(true) },
    { id: "brand", label: "品牌词库", hint: "可一键载入到厂房", group: "管理", onSelect: () => setBrandOpen(true) },
    { id: "knowledge", label: "知识库", hint: "历史产线产出与质检结论", group: "管理", onSelect: () => setKnowledgeOpen(true) },
    { id: "version", label: "产线版本", hint: "快照 / 恢复", group: "管理", onSelect: () => setVersionOpen(true) },
    // 画布
    { id: "undo", label: "撤销", group: "画布", shortcut: "⌘Z", onSelect: () => undo() },
    { id: "redo", label: "重做", group: "画布", shortcut: "⇧⌘Z", onSelect: () => redo() },
    { id: "toggle-panels", label: bothCollapsed ? "展开侧栏" : "收起侧栏", group: "画布", onSelect: toggleBoth },
    { id: "toggle-tips", label: tipsEnabled ? "关闭厂房悬停信息" : "开启厂房悬停信息", group: "画布", shortcut: "T", onSelect: toggleTips },
  ];

  const refreshGraphs = useCallback(async () => {
    try {
      const list = await api.listGraphs();
      setGraphs(list);
      return list;
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const switchGraph = useCallback(
    async (id: string) => {
      if (id === graph.id) return;
      await flushSave();
      reset();
      try {
        const g = await api.getGraph(id);
        setGraph(g);
        useGraph.temporal.getState().clear();
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [graph.id, flushSave, reset, setGraph],
  );

  const createGraph = useCallback(async (template?: string) => {
    try {
      const g = await api.createGraph(template ? { template } : undefined);
      await refreshGraphs();
      reset();
      setGraph(g);
      useGraph.temporal.getState().clear();
    } catch (e) {
      setError(String(e));
    }
  }, [refreshGraphs, reset, setGraph]);

  const duplicateGraph = useCallback(
    async (id: string) => {
      try {
        const g = await api.createGraph({ from: id });
        await refreshGraphs();
        reset();
        setGraph(g);
        useGraph.temporal.getState().clear();
      } catch (e) {
        setError(String(e));
      }
    },
    [refreshGraphs, reset, setGraph],
  );

  const renameGraph = useCallback(
    async (id: string, name: string) => {
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
        setError(String(e));
      }
    },
    [graph, refreshGraphs, setGraph, flushSave],
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
          const g = await api.createGraph();
          list = await refreshGraphs();
          reset();
          setGraph(g);
        } else {
          await switchGraph(list[0]!.id);
        }
      }
      useGraph.temporal.getState().clear();
    } catch (e) {
      setError(String(e));
    }
  }, [deleteTarget, graph.id, refreshGraphs, reset, setGraph, switchGraph]);

  useEffect(() => {
    refreshGraphs().then((list) => {
      if (list.length > 0) {
        api
          .getGraph(list[0]!.id)
          .then((g) => {
            setGraph(g);
            useGraph.temporal.getState().clear();
          })
          .catch((e) => setError(String(e)));
      }
    }).finally(() => setGraphsReady(true));
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
        .catch(() => undefined);
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
        setError(null);
        reset();
        await api.saveGraph(graph);
        const { runId: id } = await api.startRun(
          graph.id,
          budget,
          rawMaterial.trim() || undefined,
          connectorValues,
        );
        connect(id);
      } catch (e) {
        setError(String(e));
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
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
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
          <span className="muted">{graph.nodes.length} 座厂房</span>
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
          <Tooltip content={`厂房悬停信息：${tipsEnabled ? "开" : "关"}（快捷键 T 切换）`}>
            <button
              className={`chip ${tipsEnabled ? "" : "chip--muted"}`}
              onClick={toggleTips}
            >
              提示
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
        </div>
      </header>

      {error && <p className="banner">{error}</p>}

      <div
        className={`workspace ${controlCollapsed ? "workspace--control-collapsed" : ""} ${
          inspectorCollapsed ? "workspace--inspector-collapsed" : ""
        }`}
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
        />

        <main className="stage">
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
            onClick={() => setInspectorCollapsed((v) => !v)}
            title={inspectorCollapsed ? "展开详情" : "收起详情"}
          >
            {inspectorCollapsed ? "›" : "‹"}
          </button>
          <Minimap />
        </main>

        <div className={`inspector-slot ${inspectorCollapsed ? "is-collapsed" : ""}`}>
          <Inspector />
        </div>
      </div>

      <RunHistory
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onOpen={(id) => {
          setHistoryOpen(false);
          void loadRun(id);
        }}
      />
      <CostReport open={costOpen} onClose={() => setCostOpen(false)} />
      <EvalReport open={evalOpen} onClose={() => setEvalOpen(false)} graphId={graph.id} />
      <ABDialog
        open={abOpen}
        graph={graph}
        onClose={() => setABOpen(false)}
        onLaunched={(gid) => {
          setABOpen(false);
          setABGroup(gid);
        }}
      />
      <ABReport open={abGroup !== null} groupId={abGroup ?? ""} onClose={() => setABGroup(null)} />
      <ProductGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} />
      <BrandTermsModal open={brandOpen} onClose={() => setBrandOpen(false)} />
      <TriggersPanel open={triggersOpen} onClose={() => setTriggersOpen(false)} graphId={graph.id} />
      <KnowledgePanel open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} />
      <VersionPanel
        open={versionOpen}
        graphId={graph.id}
        graphName={graph.name}
        onClose={() => setVersionOpen(false)}
        onRestored={() => { void refreshGraphs(); setTimeout(() => window.location.reload(), 300); }}
      />
      <RunCompare open={compareOpen} graphId={graph.id} onClose={() => setCompareOpen(false)} />
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
        onPick={(templateId) => {
          setNewGraphOpen(false);
          void createGraph(templateId);
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
