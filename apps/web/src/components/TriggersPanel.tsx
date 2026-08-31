import { useCallback, useEffect, useState } from "react";
import { api, type RunSummary, type TriggerConfig } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
  graphId: string;
}

const TYPE_LABELS: Record<TriggerConfig["type"], string> = {
  manual: "手动",
  webhook: "Webhook",
  cron: "定时",
  event: "事件",
  batch: "批量",
};

function blankTrigger(): TriggerConfig {
  return {
    id: `trg_${crypto.randomUUID().slice(0, 8)}`,
    type: "cron",
    enabled: true,
    cron: "0 9 * * *",
  };
}

function summarize(t: TriggerConfig): string {
  switch (t.type) {
    case "webhook":
      return t.webhookSecret ? `secret: ${t.webhookSecret}` : "未设置 secret";
    case "cron":
      return t.cron ?? "未设置表达式";
    case "event":
      return t.eventSource
        ? `${t.eventSource.kind}:${t.eventSource.id}`
        : "未设置事件源";
    case "batch":
      return t.batch
        ? `${t.batch.source}${t.batch.path ? ` (${t.batch.path})` : ""}`
        : "未设置批次";
    default:
      return "";
  }
}

function fmtTime(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleString() : "—";
}

export default function TriggersPanel({ open, onClose, graphId }: Props) {
  const [triggers, setTriggers] = useState<TriggerConfig[]>([]);
  const [nextRuns, setNextRuns] = useState<Record<string, number | null>>({});
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    trigger: TriggerConfig;
    isNew: boolean;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ts, nr, allRuns] = await Promise.all([
        api.listTriggers(graphId),
        api.triggerNextRuns(graphId),
        api.listRuns({ limit: 20 }),
      ]);
      setTriggers(ts);
      setNextRuns(nr);
      setRuns(allRuns.runs.filter((r) => r.graph_id === graphId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [graphId]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, load]);

  if (!open) return null;

  const fire = async (t: TriggerConfig) => {
    setBusyId(t.id);
    setError(null);
    try {
      await api.fireTrigger(graphId, t.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "触发失败");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (t: TriggerConfig) => {
    setError(null);
    try {
      await api.deleteTrigger(graphId, t.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const toggleEnabled = async (t: TriggerConfig) => {
    setError(null);
    try {
      await api.createTrigger(graphId, { ...t, enabled: !(t.enabled ?? true) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>触发器</h2>
          <Tooltip content="关闭">
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <div className="triggers-toolbar">
            <p className="muted">
              配置自动运行：Webhook、定时（cron）、事件、批量。手动触发器可在此点「运行一次」。
            </p>
            <button
              className="btn btn--primary btn--sm"
              onClick={() =>
                setEditing({ trigger: blankTrigger(), isNew: true })
              }
            >
              ＋ 添加触发器
            </button>
          </div>

          {error && <div className="error-text">{error}</div>}

          <ul className="trigger-list">
            {triggers.length === 0 && (
              <li className="muted">暂无触发器，点「添加触发器」创建。</li>
            )}
            {triggers.map((t) => (
              <li key={t.id} className="trigger-row">
                <div className="trigger-main">
                  <span className={`badge badge--${t.type}`}>
                    {TYPE_LABELS[t.type]}
                  </span>
                  <span className="trigger-id">{t.id}</span>
                  {t.enabled === false && (
                    <span className="badge badge--off">已停用</span>
                  )}
                  <span className="muted trigger-summary">{summarize(t)}</span>
                </div>
                <div className="trigger-meta">
                  {t.type === "cron" && (
                    <span>⏱ {fmtTime(nextRuns[t.id])}</span>
                  )}
                  {t.type === "webhook" && (
                    <code className="muted">
                      POST /api/graphs/{graphId}/webhook?secret=
                      {t.webhookSecret}
                    </code>
                  )}
                </div>
                <div className="trigger-actions">
                  <label className="trigger-toggle">
                    <input
                      type="checkbox"
                      checked={t.enabled !== false}
                      onChange={() => void toggleEnabled(t)}
                    />
                    启用
                  </label>
                  <button
                    className="ghost-btn"
                    disabled={busyId === t.id}
                    onClick={() => void fire(t)}
                  >
                    运行一次
                  </button>
                  <button
                    className="ghost-btn"
                    onClick={() => setEditing({ trigger: t, isNew: false })}
                  >
                    编辑
                  </button>
                  <button
                    className="ghost-btn ghost-btn--danger"
                    onClick={() => void remove(t)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <h3 className="section-title">最近运行</h3>
          <ul className="run-history">
            {runs.length === 0 && <li className="muted">暂无运行记录。</li>}
            {runs.map((r) => (
              <li key={r.id}>
                <span className={`run-status run-status--${r.status}`}>
                  {r.status}
                </span>
                <span className="muted">触发：{r.trigger || "—"}</span>
                <span className="muted">
                  {new Date(r.started_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>

          {editing && (
            <TriggerEditor
              key={editing.trigger.id}
              graphId={graphId}
              initial={editing.trigger}
              isNew={editing.isNew}
              onClose={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                await load();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TriggerEditor({
  graphId,
  initial,
  isNew,
  onClose,
  onSaved,
}: {
  graphId: string;
  initial: TriggerConfig;
  isNew: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<TriggerConfig>(initial);
  const [graphs, setGraphs] = useState<{ id: string; name: string }[]>([]);
  const [rowsText, setRowsText] = useState<string>(
    initial.batch?.rows ? JSON.stringify(initial.batch.rows, null, 2) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (form.type === "event" && form.eventSource?.kind === "graph") {
      void api
        .listGraphs()
        .then(setGraphs)
        .catch(() => undefined);
    }
  }, [form.type, form.eventSource?.kind]);

  const patch = (p: Partial<TriggerConfig>) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    setError(null);
    if (!form.id.trim()) {
      setError("触发器 ID 不能为空");
      return;
    }
    const payload: TriggerConfig = { ...form, enabled: form.enabled ?? true };
    if (payload.type === "webhook" && !payload.webhookSecret?.trim()) {
      setError("Webhook 触发器需设置 secret");
      return;
    }
    if (payload.type === "cron" && !payload.cron?.trim()) {
      setError("定时触发器需设置 cron 表达式");
      return;
    }
    if (payload.type === "event" && !payload.eventSource?.id.trim()) {
      setError("事件触发器需设置事件源 ID");
      return;
    }
    if (payload.type === "batch") {
      const source = payload.batch?.source ?? "rows";
      if (source === "csv" && !payload.batch?.path?.trim()) {
        setError("CSV 批次需设置文件路径");
        return;
      }
      if (source === "rows") {
        try {
          const rows = rowsText.trim() ? JSON.parse(rowsText) : [];
          if (!Array.isArray(rows)) throw new Error("rows 必须是数组");
          payload.batch = { source: "rows", rows };
        } catch {
          setError("rows 必须是合法的 JSON 数组");
          return;
        }
      } else {
        payload.batch = { source: "csv", path: payload.batch?.path };
      }
    }
    setBusy(true);
    try {
      await api.createTrigger(graphId, payload);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="trigger-editor">
      <h3>{isNew ? "新建触发器" : `编辑触发器 · ${initial.id}`}</h3>

      <div className="editor-grid">
        <label className="field">
          <span>类型</span>
          <select
            value={form.type}
            onChange={(e) =>
              patch({ type: e.target.value as TriggerConfig["type"] })
            }
          >
            <option value="manual">手动</option>
            <option value="webhook">Webhook</option>
            <option value="cron">定时 (cron)</option>
            <option value="event">事件</option>
            <option value="batch">批量</option>
          </select>
        </label>
        <label className="field">
          <span>触发器 ID</span>
          <input
            value={form.id}
            disabled={!isNew}
            onChange={(e) => patch({ id: e.target.value })}
          />
        </label>
        <label className="field field--check">
          <input
            type="checkbox"
            checked={form.enabled !== false}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span>启用</span>
        </label>
      </div>

      {form.type === "webhook" && (
        <label className="field">
          <span>Webhook Secret</span>
          <input
            value={form.webhookSecret ?? ""}
            onChange={(e) => patch({ webhookSecret: e.target.value })}
            placeholder="调用 /webhook?secret= 时使用的密钥"
          />
        </label>
      )}

      {form.type === "cron" && (
        <label className="field">
          <span>Cron 表达式 (UTC)</span>
          <input
            value={form.cron ?? ""}
            onChange={(e) => patch({ cron: e.target.value })}
            placeholder="0 9 * * *"
          />
          <small className="muted">
            5 段：分 时 日 月 周。服务器以 UTC 计算下次运行。
          </small>
        </label>
      )}

      {form.type === "event" && (
        <>
          <label className="field">
            <span>事件源类型</span>
            <select
              value={form.eventSource?.kind ?? "graph"}
              onChange={(e) =>
                patch({
                  eventSource: {
                    kind: e.target.value as "graph" | "artifact",
                    id: form.eventSource?.id ?? "",
                  },
                })
              }
            >
              <option value="graph">另一个产线完成</option>
              <option value="artifact">某产物生成</option>
            </select>
          </label>
          {form.eventSource?.kind === "graph" ? (
            <label className="field">
              <span>监听的产线</span>
              <select
                value={form.eventSource?.id ?? ""}
                onChange={(e) =>
                  patch({ eventSource: { kind: "graph", id: e.target.value } })
                }
              >
                <option value="">— 选择产线 —</option>
                {graphs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.id})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>产物 ID</span>
              <input
                value={form.eventSource?.id ?? ""}
                onChange={(e) =>
                  patch({
                    eventSource: { kind: "artifact", id: e.target.value },
                  })
                }
                placeholder="如 art-123"
              />
            </label>
          )}
        </>
      )}

      {form.type === "batch" && (
        <>
          <label className="field">
            <span>输入来源</span>
            <select
              value={form.batch?.source ?? "rows"}
              onChange={(e) =>
                patch({
                  batch: {
                    ...(form.batch ?? { source: "rows" }),
                    source: e.target.value as "csv" | "rows",
                  },
                })
              }
            >
              <option value="rows">直接填写行 (JSON)</option>
              <option value="csv">CSV 文件</option>
            </select>
          </label>
          {form.batch?.source === "csv" ? (
            <label className="field">
              <span>CSV 文件路径</span>
              <input
                value={form.batch?.path ?? ""}
                onChange={(e) =>
                  patch({
                    batch: {
                      ...(form.batch ?? { source: "csv" }),
                      path: e.target.value,
                    },
                  })
                }
                placeholder="/data/inputs.csv"
              />
            </label>
          ) : (
            <label className="field">
              <span>行 (JSON 数组)</span>
              <textarea
                className="row-json"
                value={rowsText}
                onChange={(e) => setRowsText(e.target.value)}
                placeholder='[{"topic":"A"},{"topic":"B"}]'
                rows={4}
              />
            </label>
          )}
        </>
      )}

      {error && <div className="error-text">{error}</div>}
      <div className="btn-row">
        <button className="btn btn--sm" onClick={onClose}>
          取消
        </button>
        <button
          className="btn btn--primary btn--sm"
          onClick={() => void save()}
          disabled={busy}
        >
          保存
        </button>
      </div>
    </div>
  );
}
