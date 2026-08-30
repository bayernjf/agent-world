import { useEffect, useState } from "react";
import { api, type RunSummary } from "../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpen?: (runId: string) => void;
}

const PAGE_SIZE = 20;
// Engine 真实 run status，对齐 ControlPanel.STATUS_TEXT
const STATUSES = ["running", "done", "halted", "failed", "tripped", "cancelled", "interrupted"];

const STATUS_LABEL: Record<string, string> = {
  idle: "待派发",
  running: "运行中",
  done: "全部出厂",
  halted: "等待人工",
  failed: "产线故障",
  tripped: "电力跳闸",
  cancelled: "已取消",
  interrupted: "上次中断",
  // 兼容旧数据或 A/B 报告
  completed: "已完成",
  approved: "已通过",
  rejected: "已拒绝",
};

// 状态 → 语义色（工厂系）
const STATUS_COLOR: Record<string, string> = {
  running: "run-status--running",
  done: "run-status--done",
  halted: "run-status--halted",
  failed: "run-status--failed",
  tripped: "run-status--tripped",
  cancelled: "run-status--cancelled",
  interrupted: "run-status--interrupted",
  completed: "run-status--done",
  approved: "run-status--done",
  rejected: "run-status--failed",
};

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "运行中";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

interface RunStats {
  nodes: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

function CompareView({
  runs,
  selected,
  stats,
  onBack,
}: {
  runs: RunSummary[];
  selected: string[];
  stats: Record<string, RunStats>;
  onBack: () => void;
}) {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const cols = selected.map((id) => ({ id, run: byId.get(id), stat: stats[id] }));
  const rows: { label: string; get: (c: (typeof cols)[number]) => string }[] = [
    { label: "产线", get: (c) => c.run?.graph_name || "(未命名产线)" },
    { label: "状态", get: (c) => (c.run ? (STATUS_LABEL[c.run.status] ?? c.run.status) : "—") },
    { label: "触发", get: (c) => c.run?.trigger ?? "—" },
    { label: "开始", get: (c) => (c.run ? fmtRelative(c.run.started_at) : "—") },
    { label: "耗时", get: (c) => (c.run ? fmtDuration(c.run.ended_at != null ? c.run.ended_at - c.run.started_at : null) : "—") },
    { label: "节点数", get: (c) => (c.stat ? String(c.stat.nodes) : "—") },
    { label: "输入 tokens", get: (c) => (c.stat ? c.stat.tokensIn.toLocaleString() : "—") },
    { label: "输出 tokens", get: (c) => (c.stat ? c.stat.tokensOut.toLocaleString() : "—") },
    { label: "成本", get: (c) => (c.stat ? `$${c.stat.costUsd.toFixed(4)}` : "—") },
  ];
  return (
    <div>
      <div className="dialog-actions" style={{ marginBottom: 8 }}>
        <button className="btn" onClick={onBack}>
          返回列表
        </button>
      </div>
      <table className="compare-table">
        <thead>
          <tr>
            <th>指标</th>
            {cols.map((c) => (
              <th key={c.id}>{c.run?.graph_name || c.id.slice(0, 8)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {cols.map((c) => (
                <td key={c.id}>{row.get(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RunHistory({ open, onClose, onOpen }: Props) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [graphs, setGraphs] = useState<{ id: string; name: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [graphId, setGraphId] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [stats, setStats] = useState<Record<string, RunStats>>({});
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const load = () => {
    setLoading(true);
    api
      .listRuns({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        graphId: graphId || undefined,
        status: status || undefined,
      })
      .then((d) => {
        setRuns(d.runs);
        setTotal(d.total);
      })
      .finally(() => setLoading(false));
  };

  // Load graph list once when the dialog opens; reset transient selection state.
  useEffect(() => {
    if (!open) return;
    setPage(0);
    setSelected([]);
    setComparing(false);
    api.listGraphs().then((g) => setGraphs(g.map((x) => ({ id: x.id, name: x.name }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reload the page whenever the page or filters change.
  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, graphId, status, open]);

  if (!open) return null;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleSelect = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const handleRerun = async (r: RunSummary) => {
    setErrorMsg("");
    setRerunning(r.id);
    try {
      const { runId } = await api.rerunRun(r.id);
      load();
      onOpen?.(runId);
    } catch (e) {
      setErrorMsg(`重新运行失败：${(e as Error).message}`);
    } finally {
      setRerunning(null);
    }
  };

  const runCompare = async () => {
    const entries = await Promise.all(
      selected.map(async (id) => [id, await api.runStats(id)] as const),
    );
    const map: Record<string, RunStats> = {};
    for (const [id, st] of entries) map[id] = st;
    setStats(map);
    setComparing(true);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide modal--tall" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>运行历史</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={() => setCompareMode((v) => !v)}>
              {compareMode ? "退出选择" : "选择对比"}
            </button>
            <button className="icon-btn" onClick={onClose} title="关闭">
              ✕
            </button>
          </div>
        </div>

        <div className="runhistory-filters">
          <label>
            产线
            <select
              value={graphId}
              onChange={(e) => {
                setGraphId(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部</option>
              {graphs.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </label>
          <span className="runhistory-count">共 {total} 条</span>
        </div>
        <div className="modal__body runhistory-body">

        {errorMsg && <div className="runhistory-error">{errorMsg}</div>}

        {comparing ? (
          <CompareView runs={runs} selected={selected} stats={stats} onBack={() => setComparing(false)} />
        ) : (
          <>
            <div className="runhistory-list">
              {loading && <div className="note">加载中…</div>}
              {!loading && runs.length === 0 && <div className="note">没有匹配的运行</div>}
              {runs.map((r) => (
                <div
                  key={r.id}
                  className={`runhistory-row${compareMode ? " runhistory-row--selectable" : ""}${
                    r.status === "failed" ? " runhistory-status-failed" : ""
                  }`}
                  onClick={() => {
                    if (compareMode) toggleSelect(r.id);
                    else onOpen?.(r.id);
                  }}
                >
                  {compareMode && (
                    <input
                      type="checkbox"
                      checked={selected.includes(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  <div className="runhistory-row-main">
                    <div className="runhistory-row-title">
                      <span className={`run-status ${STATUS_COLOR[r.status] ?? "run-status--default"}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                      <span className="runhistory-name">{r.graph_name || "(未命名产线)"}</span>
                      <span className="runhistory-id">{r.id.slice(0, 8)}</span>
                    </div>
                    <div className="runhistory-row-meta">
                      <span>{fmtRelative(r.started_at)}</span>
                      <span>
                        耗时 {fmtDuration(r.ended_at != null ? r.ended_at - r.started_at : null)}
                      </span>
                      <span>{r.trigger}</span>
                      {r.budget_usd != null && <span>预算 ${r.budget_usd.toFixed(4)}</span>}
                    </div>
                  </div>
                  {r.status !== "running" && (
                    <button
                      className="btn runhistory-rerun"
                      disabled={rerunning === r.id}
                      title="用相同的快照和输入重新运行"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRerun(r);
                      }}
                    >
                      {rerunning === r.id ? "重跑中…" : "重新运行"}
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="runhistory-pager">
              <button className="btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                上一页
              </button>
              <span>
                第 {page + 1} / {pageCount} 页
              </span>
              <button
                className="btn"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
              {compareMode && (
                <button className="btn btn--primary" disabled={selected.length < 2} onClick={runCompare}>
                  对比选中 ({selected.length})
                </button>
              )}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
