import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: { id: string; kind: string; x: number; y: number }[];
  edges: { from: string; to: string; kind?: string }[];
}

// Thumbnail colors per node kind (mirrors the canvas palette closely enough).
const NODE_COLORS: Record<string, string> = {
  sink: "#ef4444",
  gate: "#f59e0b",
  agent: "#3b82f6",
  input: "#22c55e",
  output: "#a855f7",
  router: "#64748b",
};

function TemplatePreview({
  nodes,
  edges,
}: {
  nodes: Template["nodes"];
  edges: Template["edges"];
}) {
  if (nodes.length === 0) {
    return <div className="template-preview template-preview--empty">无预览</div>;
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
  open: boolean;
  onClose: () => void;
  onPick: (templateId: string) => void;
}

export default function NewGraphDialog({ open, onClose, onPick }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    if (open) api.listTemplates().then(setTemplates).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>新建产线</h2>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="modal__body">
          <p className="form-hint">选择一个模板开始，或从空白产线搭建。</p>
          <div className="template-grid">
            {templates.map((t) => (
              <button
                key={t.id}
                className="template-card"
                onClick={() => {
                  onPick(t.id);
                }}
              >
                <TemplatePreview nodes={t.nodes} edges={t.edges} />
                <span className="template-card__name">{t.name}</span>
                <span className="template-card__desc">{t.description}</span>
                <span className="template-card__cat">{t.category}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
