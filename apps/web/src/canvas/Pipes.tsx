import type { Graph, RuntimeState } from "@agent-world/core";
import { pipePath } from "./geometry";
import { registerPath } from "./pathRegistry";

interface Props {
  graph: Graph;
  runtime: RuntimeState;
  onRemove: (edgeId: string) => void;
  interactive: boolean;
}

export default function Pipes({ graph, runtime, onRemove, interactive }: Props) {
  return (
    <g className="pipes">
      {graph.edges.map((edge) => {
        const d = pipePath(graph, edge);
        if (!d) return null;

        const rework = edge.kind === "rework";
        const upstream = runtime.nodes[edge.from];
        // A pipe hums only while the line is actually up. After the run ends every
        // pipe goes quiet, which is what "收工" should look like.
        const energised =
          runtime.status === "running" &&
          (upstream?.status === "running" || upstream?.status === "done");

        return (
          <g key={edge.id} className={`pipe ${rework ? "pipe--rework" : ""}`}>
            {/* casing */}
            <path d={d} className="pipe__casing" />
            {/* the moving current — dash offset animates in CSS when energised */}
            <path
              ref={(el) => registerPath(edge.id, el)}
              d={d}
              className={`pipe__core ${energised ? "is-live" : ""}`}
            />
            {interactive && (
              <path
                d={d}
                className="pipe__hit"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(edge.id);
                }}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
