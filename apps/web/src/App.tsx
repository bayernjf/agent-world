import { useCallback, useEffect, useState } from "react";
import type { Diagnostic } from "@agent-world/core";
import Canvas, { type Mode } from "./canvas/Canvas";
import ControlPanel from "./components/ControlPanel";
import Inspector from "./components/Inspector";
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
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [canRun, setCanRun] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const { runId: id } = await api.startRun(GRAPH_ID, budget);
      connect(id);
    } catch (e) {
      setError(String(e));
    }
  }, [graph, budget, connect, reset]);

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
          AGENT<span>WORLD</span>
        </div>
        <div className="hud__meta">
          <span>{graph.name}</span>
          <span className="muted">{graph.nodes.length} 座厂房</span>
          <span className="muted">{graph.edges.length} 条管道</span>
        </div>
        <div className="hud__actions">
          <button className="chip" onClick={() => addNode("agent", 300, 480)}>
            + 厂房
          </button>
          <button className="chip" onClick={() => addNode("gate", 500, 480)}>
            + 质检站
          </button>
        </div>
      </header>

      {error && <p className="banner">{error}</p>}

      <div className="workspace">
        <ControlPanel
          mode={mode}
          setMode={setMode}
          budget={budget}
          setBudget={setBudget}
          diagnostics={diagnostics}
          canRun={canRun}
          onRun={onRun}
          onCancel={onCancel}
        />

        <main className="stage">
          <Canvas mode={mode} />
          <Timeline />
        </main>

        <Inspector />
      </div>
    </div>
  );
}
