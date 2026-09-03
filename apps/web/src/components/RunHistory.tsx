import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { api, type RunSummary } from "../lib/api";
import { runStatusLabel } from "../lib/run-status";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpen?: (runId: string) => void;
}

const PAGE_SIZES = [10, 20, 50, 100];
// Engine 真实 run status；这些是列表用的短标签，ControlPanel 状态行是另一套更长的说法
const STATUSES = [
  "running",
  "done",
  "halted",
  "failed",
  "tripped",
  "cancelled",
  "interrupted",
];

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
  if (diff < 60_000) return i18n.t("run:relative.justNow");
  if (diff < 3_600_000)
    return i18n.t("run:relative.minutesAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000)
    return i18n.t("run:relative.hoursAgo", { n: Math.floor(diff / 3_600_000) });
  return i18n.t("run:relative.daysAgo", { n: Math.floor(diff / 86_400_000) });
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return i18n.t("run:status.running");
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
  const { t, i18n } = useTranslation();
  const byId = new Map(runs.map((r) => [r.id, r]));
  const cols = selected.map((id) => ({
    id,
    run: byId.get(id),
    stat: stats[id],
  }));
  const rows: { label: string; get: (c: (typeof cols)[number]) => string }[] = [
    {
      label: t("run:history.graph"),
      get: (c) => c.run?.graph_name || t("run:history.unnamedGraph"),
    },
    {
      label: t("run:history.status"),
      get: (c) => (c.run ? runStatusLabel(c.run.status) : "—"),
    },
    { label: t("run:history.trigger"), get: (c) => c.run?.trigger ?? "—" },
    {
      label: t("run:history.started"),
      get: (c) => (c.run ? fmtRelative(c.run.started_at) : "—"),
    },
    {
      label: t("run:history.duration"),
      get: (c) =>
        c.run
          ? fmtDuration(
              c.run.ended_at != null ? c.run.ended_at - c.run.started_at : null,
            )
          : "—",
    },
    {
      label: t("run:history.nodeCount"),
      get: (c) => (c.stat ? String(c.stat.nodes) : "—"),
    },
    {
      label: t("run:history.tokensIn"),
      get: (c) => (c.stat ? c.stat.tokensIn.toLocaleString(i18n.language) : "—"),
    },
    {
      label: t("run:history.tokensOut"),
      get: (c) =>
        c.stat ? c.stat.tokensOut.toLocaleString(i18n.language) : "—",
    },
    {
      label: t("run:history.cost"),
      get: (c) => (c.stat ? `$${c.stat.costUsd.toFixed(4)}` : "—"),
    },
  ];
  return (
    <div>
      <div className="dialog-actions" style={{ marginBottom: 8 }}>
        <button className="btn" onClick={onBack}>
          {t("run:history.backToList")}
        </button>
      </div>
      <table className="compare-table">
        <thead>
          <tr>
            <th>{t("run:history.metric")}</th>
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
  const { t } = useTranslation();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [graphs, setGraphs] = useState<{ id: string; name: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
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
        limit: pageSize,
        offset: page * pageSize,
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
    api
      .listGraphs()
      .then((g) => setGraphs(g.map((x) => ({ id: x.id, name: x.name }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reload the page whenever the page or filters change.
  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, graphId, status, open]);

  if (!open) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const changePageSize = (size: number) => {
    setPageSize(size);
    setPage(0);
  };

  const toggleSelect = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  const handleRerun = async (r: RunSummary) => {
    setErrorMsg("");
    setRerunning(r.id);
    try {
      const { runId } = await api.rerunRun(r.id);
      load();
      onOpen?.(runId);
    } catch (e) {
      setErrorMsg(
        t("run:history.rerunFailed", { message: (e as Error).message }),
      );
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
      <div
        className="modal modal--wide modal--tall"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>{t("run:history.title")}</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={() => setCompareMode((v) => !v)}>
              {compareMode
                ? t("run:history.exitCompare")
                : t("run:history.enterCompare")}
            </button>
            <Tooltip content={t("common.close")}>
              <button className="icon-btn" onClick={onClose}>
                ✕
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="runhistory-filters">
          <label>
            {t("run:history.graph")}
            <select
              value={graphId}
              onChange={(e) => {
                setGraphId(e.target.value);
                setPage(0);
              }}
            >
              <option value="">{t("run:history.all")}</option>
              {graphs.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("run:history.status")}
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">{t("run:history.all")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {runStatusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <span className="runhistory-count">
            {t("run:history.total", { n: total })}
          </span>
        </div>
        <div className="modal__body runhistory-body">
          {errorMsg && <div className="runhistory-error">{errorMsg}</div>}

          {comparing ? (
            <CompareView
              runs={runs}
              selected={selected}
              stats={stats}
              onBack={() => setComparing(false)}
            />
          ) : (
            <>
              <div className="runhistory-list">
                {loading && <div className="note">{t("run:history.loading")}</div>}
                {!loading && runs.length === 0 && (
                  <div className="note">{t("run:history.empty")}</div>
                )}
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
                        <span
                          className={`run-status ${STATUS_COLOR[r.status] ?? "run-status--default"}`}
                        >
                          {runStatusLabel(r.status)}
                        </span>
                        <span className="runhistory-name">
                          {r.graph_name || t("run:history.unnamedGraph")}
                        </span>
                        <span className="runhistory-id">
                          {r.id.slice(0, 8)}
                        </span>
                      </div>
                      <div className="runhistory-row-meta">
                        <span>{fmtRelative(r.started_at)}</span>
                        <span>
                          {t("run:history.duration")}{" "}
                          {fmtDuration(
                            r.ended_at != null
                              ? r.ended_at - r.started_at
                              : null,
                          )}
                        </span>
                        <span>{r.trigger}</span>
                        {r.budget_usd != null && (
                          <span>
                            {t("run:history.budget", {
                              amount: r.budget_usd.toFixed(4),
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    {r.status !== "running" && (
                      <button
                        className="btn runhistory-rerun"
                        disabled={rerunning === r.id}

                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRerun(r);
                        }}
                      >
                        {rerunning === r.id
                          ? t("run:history.rerunning")
                          : t("run:history.rerun")}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="runhistory-pager">
                <label className="runhistory-pager-size">
                  {t("run:history.perPage")}
                  <select
                    value={pageSize}
                    onChange={(e) => changePageSize(Number(e.target.value))}
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  {t("run:history.perPageUnit")}
                </label>
                <button
                  className="btn"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  {t("run:history.prevPage")}
                </button>
                <span>
                  {t("run:history.pageInfo", {
                    page: page + 1,
                    pages: pageCount,
                  })}
                </span>
                <button
                  className="btn"
                  disabled={(page + 1) * pageSize >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("run:history.nextPage")}
                </button>
                {compareMode && (
                  <button
                    className="btn btn--primary"
                    disabled={selected.length < 2}
                    onClick={runCompare}
                  >
                    {t("run:history.compareSelected", { n: selected.length })}
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
