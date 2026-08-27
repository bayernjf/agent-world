import { useMemo, useState } from "react";
import { TEMPLATES } from "@agent-world/core";
import { api } from "../lib/api";

interface TemplatePreview {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: { id: string; kind: string; x: number; y: number }[];
  edges: { from: string; to: string; kind?: string }[];
}

const NODE_COLORS: Record<string, string> = {
  sink: "#ef4444",
  gate: "#f59e0b",
  agent: "#3b82f6",
  source: "#22c55e",
  imageGen: "#a855f7",
  videoGen: "#ec4899",
  audioGen: "#14b8a6",
};

function TemplatePreview({ nodes, edges }: { nodes: TemplatePreview["nodes"]; edges: TemplatePreview["edges"] }) {
  if (nodes.length === 0) {
    return <div className="template-preview template-preview--empty">空白</div>;
  }
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const pad = 48;
  const w = Math.max(1, maxX - minX) + pad * 2;
  const h = Math.max(1, maxY - minY) + pad * 2;
  const pos = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg
      className="template-preview"
      viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="模板结构预览"
    >
      {edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="template-edge" />;
      })}
      {nodes.map((n) => (
        <rect
          key={n.id}
          x={n.x - 9}
          y={n.y - 9}
          width={18}
          height={18}
          rx={4}
          fill={NODE_COLORS[n.kind] ?? "#64748b"}
        />
      ))}
    </svg>
  );
}

interface Props {
  onCreate: (templateId?: string) => void;
}

export default function Onboarding({ onCreate }: Props) {
  // Read templates straight from the core package — no network round-trip,
  // so the grid renders even when the engine is slow or unreachable.
  const templates: TemplatePreview[] = useMemo(
    () =>
      TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        nodes: t.graph.nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y })),
        edges: t.graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
      })),
    [],
  );

  const [apiStatus, setApiStatus] = useState<"unknown" | "ok" | "fail">("unknown");
  // Probe the engine once so the user knows whether saved-state features will work.
  useMemo(() => {
    api
      .listGraphs()
      .then(() => setApiStatus("ok"))
      .catch(() => setApiStatus("fail"));
  }, []);

  return (
    <div className="onboarding">
      <div className="onboarding__content">
        <div className="onboarding__hero">
          <h1 className="onboarding__title">欢迎来到 Agent World</h1>
          <p className="onboarding__subtitle">
            用可视化的方式编排多 Agent 工作流。每个 Agent 是产线上的一个厂房，
            产出物通过管道在厂房间流动，质检站可以把不合格的工作打回重做。
          </p>
        </div>

        <div className="onboarding__section">
          <h2 className="onboarding__section-title">选择一个模板开始</h2>
          <p className="onboarding__section-hint">
            模板预置了节点和连线，创建后可自由编辑。共 {templates.length} 个模板。
          </p>

          <div className="template-grid template-grid--onboarding">
            {templates.map((t) => (
              <button
                key={t.id}
                className="template-card template-card--onboarding"
                onClick={() => onCreate(t.id)}
                title={t.description}
              >
                <TemplatePreview nodes={t.nodes} edges={t.edges} />
                <span className="template-card__name">{t.name}</span>
                <span className="template-card__desc">{t.description}</span>
                <span className="template-card__cat">{t.category}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="onboarding__divider">
          <span>或</span>
        </div>

        <div className="onboarding__actions">
          <button className="btn btn--primary btn--lg" onClick={() => onCreate()}>
            从空白产线开始
          </button>
        </div>

        <div className="onboarding__tips">
          <p>
            <strong>提示：</strong>
            运行产线前需要在设置（⚙️）中配置模型 Provider。未配置时会使用内置的假 Worker，
            适合熟悉界面和测试流程。
          </p>
          {apiStatus === "fail" && (
            <p className="onboarding__tip-warn">
              ⚠ 后端引擎未响应（http://localhost:8791）。点击创建时如失败，请先{" "}
              <code>pnpm --filter @agent-world/server dev</code> 启动后端。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
