import { useCallback, useEffect, useState } from "react";
import type { Diagnostic } from "@agent-world/core";
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
import CostReport from "./components/CostReport";
import EvalReport from "./components/EvalReport";
import ABDialog from "./components/ABDialog";
import ABReport from "./components/ABReport";
import BrandTermsModal from "./components/BrandTermsModal";
import ProductGallery from "./components/ProductGallery";
import { api } from "./lib/api";
import { useGraph } from "./store/graph";
import { useRun } from "./store/run";

export default function App() {
  const { graph, setGraph, addNode, flushSave, undo, redo } = useGraph();
  const { connect, reset, runId } = useRun();

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
  const tipsEnabled = useTips((s) => s.enabled);
  const toggleTips = useTips((s) => s.toggle);
  const bothCollapsed = controlCollapsed && inspectorCollapsed;
  const toggleBoth = () => {
    const next = !bothCollapsed;
    setControlCollapsed(next);
    setInspectorCollapsed(next);
  };

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
    });
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

  const onRun = useCallback(async () => {
    try {
      setError(null);
      reset();
      await api.saveGraph(graph);
      const { runId: id } = await api.startRun(graph.id, budget, rawMaterial.trim() || undefined);
      connect(id);
    } catch (e) {
      setError(String(e));
    }
  }, [graph, budget, rawMaterial, connect, reset]);

  const onCancel = useCallback(async () => {
    if (runId) await api.cancelRun(runId).catch(() => undefined);
  }, [runId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
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
          <Tooltip content="运行历史">
            <button className="chip" onClick={() => setHistoryOpen(true)}>
              历史
            </button>
          </Tooltip>
          <Tooltip content="成本报表">
            <button className="chip" onClick={() => setCostOpen(true)}>
              成本
            </button>
          </Tooltip>
          <Tooltip content="质量评估">
            <button className="chip" onClick={() => setEvalOpen(true)}>
              评估
            </button>
          </Tooltip>
          <Tooltip content="A/B 实验：同一厂房多套 prompt 对比择优">
            <button className="chip" onClick={() => setABOpen(true)}>
              A/B 实验
            </button>
          </Tooltip>
          <Tooltip content="品牌词库：维护建议融入的品牌词，可在厂房节点一键载入">
            <button className="chip" onClick={() => setBrandOpen(true)}>
              品牌词库
            </button>
          </Tooltip>
          <Tooltip content="成品库">
            <button className="chip" onClick={() => setGalleryOpen(true)}>
              成品
            </button>
          </Tooltip>
          <button className="chip" onClick={() => addNode("agent", 300, 480)}>
            + 厂房
          </button>
          <button className="chip" onClick={() => addNode("gate", 500, 480)}>
            + 质检站
          </button>
          <button className="chip" onClick={() => addNode("imageGen", 300, 600)}>
            + AI 生图
          </button>
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

      <RunHistory open={historyOpen} onClose={() => setHistoryOpen(false)} />
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
  );
}
