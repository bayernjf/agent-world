import { useEffect, useRef, useState } from "react";
import type { Graph, GraphNode, NodeRuntime, RuntimeState } from "@agent-world/core";
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

const KIND_LABEL: Record<GraphNode["kind"], string> = {
  source: "投料口",
  agent: "厂房",
  gate: "质检站",
  sink: "成品仓",
  imageGen: "AI 生图",
  videoGen: "AI 生视频",
  audioGen: "AI 生音频",
  http: "HTTP",
  code: "代码",
  branch: "条件分支",
  map: "映射",
  loop: "循环",
  parallel: "并行聚合",
  table: "表格",
  database: "数据库",
  fileParse: "文件解析",
  translate: "翻译",
  ocr: "OCR",
  convert: "转换",
  search: "搜索",
  notify: "通知",
  vcs: "仓库",
};

const STATUS_LABEL: Record<NodeRuntime["status"], string> = {
  idle: "待机",
  running: "运行中",
  done: "完成",
  failed: "失败",
  scrapped: "已报废",
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

  const hovered = hoveredId ? graph.nodes.find((n) => n.id === hoveredId) : null;
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
        { label: "类型", value: KIND_LABEL[hovered.kind] },
        ...(hovered.agent?.model
          ? [{ label: "模型", value: hovered.agent.model }]
          : []),
        ...(hovered.kind === "gate"
          ? [{ label: "上限", value: `${hovered.gate?.maxAttempts ?? 3} 次` }]
          : []),
        ...(hovered.kind === "source"
          ? [{ label: "图片原料", value: `${hovered.source?.images?.length ?? 0} 张` }]
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
              ...(hovered.agent?.budgetUsd
                ? [
                    {
                      label: "节点预算",
                      value: `$${(hoveredRt?.costUsd ?? 0).toFixed(4)} / $${hovered.agent.budgetUsd.toFixed(4)}`,
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
          const model = node.agent?.model;
          const nodeThumb = (rt?.artifacts ?? []).find(
            (a) => (a.kind === "image" || a.kind === "video" || a.kind === "audio") && !!a.uri,
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
              {(node.kind === "imageGen" || node.kind === "videoGen") &&
                (nodeThumb ? (
                  <g className="plant__thumb" transform="translate(12 58)">
                    <rect className="plant__thumb-frame" width={26} height={26} rx={3} />
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
                      <text className="plant__thumb-glyph" x={13} y={17} textAnchor="middle">
                        {nodeThumb.kind === "video" ? "▶" : "♪"}
                      </text>
                    )}
                  </g>
                ) : node.kind === "imageGen" && node.imageGen?.model ? (
                  <text className="plant__meta" x={12} y={68}>
                    {truncate(node.imageGen.model)}
                  </text>
                ) : null)}
              {node.kind === "source" && (node.source?.images?.length ?? 0) > 0 && (
                <g className="plant__images-chip" transform={`translate(12 ${PLANT_H - 22})`}>
                  <rect width={50} height={15} rx={2} />
                  <text x={25} y={11} textAnchor="middle">
                    图 {node.source?.images?.length}
                  </text>
                </g>
              )}

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

              {node.agent?.budgetUsd ? (
                <g
                  className={`plant__budget-chip ${
                    rt && rt.costUsd > node.agent.budgetUsd ? "is-over" : ""
                  }`}
                >
                  <rect x={12} y={PLANT_H - 22} width={56} height={15} rx={2} />
                  <text className="plant__budget" x={40} y={PLANT_H - 11} textAnchor="middle">
                    ${node.agent.budgetUsd.toFixed(3)}
                  </text>
                </g>
              ) : null}

              <circle className="rivet" cx={6} cy={PLANT_H - 6} r={2} />
              <circle className="rivet" cx={PLANT_W - 6} cy={PLANT_H - 6} r={2} />
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
