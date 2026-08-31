import { TEMPLATES } from "@agent-world/core";

/**
 * Shared template preview + grid used by both the first-run Onboarding and
 * the NewGraphDialog, so the two never drift apart.
 */

/** Slim copy of core's TemplateField — no applyTo plumbing, just form metadata. */
export interface TemplateFieldData {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
}

export interface TemplatePreviewData {
  id: string;
  name: string;
  description: string;
  category: string;
  fields: TemplateFieldData[];
  nodes: { id: string; kind: string; x: number; y: number }[];
  edges: { from: string; to: string; kind?: string }[];
}

/** Template list read straight from core — no network round-trip, so the
 *  grid renders even when the engine is slow or unreachable. */
export const TEMPLATE_LIST: TemplatePreviewData[] = TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  category: t.category,
  fields: (t.fields ?? []).map((f) => ({
    key: f.key,
    label: f.label,
    placeholder: f.placeholder,
    defaultValue: f.defaultValue,
  })),
  nodes: t.graph.nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y })),
  edges: t.graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
}));

// Thumbnail colors per node kind (mirrors the canvas palette closely enough).
const NODE_COLORS: Record<string, string> = {
  sink: "#ef4444",
  gate: "#f59e0b",
  textGen: "#3b82f6",
  source: "#22c55e",
  imageGen: "#a855f7",
  videoGen: "#ec4899",
  audioGen: "#14b8a6",
  code: "#eab308",
  http: "#06b6d4",
  branch: "#f97316",
  notify: "#8b5cf6",
};

export function TemplatePreview({
  nodes,
  edges,
}: {
  nodes: TemplatePreviewData["nodes"];
  edges: TemplatePreviewData["edges"];
}) {
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

interface PickerProps {
  templates: TemplatePreviewData[];
  onPick: (templateId?: string) => void;
  /** Extra class on each card (onboarding uses larger cards). */
  cardClass?: string;
}

export default function TemplatePicker({ templates, onPick, cardClass }: PickerProps) {
  return (
    <div className={`template-grid ${cardClass ? `template-grid--${cardClass}` : ""}`}>
      {templates.map((t) => (
        <button
          key={t.id}
          className={`template-card ${cardClass ? `template-card--${cardClass}` : ""}`}
          onClick={() => onPick(t.id)}
          title={t.description}
        >
          <TemplatePreview nodes={t.nodes} edges={t.edges} />
          <span className="template-card__name">{t.name}</span>
          <span className="template-card__desc">{t.description}</span>
          <span className="template-card__cat">{t.category}</span>
        </button>
      ))}
    </div>
  );
}
