import { useState, useRef, useEffect, useMemo } from "react";
import { useGraph } from "../store/graph";
import { useCanvas } from "../store/canvas";
import { VIEW_W, VIEW_H } from "../canvas/board";
import { NODE_CATEGORIES, NODE_CATEGORY, type NodeKind } from "@agent-world/core";

interface NodeButton {
  kind: NodeKind;
  label: string;
  hint: string;
}

const NODE_META: Record<NodeKind, NodeButton> = {
  textGen: { kind: "textGen", label: "文坊", hint: "LLM 文本生成（文坊），可挂技能卡" },
  imageGen: { kind: "imageGen", label: "画坊", hint: "文字生成图片" },
  videoGen: { kind: "videoGen", label: "影坊", hint: "文字生成视频" },
  audioGen: { kind: "audioGen", label: "音坊", hint: "文字生成语音/音乐" },
  gate: { kind: "gate", label: "质检站", hint: "LLM-as-judge 质量检验门（质检站）" },
  branch: { kind: "branch", label: "分拣闸", hint: "按条件分流到不同管道" },
  map: { kind: "map", label: "改料台", hint: "JSON 模板重排/转换（改料台）" },
  loop: { kind: "loop", label: "批处理站", hint: "对数组逐项重复下游工序" },
  parallel: { kind: "parallel", label: "汇流站", hint: "等齐多路后合并输出" },
  subprocess: { kind: "subprocess", label: "外包工坊", hint: "调用另一张产线（外包工坊）" },
  table: { kind: "table", label: "理货台", hint: "CSV 筛选/排序/聚合（理货台）" },
  database: { kind: "database", label: "总账房", hint: "SQL 查询（总账房）" },
  fileParse: { kind: "fileParse", label: "拆包台", hint: "提取 PDF/Word/PPT（拆包台）" },
  convert: { kind: "convert", label: "换装台", hint: "PDF 提图 / 图片格式转换（换装台）" },
  translate: { kind: "translate", label: "翻译间", hint: "上游文本译到目标语言（翻译间）" },
  ocr: { kind: "ocr", label: "识图台", hint: "图片识文字（识图台）" },
  code: { kind: "code", label: "代码工坊", hint: "跑 JS / Python 脚本（代码工坊）" },
  http: { kind: "http", label: "API 口岸", hint: "调用外部 API（API 口岸）" },
  search: { kind: "search", label: "瞭望塔", hint: "联网搜集（瞭望塔）" },
  notify: { kind: "notify", label: "广播站", hint: "发消息到群/邮件（广播站）" },
  vcs: { kind: "vcs", label: "档案柜", hint: "GitHub/GitLab 操作（档案柜）" },
  human: { kind: "human", label: "人工岗", hint: "暂停等人工点头（人工岗）" },
  source: { kind: "source", label: "原料台", hint: "产线投料入口（原料台）" },
  sink: { kind: "sink", label: "成品库", hint: "产线产物出口（成品库）" },
  generic: { kind: "generic", label: "多能坊", hint: "多能坊：自由选模型提供方，按模态自动 dispatch" },
};

/** High-frequency kinds shown directly in the toolbar; the rest live in the palette. */
const PRIMARY_KINDS: NodeKind[] = ["textGen", "gate", "imageGen"];

const MODALITY_PROMPT_LABEL: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
  embedding: "向量",
};

interface Props {
  onError?: (msg: string) => void;
}

export default function CanvasToolbar({ onError }: Props = {}) {
  const addNode = useGraph((s) => s.addNode);
  const { zoom, panX, panY } = useCanvas((s) => s.viewport);
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState("");
  const moreRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
        setQuery("");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Focus the search box as soon as the palette opens.
  useEffect(() => {
    if (moreOpen) searchRef.current?.focus();
  }, [moreOpen]);

  // Add at the current view center, in canvas coordinates.
  function addAtViewCenter(kind: NodeKind) {
    const cx = (VIEW_W / 2 - panX) / zoom;
    const cy = (VIEW_H / 2 - panY) / zoom;
    const r = addNode(kind, cx, cy);
    if (r.missingModality) {
      const label = MODALITY_PROMPT_LABEL[r.missingModality] ?? "对应";
      onError?.(`该节点需要${label}模型，但当前没有配置；节点已添加，请在「模型设置」中添加后再派发。`);
    }
  }

  function addFromPalette(kind: NodeKind) {
    addAtViewCenter(kind);
    setMoreOpen(false);
    setQuery("");
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = NODE_CATEGORIES.map((cat) => ({
      id: cat.id,
      label: cat.label,
      items: (Object.keys(NODE_META) as NodeKind[])
        .filter((kind) => NODE_CATEGORY[kind] === cat.id)
        .map((kind) => NODE_META[kind]),
    }));
    if (!q) return all;
    return all
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (it) =>
            it.label.toLowerCase().includes(q) ||
            it.hint.toLowerCase().includes(q) ||
            it.kind.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [query]);

  const totalItems = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups],
  );

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="添加节点">
      <span className="canvas-toolbar__prefix">▌</span>
      {PRIMARY_KINDS.map((kind) => (
        <button
          key={kind}
          className="canvas-toolbar__btn"
          onClick={() => addAtViewCenter(kind)}
          title={NODE_META[kind].hint}
        >
          + {NODE_META[kind].label}
        </button>
      ))}
      <div className="canvas-toolbar__more" ref={moreRef}>
        <button
          className="canvas-toolbar__btn canvas-toolbar__btn--more"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          title="按分类查找节点"
        >
          更多 <span className="canvas-toolbar__caret">▾</span>
        </button>
        {moreOpen && (
          <div className="canvas-toolbar__menu" role="dialog" aria-label="节点库">
            <div className="canvas-toolbar__search">
              <input
                ref={searchRef}
                className="canvas-toolbar__search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索节点…"
                aria-label="搜索节点"
              />
            </div>
            <div className="canvas-toolbar__groups">
              {groups.map((g) => (
                <div key={g.id} className="canvas-toolbar__group">
                  <div className="canvas-toolbar__group-title">{g.label}</div>
                  {g.items.map((b) => (
                    <button
                      key={b.kind}
                      className="canvas-toolbar__menu-item"
                      onClick={() => addFromPalette(b.kind)}
                      title={b.hint}
                    >
                      <span className="canvas-toolbar__menu-label">+ {b.label}</span>
                      <span className="canvas-toolbar__menu-hint">{b.hint}</span>
                    </button>
                  ))}
                </div>
              ))}
              {totalItems === 0 && (
                <div className="canvas-toolbar__empty">没有匹配的节点</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
