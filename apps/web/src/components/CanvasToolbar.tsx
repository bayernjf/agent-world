import { useState, useRef, useEffect } from "react";
import { useGraph } from "../store/graph";
import { useCanvas } from "../store/canvas";
import { VIEW_W, VIEW_H } from "../canvas/board";
import { NodeKind } from "@agent-world/core";

interface NodeButton {
  kind: NodeKind;
  label: string;
  hint: string;
  primary: boolean;
}

const PRIMARY: NodeButton[] = [
  { kind: "agent", label: "厂房", hint: "Agent 节点", primary: true },
  { kind: "gate", label: "质检站", hint: "Gate 节点", primary: true },
  { kind: "imageGen", label: "AI 生图", hint: "ImageGen 节点", primary: true },
];

const MORE: NodeButton[] = [
  { kind: "source", label: "原料台", hint: "Source 节点：产线起点", primary: false },
  { kind: "sink", label: "成品库", hint: "Sink 节点：产线终点", primary: false },
  { kind: "http", label: "HTTP", hint: "HTTP 请求节点：调用外部 API", primary: false },
  { kind: "code", label: "代码", hint: "代码执行节点：跑 JS / Python 脚本", primary: false },
  { kind: "branch", label: "条件分支", hint: "Branch 节点：按表达式路由到不同分支", primary: false },
  { kind: "map", label: "映射", hint: "Map 节点：JSON 模板映射/转换数据", primary: false },
  { kind: "loop", label: "循环", hint: "Loop 节点：对数组逐项执行下游子图", primary: false },
  { kind: "parallel", label: "并行聚合", hint: "Parallel 节点：等待所有分支并把输出聚合为数组", primary: false },
  { kind: "table", label: "表格", hint: "Table 节点：CSV 解析/筛选/排序/聚合", primary: false },
  { kind: "database", label: "数据库", hint: "Database 节点：执行 SQL 查询（SQLite）", primary: false },
  { kind: "fileParse", label: "文件解析", hint: "FileParse 节点：提取 PDF/Word/PPT 的文本与图片", primary: false },
  { kind: "translate", label: "翻译", hint: "Translate 节点：把上游文本翻译成目标语言", primary: false },
  { kind: "ocr", label: "OCR", hint: "OCR 节点：识别图片中的文字（tesseract.js）", primary: false },
  { kind: "convert", label: "文件转换", hint: "Convert 节点：PDF 提取图片 / 图片格式转换（PNG、JPEG）", primary: false },
  { kind: "search", label: "搜索", hint: "Search 节点：网络搜索（DuckDuckGo 免 key / Tavily / SerpAPI / Google）", primary: false },
  { kind: "notify", label: "通知", hint: "Notify 节点：发消息到飞书/钉钉/企微/Slack 群或邮件", primary: false },
  { kind: "vcs", label: "代码仓库", hint: "VCS 节点：GitHub/GitLab 提 PR、评论 issue、触发 workflow、列 issue", primary: false },
  { kind: "videoGen", label: "AI 视频", hint: "VideoGen 节点", primary: false },
  { kind: "audioGen", label: "AI 音频", hint: "AudioGen 节点", primary: false },
];

interface Props {
  onError?: (msg: string) => void;
}
const MODALITY_PROMPT_LABEL: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
  embedding: "向量",
};
export default function CanvasToolbar({ onError }: Props = {}) {
  const addNode = useGraph((s) => s.addNode);
  const { zoom, panX, panY } = useCanvas((s) => s.viewport);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
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

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="添加节点">
      <span className="canvas-toolbar__prefix">▌</span>
      {PRIMARY.map((b) => (
        <button
          key={b.kind}
          className="canvas-toolbar__btn"
          onClick={() => addAtViewCenter(b.kind)}
          title={b.hint}
        >
          + {b.label}
        </button>
      ))}
      <div className="canvas-toolbar__more" ref={moreRef}>
        <button
          className="canvas-toolbar__btn canvas-toolbar__btn--more"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          title="更多节点类型"
        >
          更多 <span className="canvas-toolbar__caret">▾</span>
        </button>
        {moreOpen && (
          <div className="canvas-toolbar__menu" role="menu">
            {MORE.map((b) => (
              <button
                key={b.kind}
                className="canvas-toolbar__menu-item"
                onClick={() => {
                  addAtViewCenter(b.kind);
                  setMoreOpen(false);
                }}
                title={b.hint}
                role="menuitem"
              >
                <span className="canvas-toolbar__menu-label">+ {b.label}</span>
                <span className="canvas-toolbar__menu-hint">{b.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
