import { useCallback, useEffect, useState } from "react";
import { api, type RunSummary } from "../lib/api";
import { useGraph } from "../store/graph";
import { useRun } from "../store/run";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  done: "完成",
  failed: "失败",
  halted: "已暂停",
  tripped: "预算跳闸",
  cancelled: "已取消",
  interrupted: "中断",
  running: "运行中",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function duration(r: RunSummary): string {
  if (!r.ended_at) return "—";
  const sec = Math.round((r.ended_at - r.started_at) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${sec % 60}s`;
}

export default function RunHistory({ open, onClose }: Props) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RunSummary | null>(null);
  const { setGraph } = useGraph();
  const { loadRun, runId, reset } = useRun();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRuns(await api.listRuns(100));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const replay = async (r: RunSummary) => {
    const graph = await api.getGraph(r.graph_id).catch(() => null);
    if (graph) {
      setGraph(graph);
      useGraph.temporal.getState().clear();
    }
    await loadRun(r.id);
    onClose();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    await api.deleteRun(id).catch(() => {});
    if (runId === id) reset();
    await refresh();
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 720 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>运行历史</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="chip" onClick={refresh} disabled={loading}>
              刷新
            </button>
            <button className="icon-btn" onClick={onClose} title="关闭">
              ✕
            </button>
          </div>
        </div>
        <div className="modal__body">
          {runs.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: "40px 0" }}>
              暂无运行记录
            </p>
          ) : (
            <table className="run-table">
              <thead>
                <tr>
                  <th>产线</th>
                  <th>状态</th>
                  <th>触发</th>
                  <th>开始</th>
                  <th>耗时</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className={runId === r.id ? "is-current" : ""}
                    onDoubleClick={() => replay(r)}
                  >
                    <td className="run-table__name">{r.graph_name}</td>
                    <td>
                      <span className={`run-status run-status--${r.status}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="muted">{r.trigger}</td>
                    <td className="mono">{formatTime(r.started_at)}</td>
                    <td className="mono">{duration(r)}</td>
                    <td className="run-table__actions">
                      <button
                        className="chip"
                        onClick={() => replay(r)}
                        title="回放此次运行"
                      >
                        回放
                      </button>
                      {r.status !== "running" && (
                        <button
                          className="icon-btn icon-btn--danger"
                          onClick={() => setDeleteTarget(r)}
                          title="删除记录"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除运行记录"
        description={
          deleteTarget
            ? `确定删除「${deleteTarget.graph_name}」的这次运行吗？所有事件和节点产出都将被删除，不可撤销。`
            : ""
        }
        confirmLabel="删除"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
