import { TEMPLATES, TEMPLATE_CATEGORIES } from "@agent-world/core";
import { useTranslation } from "react-i18next";
import Tooltip from "./Tooltip";

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
 *  grid renders even when the engine is slow or unreachable.
 *
 *  `tpl-blank` is intentionally excluded here: a blank canvas is offered as a
 *  dedicated first card (see `blankFirst`), not as a template entry. */
export const TEMPLATE_LIST: TemplatePreviewData[] = TEMPLATES.filter(
  (t) => t.id !== "tpl-blank",
).map((t) => ({
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
  const { t } = useTranslation();
  if (nodes.length === 0) {
    return (
      <div className="template-preview template-preview--empty">
        {t("modals:templatePicker.emptyPreview")}
      </div>
    );
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
      aria-label={t("modals:templatePicker.structurePreview")}
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
  /** Render a "blank line" card pinned first — above every category section.
   *  It is a plain empty canvas, not a template, so it carries no badge. */
  blankFirst?: boolean;
  /** templateId → localized title of its active targeted announcement
   *  (design-announcement P3): e.g. a deprecation notice pinned to the card. */
  alerts?: Record<string, string>;
}

export default function TemplatePicker({
  templates,
  onPick,
  cardClass,
  blankFirst,
  alerts = {},
}: PickerProps) {
  const { t } = useTranslation();
  const gridClass = `template-grid ${cardClass ? `template-grid--${cardClass}` : ""}`;
  const sections = TEMPLATE_CATEGORIES.map((cat) => ({
    cat,
    items: templates.filter((tpl) => tpl.category === cat),
  })).filter((s) => s.items.length > 0);
  return (
    <div className={`template-picker ${cardClass ? `template-picker--${cardClass}` : ""}`}>
      {blankFirst && (
        <button
          key="__blank__"
          className={`template-card template-card--blank ${cardClass ? `template-card--${cardClass}` : ""}`}
          onClick={() => onPick(undefined)}
        >
          <TemplatePreview nodes={[]} edges={[]} />
          <span className="template-card__name">
            {t("modals:templatePicker.blankGraph")}
          </span>
          <span className="template-card__desc">
            {t("modals:templatePicker.blankGraphDesc")}
          </span>
        </button>
      )}
      {sections.map((s) => (
        <section key={s.cat} className="template-section">
          <h3 className="template-section__title">
            {s.cat}
            <span className="template-section__count">{s.items.length}</span>
          </h3>
          <div className={gridClass}>
            {s.items.map((tpl) => {
              const alert = alerts[tpl.id];
              return (
                <button
                  key={tpl.id}
                  className={`template-card ${alert ? "template-card--alerted" : ""} ${cardClass ? `template-card--${cardClass}` : ""}`}
                  onClick={() => onPick(tpl.id)}
                >
                  <TemplatePreview nodes={tpl.nodes} edges={tpl.edges} />
                  <span className="template-card__name">{tpl.name}</span>
                  <span className="template-card__desc">{tpl.description}</span>
                  {alert && (
                    <Tooltip content={alert}>
                      <span className="template-card__alert">
                        {t("announcements:alerts.templateBadge")}
                      </span>
                    </Tooltip>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
