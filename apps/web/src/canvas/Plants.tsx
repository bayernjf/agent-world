import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Graph,
  GraphNode,
  NodeRuntime,
  RuntimeState,
} from "@agent-world/core";
import { PLANT_H, PLANT_W } from "../store/graph";
import Popover from "../components/Popover";
import type { Rect } from "../components/Popover";
import { useTips } from "../store/tips";

interface Props {
  graph: Graph;
  runtime: RuntimeState;
  selectedNodeIds: string[];
  connectFrom: string | null;
  onPointerDown: (node: GraphNode, e: React.PointerEvent) => void;
}

export const KIND_KEY: Record<GraphNode["kind"], string> = {
  source: "nodes:source",
  textGen: "nodes:textGen",
  gate: "nodes:gate",
  sink: "nodes:sink",
  imageGen: "nodes:imageGen",
  videoGen: "nodes:videoGen",
  audioGen: "nodes:audioGen",
  http: "nodes:http",
  code: "nodes:code",
  branch: "nodes:branch",
  map: "nodes:map",
  loop: "nodes:loop",
  parallel: "nodes:parallel",
  table: "nodes:table",
  database: "nodes:database",
  fileParse: "nodes:fileParse",
  translate: "nodes:translate",
  ocr: "nodes:ocr",
  convert: "nodes:convert",
  search: "nodes:search",
  notify: "nodes:notify",
  vcs: "nodes:vcs",
  human: "nodes:human",
  subprocess: "nodes:subprocess",
  generic: "nodes:generic",
  compliance: "nodes:compliance",
};

const STATUS_KEY: Record<NodeRuntime["status"], string> = {
  idle: "nodes:status.idle",
  running: "nodes:status.running",
  done: "nodes:status.done",
  failed: "nodes:status.failed",
  skipped: "nodes:status.skipped",
  scrapped: "nodes:status.scrapped",
};

/** Maximum model-name characters before ellipsis. */
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
  selectedNodeIds,
  connectFrom,
  onPointerDown,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const { t } = useTranslation();
  const tipsEnabled = useTips((s) => s.enabled);
  const nodeRefs = useRef<Map<string, SVGGElement>>(new Map());

  // T toggles hover nameplates on/off.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "t" || e.key === "T") useTips.getState().toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clear any visible nameplate the moment tips are turned off.
  useEffect(() => {
    if (!tipsEnabled) setHoveredId(null);
  }, [tipsEnabled]);

  const hovered = hoveredId
    ? graph.nodes.find((n) => n.id === hoveredId)
    : null;
  const hoveredRt = hovered ? runtime.nodes[hovered.id] : undefined;

  // While a plant is hovered, track its screen rectangle every frame so the
  // nameplate follows pan/zoom without being clipped by the SVG or side panels.
  useEffect(() => {
    if (!hoveredId) {
      setAnchor(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const el = nodeRefs.current.get(hoveredId);
      if (el) {
        const r = el.getBoundingClientRect();
        setAnchor((prev) => {
          const next = {
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
            bottom: r.bottom,
            right: r.right,
          };
          if (
            prev &&
            Math.abs(prev.top - next.top) < 1 &&
            Math.abs(prev.left - next.left) < 1 &&
            Math.abs(prev.width - next.width) < 1 &&
            Math.abs(prev.height - next.height) < 1
          ) {
            return prev;
          }
          return next;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hoveredId, tipsEnabled]);

  const tooltipLines: TooltipLine[] = hovered
    ? [
        { label: t("nodes:tip.kind"), value: t(KIND_KEY[hovered.kind]) },
        ...(hovered.textGen?.model
          ? [{ label: t("nodes:tip.model"), value: hovered.textGen.model }]
          : []),
        ...(hovered.kind === "gate"
          ? [
              {
                label: t("nodes:tip.gateLimit"),
                value: t("nodes:attempts", {
                  n: hovered.gate?.maxAttempts ?? 3,
                }),
              },
            ]
          : []),
        ...(hovered.kind === "source"
          ? [
              {
                label: t("nodes:tip.images"),
                value: t("nodes:imageCount", {
                  n: hovered.source?.images?.length ?? 0,
                }),
              },
            ]
          : []),
        ...(hoveredRt
          ? [
              {
                label: t("nodes:tip.status"),
                value: t(STATUS_KEY[hoveredRt.status] ?? hoveredRt.status),
              },
              ...(hoveredRt.attempt > 1
                ? [
                    {
                      label: t("nodes:tip.rework"),
                      value: t("nodes:attempts", { n: hoveredRt.attempt }),
                    },
                  ]
                : []),
              ...(hoveredRt.tokensIn || hoveredRt.tokensOut
                ? [
                    {
                      label: t("nodes:tip.tokens"),
                      value: `${(hoveredRt.tokensIn ?? 0) + (hoveredRt.tokensOut ?? 0)}`,
                    },
                  ]
                : []),
              ...(hoveredRt.costUsd > 0
                ? [
                    {
                      label: t("nodes:tip.power"),
                      value: `$${hoveredRt.costUsd.toFixed(4)}`,
                    },
                  ]
                : []),
              ...(hovered.textGen?.budgetUsd
                ? [
                    {
                      label: t("nodes:tip.budget"),
                      value: `$${(hoveredRt?.costUsd ?? 0).toFixed(4)} / $${hovered.textGen.budgetUsd.toFixed(4)}`,
                    },
                  ]
                : []),
            ]
          : []),
      ]
    : [];

  return (
    <>
      <g className="plants">
        {graph.nodes.map((node) => {
          const rt = runtime.nodes[node.id];
          const x = node.x - PLANT_W / 2;
          const y = node.y - PLANT_H / 2;
          const attempt = rt?.attempt ?? 0;
          const model = node.textGen?.model;
          const nodeThumb = (rt?.artifacts ?? []).find(
            (a) =>
              (a.kind === "image" ||
                a.kind === "video" ||
                a.kind === "audio") &&
              !!a.uri,
          );

          return (
            <g
              key={node.id}
              ref={(el) => {
                if (el) nodeRefs.current.set(node.id, el);
                else nodeRefs.current.delete(node.id);
              }}
              className={[
                "plant",
                `plant--${node.kind}`,
                statusClass(rt),
                // Node status has no "halted" value — the node is still marked
                // running — so the run-level halt is what flags a plant as
                // waiting on a human.
                runtime.status === "halted" && runtime.haltedNodeId === node.id
                  ? "is-awaiting-review"
                  : "",
                selectedNodeIds.includes(node.id) ? "is-selected" : "",
                connectFrom === node.id ? "is-connect-src" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              transform={`translate(${x} ${y})`}
              onPointerDown={(e) => onPointerDown(node, e)}
              onPointerEnter={() => {
                if (tipsEnabled) setHoveredId(node.id);
              }}
              onPointerLeave={() =>
                setHoveredId((current) =>
                  current === node.id ? null : current,
                )
              }
            >
              <rect
                className="plant__shadow"
                x={3}
                y={4}
                width={PLANT_W}
                height={PLANT_H}
              />
              <rect className="plant__body" width={PLANT_W} height={PLANT_H} />
              <rect className="plant__bar" width={PLANT_W} height={22} />

              <circle className="plant__led" cx={12} cy={11} r={3.5} />
              <text className="plant__kind" x={26} y={15}>
                {t(KIND_KEY[node.kind])}
              </text>

              <text className="plant__name" x={12} y={48}>
                {node.name}
              </text>

              {node.kind === "textGen" && model && (
                <text className="plant__meta" x={12} y={68}>
                  {truncate(model)}
                </text>
              )}
              {node.kind === "gate" && (
                <text className="plant__meta" x={12} y={68}>
                  {t("nodes:gateLimitMeta", { n: node.gate?.maxAttempts ?? 3 })}
                </text>
              )}
              {(node.kind === "imageGen" || node.kind === "videoGen") &&
                (nodeThumb ? (
                  <g className="plant__thumb" transform="translate(12 58)">
                    <rect
                      className="plant__thumb-frame"
                      width={26}
                      height={26}
                      rx={3}
                    />
                    {nodeThumb.kind === "image" ? (
                      <image
                        href={nodeThumb.uri!}
                        x={1}
                        y={1}
                        width={24}
                        height={24}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    ) : (
                      <text
                        className="plant__thumb-glyph"
                        x={13}
                        y={17}
                        textAnchor="middle"
                      >
                        {nodeThumb.kind === "video" ? "▶" : "♪"}
                      </text>
                    )}
                  </g>
                ) : (node.kind === "imageGen" && node.imageGen?.model) ||
                  (node.kind === "videoGen" && node.videoGen?.model) ? (
                  <text className="plant__meta" x={12} y={68}>
                    {truncate(
                      node.kind === "imageGen"
                        ? node.imageGen!.model
                        : node.videoGen!.model,
                    )}
                  </text>
                ) : null)}
              {node.kind === "source" &&
                (node.source?.images?.length ?? 0) > 0 && (
                  <g
                    className="plant__images-chip"
                    transform={`translate(12 ${PLANT_H - 22})`}
                  >
                    <rect width={50} height={15} rx={2} />
                    <text x={25} y={11} textAnchor="middle">
                      {t("nodes:imageChip", {
                        n: node.source?.images?.length ?? 0,
                      })}
                    </text>
                  </g>
                )}

              {attempt > 1 && (
                <g
                  className="plant__attempt"
                  transform={`translate(${PLANT_W - 30} 34)`}
                >
                  <rect x={-14} y={-11} width={28} height={22} rx={3} />
                  <text x={0} y={5}>
                    ×{attempt}
                  </text>
                </g>
              )}

              {rt && rt.costUsd > 0 && (
                <g className="plant__cost-chip">
                  <rect
                    x={PLANT_W - 62}
                    y={PLANT_H - 22}
                    width={50}
                    height={15}
                    rx={2}
                  />
                  <text
                    className="plant__cost"
                    x={PLANT_W - 37}
                    y={PLANT_H - 11}
                  >
                    ${rt.costUsd.toFixed(4)}
                  </text>
                </g>
              )}

              {node.textGen?.budgetUsd ? (
                <g
                  className={`plant__budget-chip ${
                    rt && rt.costUsd > node.textGen.budgetUsd ? "is-over" : ""
                  }`}
                >
                  <rect x={12} y={PLANT_H - 22} width={56} height={15} rx={2} />
                  <text
                    className="plant__budget"
                    x={40}
                    y={PLANT_H - 11}
                    textAnchor="middle"
                  >
                    ${node.textGen.budgetUsd.toFixed(3)}
                  </text>
                </g>
              ) : null}

              <circle className="rivet" cx={6} cy={PLANT_H - 6} r={2} />
              <circle
                className="rivet"
                cx={PLANT_W - 6}
                cy={PLANT_H - 6}
                r={2}
              />
            </g>
          );
        })}
      </g>

      <Popover
        open={tipsEnabled && !!hovered && tooltipLines.length > 0}
        anchor={anchor}
        placement="top"
        className="plant-tip"
      >
        {hovered && (
          <div className="plant-tip__inner">
            <div className="plant-tip__title">{hovered.name}</div>
            <dl className="plant-tip__rows">
              {tooltipLines.map((line) => (
                <div key={line.label} className="plant-tip__row">
                  <dt>{line.label}</dt>
                  <dd>{truncate(line.value, 48)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Popover>
    </>
  );
}
