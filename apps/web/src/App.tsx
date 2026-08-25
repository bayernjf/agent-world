import { useCallback, useEffect, useState } from "react";
import type { Diagnostic } from "@agent-world/core";
import Canvas, { type Mode } from "./canvas/Canvas";
import Minimap from "./canvas/Minimap";
import ControlPanel from "./components/ControlPanel";
import Inspector from "./components/Inspector";
import Logo from "./components/Logo";
import Settings from "./components/Settings";
import ShortcutsHelp from "./components/ShortcutsHelp";
import UndoRedo from "./components/UndoRedo";
import Toast from "./components/Toast";
import Timeline from "./components/Timeline";
import { api } from "./lib/api";
import { useGraph } from "./store/graph";
import { useRun } from "./store/run";

const GRAPH_ID = "seed";

export default function App() {
  const { graph, setGraph, addNode } = useGraph();
  const { connect, reset, runId } = useRun();

  const [mode, setMode] = useState<Mode>("select");
  const [budget, setBudget] = useState(0.01);
  const [rawMaterial, setRawMaterial] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [canRun, setCanRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlCollapsed, setControlCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const bothCollapsed = controlCollapsed && inspectorCollapsed;
  const toggleBoth = () => {
    const next = !bothCollapsed;
    setControlCollapsed(next);
    setInspectorCollapsed(next);
  };

  useEffect(() => {
    api.getGraph(GRAPH_ID).then(setGraph).catch((e) => setError(String(e)));
  }, [setGraph]);

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
      const { runId: id } = await api.startRun(GRAPH_ID, budget, rawMaterial.trim() || undefined);
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
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        const t = useGraph.temporal.getState();
        if (e.shiftKey) t.redo();
        else t.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          <span>{graph.name}</span>
          <span className="muted">{graph.nodes.length} 座厂房</span>
          <span className="muted">{graph.edges.length} 条管道</span>
        </div>
        <div className="hud__actions">
          <ShortcutsHelp />
          <button className="chip" onClick={() => addNode("agent", 300, 480)}>
            + 厂房
          </button>
          <button className="chip" onClick={() => addNode("gate", 500, 480)}>
            + 质检站
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
          <div className="stage__topbar">
            <UndoRedo />
          </div>
          <Canvas mode={mode} />
          <Timeline />
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
          <button
            className="stage__panel-toggle"
            onClick={toggleBoth}
            title={bothCollapsed ? "展开全部侧栏" : "收起全部侧栏"}
          >
            {bothCollapsed ? "展开侧栏" : "收起侧栏"}
          </button>
          <Minimap />
        </main>

        <div className={`inspector-slot ${inspectorCollapsed ? "is-collapsed" : ""}`}>
          <Inspector />
        </div>
      </div>

      <Toast />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
