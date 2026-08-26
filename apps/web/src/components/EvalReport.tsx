import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type EvalReport as Report } from "../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  graphId?: string;
}

type Range = "7d" | "30d" | "all";

const RANGE_LABEL: Record<Range, string> = {
  "7d": "近 7 天",
  "30d": "近 30 天",
  all: "全部",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeToBounds(range: Range): { from?: number; to?: number } {
  if (range === "all") return {};
  const days = range === "7d" ? 7 : 30;
  return { from: Date.now() - days * DAY_MS };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmtDuration = (ms: number) => {
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
};

function passTone(rate: number): string {
  if (rate >= 0.9) return "good";
  if (rate >= 0.6) return "warn";
  return "bad";
}

export default function EvalReport({ open, onClose, graphId }: Props) {
  const [range, setRange] = useState<Range>("30d");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (r: Range) => {
      setLoading(true);
      try {
        const bounds = rangeToBounds(r);
        setReport(await api.evalReport({ graphId, ...bounds }));
      } finally {
        setLoading(false);
      }
    },
    [graphId],
  );

  useEffect(() => {
    if (open) void load(range);
  }, [open, range, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const maxPass = useMemo(
    () => (report ? Math.max(0.0001, ...report.byDay.map((d) => d.passRate)) : 1),
    [report],
  );

  const promptsByGraph = useMemo(() => {
    const map = new Map<string, NonNullable<Report>["byPrompt"]>();
    for (const p of report?.byPrompt ?? []) {
      const arr = map.get(p.graph_id) ?? [];
      arr.push(p);
      map.set(p.graph_id, arr);
    }
    return map;
  }, [report]);

  if (!open) return null;

  const t = report?.totals;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>质量评估</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="seg">
              {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
                <button
                  key={r}
                  className={`seg__btn ${range === r ? "is-on" : ""}`}
                  onClick={() => setRange(r)}
                >
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
            <button className="icon-btn" onClick={onClose} title="关闭">
              ✕
            </button>
          </div>
        </div>

        <div className="modal__body">
          {loading || !report || !t ? (
            <p className="muted" style={{ textAlign: "center", padding: "40px 0" }}>
              {loading ? "加载中…" : "暂无数据"}
            </p>
          ) : (
            <>
              <div className="cost-stats">
                <div className="cost-stat">
                  <div className="cost-stat__label">合格率</div>
                  <div
                    className={`cost-stat__value cost-stat__value--${passTone(t.passRate)}`}
                  >
                    {pct(t.passRate)}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">运行次数</div>
                  <div className="cost-stat__value">{t.runs}</div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">通过 / 总数</div>
                  <div className="cost-stat__value">
                    {t.passed}/{t.runs}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">平均返工</div>
                  <div className="cost-stat__value">{t.avgRework.toFixed(2)}</div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">平均耗时</div>
                  <div className="cost-stat__value">{fmtDuration(t.avgDurationMs)}</div>
                </div>
              </div>

              {report.byDay.length > 0 && (
                <section className="cost-section">
                  <h3 className="cost-section__title">每日合格率趋势</h3>
                  <div className="cost-chart">
                    {report.byDay.map((d) => (
                      <div
                        className="cost-chart__col"
                        key={d.day}
                        title={`${d.day}: ${pct(d.passRate)} (${d.passed}/${d.runs})`}
                      >
                        <div className="cost-chart__bar-wrap">
                          <div
                            className={`cost-chart__bar cost-chart__bar--${passTone(d.passRate)}`}
                            style={{ height: `${Math.max(2, (d.passRate / maxPass) * 100)}%` }}
                          />
                        </div>
                        <div className="cost-chart__label">{d.day.slice(5)}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="cost-section">
                <h3 className="cost-section__title">按产线</h3>
                {report.byGraph.length === 0 ? (
                  <p className="muted">暂无数据</p>
                ) : (
                  <table className="run-table cost-table">
                    <thead>
                      <tr>
                        <th>产线</th>
                        <th className="num">运行</th>
                        <th className="num">合格率</th>
                        <th className="num">平均返工</th>
                        <th className="num">平均耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byGraph.map((g) => (
                        <tr key={g.graph_id}>
                          <td className="run-table__name">{g.graph_name}</td>
                          <td>{g.runs}</td>
                          <td className={`num mono eval-rate--${passTone(g.passRate)}`}>
                            {pct(g.passRate)}
                          </td>
                          <td className="num mono">{g.avgRework.toFixed(2)}</td>
                          <td className="num mono">{fmtDuration(g.avgDurationMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="cost-section">
                <h3 className="cost-section__title">Prompt 版本对比</h3>
                <p className="muted cost-section__hint">
                  同一产线每次修改 agent 的 prompt/模型会生成新版本（v1、v2…），用于对比改动前后的合格率。
                </p>
                {report.byPrompt.length === 0 ? (
                  <p className="muted">暂无数据</p>
                ) : (
                  <table className="run-table cost-table">
                    <thead>
                      <tr>
                        <th>产线</th>
                        <th>版本</th>
                        <th className="num">运行</th>
                        <th className="num">合格率</th>
                        <th className="num">平均返工</th>
                        <th className="num">平均耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...promptsByGraph.entries()].flatMap(([gid, rows]) =>
                        rows.map((p) => (
                          <tr key={`${gid}-${p.fingerprint}`}>
                            <td className="run-table__name">{p.graph_name}</td>
                            <td className="mono">
                              {p.version}
                              <span className="muted"> · {p.fingerprint}</span>
                            </td>
                            <td>{p.runs}</td>
                            <td className={`num mono eval-rate--${passTone(p.passRate)}`}>
                              {pct(p.passRate)}
                            </td>
                            <td className="num mono">{p.avgRework.toFixed(2)}</td>
                            <td className="num mono">{fmtDuration(p.avgDurationMs)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
