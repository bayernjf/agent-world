import type { Graph, GraphNode, NodeRuntime, RuntimeState } from "@agent-world/core";
import { PLANT_H, PLANT_W } from "../store/graph";

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

function statusClass(rt: NodeRuntime | undefined): string {
  if (!rt) return "is-idle";
  return `is-${rt.status}`;
}

export default function Plants({
  graph,
  runtime,
  selectedId,
  connectFrom,
  onPointerDown,
}: Props) {
  return (
    <g className="plants">
      {graph.nodes.map((node) => {
        const rt = runtime.nodes[node.id];
        const x = node.x - PLANT_W / 2;
        const y = node.y - PLANT_H / 2;
        const attempt = rt?.attempt ?? 0;

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

            {node.kind === "agent" && (
              <text className="plant__meta" x={12} y={68}>
                {node.agent?.model ?? "—"}
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
              <text className="plant__cost" x={PLANT_W - 12} y={68}>
                ${rt.costUsd.toFixed(4)}
              </text>
            )}

            {/* rivets */}
            <circle className="rivet" cx={6} cy={PLANT_H - 6} r={2} />
            <circle className="rivet" cx={PLANT_W - 6} cy={PLANT_H - 6} r={2} />
          </g>
        );
      })}
    </g>
  );
}
