import { useState } from "react";
import type { Graph, GraphNode, NodeRuntime, RuntimeState } from "@agent-world/core";
import { PLANT_H, PLANT_W } from "../store/graph";
import { useCanvas } from "../store/canvas";

interface Props {
  graph: Graph;
  runtime: RuntimeState;
  selectedId: string | null;
  connectFrom: string | null;
  onPointerDown: (node: GraphNode, e: React.PointerEvent) => void;
}

const KIND_LABEL: Record<GraphNode["kind"], string> = {
  source: "投料口",
  agent: "厂房",
  gate: "质检站",
  sink: "成品仓",
};

const STATUS_LABEL: Record<NodeRuntime["status"], string> = {
  idle: "待机",
  running: "运行中",
  done: "完成",
  failed: "失败",
  scrapped: "已报废",
};

/** Maximum model-name characters before ellipsis; full name is in a <title>. */
const META_MAX = 20;

function truncate(text: string, max = META_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function statusClass(rt: NodeRuntime | undefined): string {
  if (!rt) return "is-idle";
  return `is-${rt.status}`;
}

interface TooltipLine {
  label: string;
  value: string;
}

export default function Plants({
  graph,
  runtime,
  selectedId,
  connectFrom,
  onPointerDown,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const zoom = useCanvas((s) => s.viewport.zoom);
  const fitScale = useCanvas((s) => s.fit.scale) || 1;
  // Counteract both the pan/zoom transform AND the SVG letterbox scale so the
  // nameplate stays at a constant readable size on screen at any zoom level.
  const tipScale = 1 / (zoom * fitScale);

  const hovered = hoveredId ? graph.nodes.find((n) => n.id === hoveredId) : null;
  const hoveredRt = hovered ? runtime.nodes[hovered.id] : undefined;

  const tooltipLines: TooltipLine[] = hovered
    ? [
        { label: "类型", value: KIND_LABEL[hovered.kind] },
        ...(hovered.agent?.model
          ? [{ label: "模型", value: hovered.agent.model }]
          : []),
        ...(hovered.kind === "gate"
          ? [{ label: "上限", value: `${hovered.gate?.maxAttempts ?? 3} 次` }]
          : []),
        ...(hoveredRt
          ? [
              { label: "状态", value: STATUS_LABEL[hoveredRt.status] ?? hoveredRt.status },
              ...(hoveredRt.attempt > 1
                ? [{ label: "返工", value: `${hoveredRt.attempt} 次` }]
                : []),
              ...(hoveredRt.tokensIn || hoveredRt.tokensOut
                ? [
                    {
                      label: "Token",
                      value: `${(hoveredRt.tokensIn ?? 0) + (hoveredRt.tokensOut ?? 0)}`,
                    },
                  ]
                : []),
              ...(hoveredRt.costUsd > 0
                ? [{ label: "电费", value: `$${hoveredRt.costUsd.toFixed(4)}` }]
                : []),
            ]
          : []),
      ]
    : [];

  return (
    <g className="plants">
      {graph.nodes.map((node) => {
        const rt = runtime.nodes[node.id];
        const x = node.x - PLANT_W / 2;
        const y = node.y - PLANT_H / 2;
        const attempt = rt?.attempt ?? 0;
        const model = node.agent?.model;

        return (
          <g
            key={node.id}
            className={[
              "plant",
              `plant--${node.kind}`,
              statusClass(rt),
              selectedId === node.id ? "is-selected" : "",
              connectFrom === node.id ? "is-connect-src" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            transform={`translate(${x} ${y})`}
            onPointerDown={(e) => onPointerDown(node, e)}
            onPointerEnter={() => setHoveredId(node.id)}
            onPointerLeave={() =>
              setHoveredId((current) => (current === node.id ? null : current))
            }
          >
            <rect className="plant__shadow" x={3} y={4} width={PLANT_W} height={PLANT_H} />
            <rect className="plant__body" width={PLANT_W} height={PLANT_H} />
            <rect className="plant__bar" width={PLANT_W} height={22} />

            <circle className="plant__led" cx={12} cy={11} r={3.5} />
            <text className="plant__kind" x={26} y={15}>
              {KIND_LABEL[node.kind]}
            </text>

            <text className="plant__name" x={12} y={48}>
              {node.name}
            </text>

            {node.kind === "agent" && model && (
              <text className="plant__meta" x={12} y={68}>
                {truncate(model)}
              </text>
            )}
            {node.kind === "gate" && (
              <text className="plant__meta" x={12} y={68}>
                上限 {node.gate?.maxAttempts ?? 3} 次
              </text>
            )}

            {/* attempt badge — the visible trace of a rework loop */}
            {attempt > 1 && (
              <g className="plant__attempt" transform={`translate(${PLANT_W - 30} 34)`}>
                <rect x={-14} y={-11} width={28} height={22} rx={3} />
                <text x={0} y={5}>
                  ×{attempt}
                </text>
              </g>
            )}

            {rt && rt.costUsd > 0 && (
              <g className="plant__cost-chip">
                <rect x={PLANT_W - 62} y={PLANT_H - 22} width={50} height={15} rx={2} />
                <text className="plant__cost" x={PLANT_W - 37} y={PLANT_H - 11}>
                  ${rt.costUsd.toFixed(4)}
                </text>
              </g>
            )}

            {/* rivets */}
            <circle className="rivet" cx={6} cy={PLANT_H - 6} r={2} />
            <circle className="rivet" cx={PLANT_W - 6} cy={PLANT_H - 6} r={2} />
          </g>
        );
      })}

      {hovered && tooltipLines.length > 0 && (
        <g
          className="plant-tip"
          transform={`translate(${hovered.x} ${hovered.y - PLANT_H / 2 - 12}) scale(${tipScale})`}
        >
          {(() => {
            const title = hovered.name;
            const lineH = 30;
            const padX = 18;
            const padY = 16;
            const width = 380;
            const titleH = 34;
            const height = padY * 2 + titleH + tooltipLines.length * lineH;
            return (
              <g transform={`translate(${-width / 2} ${-height})`}>
                <polygon
                  className="plant-tip__arrow"
                  points={`${width / 2 - 8},0 ${width / 2 + 8},0 ${width / 2},9`}
                />
                <rect
                  className="plant-tip__bg"
                  x={0}
                  y={-height}
                  width={width}
                  height={height}
                  rx={6}
                />
                <text className="plant-tip__title" x={padX} y={-height + padY + 24}>
                  {title}
                </text>
                {tooltipLines.map((line, i) => (
                  <g
                    key={line.label}
                    transform={`translate(0 ${-height + padY + titleH + i * lineH})`}
                  >
                    <text className="plant-tip__label" x={padX} y={20}>
                      {line.label}
                    </text>
                    <text className="plant-tip__value" x={width - padX} y={20} textAnchor="end">
                      {truncate(line.value, 40)}
                    </text>
                  </g>
                ))}
              </g>
            );
          })()}
        </g>
      )}
    </g>
  );
}
