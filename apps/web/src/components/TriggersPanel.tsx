import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type RunSummary, type TriggerConfig } from "../lib/api";
import i18n from "../i18n";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
  graphId: string;
}

const TYPE_LABELS: Record<TriggerConfig["type"], string> = {
  manual: "modals:triggers.typeShort.manual",
  webhook: "modals:triggers.typeShort.webhook",
  cron: "modals:triggers.typeShort.cron",
  event: "modals:triggers.typeShort.event",
  batch: "modals:triggers.typeShort.batch",
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
      return t.webhookSecret
        ? `secret: ${t.webhookSecret}`
        : i18n.t("modals:triggers.summarize.noSecret");
    case "cron":
      return t.cron ?? i18n.t("modals:triggers.summarize.noCron");
    case "event":
      return t.eventSource
        ? `${t.eventSource.kind}:${t.eventSource.id}`
        : i18n.t("modals:triggers.summarize.noEventSource");
    case "batch":
      return t.batch
        ? `${t.batch.source}${t.batch.path ? ` (${t.batch.path})` : ""}`
        : i18n.t("modals:triggers.summarize.noBatch");
    default:
      return "";
  }
}

function fmtTime(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleString() : "—";
}

export default function TriggersPanel({ open, onClose, graphId }: Props) {
  const { t } = useTranslation();
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
      setError(e instanceof Error ? e.message : t("modals:triggers.loadFailed"));
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

  const fire = async (trigger: TriggerConfig) => {
    setBusyId(trigger.id);
    setError(null);
    try {
      await api.fireTrigger(graphId, trigger.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:triggers.fireFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (trigger: TriggerConfig) => {
    setError(null);
    try {
      await api.deleteTrigger(graphId, trigger.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:triggers.removeFailed"));
    }
  };

  const toggleEnabled = async (trigger: TriggerConfig) => {
    setError(null);
    try {
      await api.createTrigger(graphId, { ...trigger, enabled: !(trigger.enabled ?? true) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:triggers.updateFailed"));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:triggers.panelTitle")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <div className="triggers-toolbar">
            <p className="muted">{t("modals:triggers.intro")}</p>
            <button
              className="btn btn--primary btn--sm"
              onClick={() =>
                setEditing({ trigger: blankTrigger(), isNew: true })
              }
            >
              {t("modals:triggers.addTriggerButton")}
            </button>
          </div>

          {error && <div className="error-text">{error}</div>}

          <ul className="trigger-list">
            {triggers.length === 0 && (
              <li className="muted">{t("modals:triggers.emptyList")}</li>
            )}
            {triggers.map((trg) => (
              <li key={trg.id} className="trigger-row">
                <div className="trigger-main">
                  <span className={`badge badge--${trg.type}`}>
                    {t(TYPE_LABELS[trg.type])}
                  </span>
                  <span className="trigger-id">{trg.id}</span>
                  {trg.enabled === false && (
                    <span className="badge badge--off">
                      {t("modals:triggers.disabledBadge")}
                    </span>
                  )}
                  <span className="muted trigger-summary">{summarize(trg)}</span>
                </div>
                <div className="trigger-meta">
                  {trg.type === "cron" && (
                    <span>⏱ {fmtTime(nextRuns[trg.id])}</span>
                  )}
                  {trg.type === "webhook" && (
                    <code className="muted">
                      {t("modals:triggers.editor.webhookHint", {
                        graphId,
                        secret: trg.webhookSecret,
                      })}
                    </code>
                  )}
                </div>
                <div className="trigger-actions">
                  <label className="trigger-toggle">
                    <input
                      type="checkbox"
                      checked={trg.enabled !== false}
                      onChange={() => void toggleEnabled(trg)}
                    />
                    {t("modals:triggers.enabled")}
                  </label>
                  <button
                    className="ghost-btn"
                    disabled={busyId === trg.id}
                    onClick={() => void fire(trg)}
                  >
                    {t("modals:triggers.runOnce")}
                  </button>
                  <button
                    className="ghost-btn"
                    onClick={() => setEditing({ trigger: trg, isNew: false })}
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    className="ghost-btn ghost-btn--danger"
                    onClick={() => void remove(trg)}
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <h3 className="section-title">{t("modals:triggers.recentRuns")}</h3>
          <ul className="run-history">
            {runs.length === 0 && <li className="muted">{t("modals:triggers.noRuns")}</li>}
            {runs.map((r) => (
              <li key={r.id}>
                <span className={`run-status run-status--${r.status}`}>
                  {r.status}
                </span>
                <span className="muted">
                  {t("modals:triggers.triggeredBy", {
                    trigger: r.trigger || "—",
                  })}
                </span>
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
  const { t } = useTranslation();
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
      setError(t("modals:triggers.editor.errIdEmpty"));
      return;
    }
    const payload: TriggerConfig = { ...form, enabled: form.enabled ?? true };
    if (payload.type === "webhook" && !payload.webhookSecret?.trim()) {
      setError(t("modals:triggers.editor.errWebhookSecret"));
      return;
    }
    if (payload.type === "cron" && !payload.cron?.trim()) {
      setError(t("modals:triggers.editor.errCron"));
      return;
    }
    if (payload.type === "event" && !payload.eventSource?.id.trim()) {
      setError(t("modals:triggers.editor.errEventSource"));
      return;
    }
    if (payload.type === "batch") {
      const source = payload.batch?.source ?? "rows";
      if (source === "csv" && !payload.batch?.path?.trim()) {
        setError(t("modals:triggers.editor.errCsvPath"));
        return;
      }
      if (source === "rows") {
        try {
          const rows = rowsText.trim() ? JSON.parse(rowsText) : [];
          if (!Array.isArray(rows))
            throw new Error(t("modals:triggers.editor.errRowsArray"));
          payload.batch = { source: "rows", rows };
        } catch {
          setError(t("modals:triggers.editor.errRowsJson"));
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
      setError(e instanceof Error ? e.message : t("modals:triggers.editor.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="trigger-editor">
      <h3>
        {isNew
          ? t("modals:triggers.editor.create")
          : t("modals:triggers.editor.edit", { id: initial.id })}
      </h3>

      <div className="editor-grid">
        <label className="field">
          <span>{t("modals:triggers.editor.type")}</span>
          <select
            value={form.type}
            onChange={(e) =>
              patch({ type: e.target.value as TriggerConfig["type"] })
            }
          >
            <option value="manual">{t("modals:triggers.editor.typeManual")}</option>
            <option value="webhook">{t("modals:triggers.editor.typeWebhook")}</option>
            <option value="cron">{t("modals:triggers.editor.typeCron")}</option>
            <option value="event">{t("modals:triggers.editor.typeEvent")}</option>
            <option value="batch">{t("modals:triggers.editor.typeBatch")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("modals:triggers.editor.triggerId")}</span>
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
          <span>{t("modals:triggers.enabled")}</span>
        </label>
      </div>

      {form.type === "webhook" && (
        <label className="field">
          <span>{t("modals:triggers.editor.webhookSecret")}</span>
          <input
            value={form.webhookSecret ?? ""}
            onChange={(e) => patch({ webhookSecret: e.target.value })}
            placeholder={t("modals:triggers.editor.webhookSecretPlaceholder")}
          />
        </label>
      )}

      {form.type === "cron" && (
        <label className="field">
          <span>{t("modals:triggers.editor.cronExpr")}</span>
          <input
            value={form.cron ?? ""}
            onChange={(e) => patch({ cron: e.target.value })}
            placeholder="0 9 * * *"
          />
          <small className="muted">{t("modals:triggers.editor.cronHint")}</small>
        </label>
      )}

      {form.type === "event" && (
        <>
          <label className="field">
            <span>{t("modals:triggers.editor.eventSourceType")}</span>
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
              <option value="graph">{t("modals:triggers.editor.eventGraph")}</option>
              <option value="artifact">{t("modals:triggers.editor.eventArtifact")}</option>
            </select>
          </label>
          {form.eventSource?.kind === "graph" ? (
            <label className="field">
              <span>{t("modals:triggers.editor.listenGraph")}</span>
              <select
                value={form.eventSource?.id ?? ""}
                onChange={(e) =>
                  patch({ eventSource: { kind: "graph", id: e.target.value } })
                }
              >
                <option value="">{t("modals:triggers.editor.selectGraph")}</option>
                {graphs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.id})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>{t("modals:triggers.editor.artifactId")}</span>
              <input
                value={form.eventSource?.id ?? ""}
                onChange={(e) =>
                  patch({
                    eventSource: { kind: "artifact", id: e.target.value },
                  })
                }
                placeholder={t("modals:triggers.editor.artifactPlaceholder")}
              />
            </label>
          )}
        </>
      )}

      {form.type === "batch" && (
        <>
          <label className="field">
            <span>{t("modals:triggers.editor.inputSource")}</span>
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
              <option value="rows">{t("modals:triggers.editor.sourceRows")}</option>
              <option value="csv">{t("modals:triggers.editor.sourceCsv")}</option>
            </select>
          </label>
          {form.batch?.source === "csv" ? (
            <label className="field">
              <span>{t("modals:triggers.editor.csvPath")}</span>
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
              <span>{t("modals:triggers.editor.rowsLabel")}</span>
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
          {t("common.cancel")}
        </button>
        <button
          className="btn btn--primary btn--sm"
          onClick={() => void save()}
          disabled={busy}
        >
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}
