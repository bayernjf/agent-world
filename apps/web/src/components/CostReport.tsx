import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CostReport as Report } from "../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
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

const fmtUsd = (n: number) => `$${n.toFixed(5)}`;
const fmtInt = (n: number) => n.toLocaleString("en-US");

export default function CostReport({ open, onClose }: Props) {
  const [range, setRange] = useState<Range>("30d");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    try {
      const bounds = rangeToBounds(r);
      setReport(await api.costReport(bounds.from, bounds.to));
    } finally {
      setLoading(false);
    }
  }, []);

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

  const maxDayCost = useMemo(
    () => (report ? Math.max(1, ...report.byDay.map((d) => d.cost_usd)) : 1),
    [report],
  );

  if (!open) return null;

  const t = report?.totals;
  const reworkCost =
    report?.byAttempt
      .filter((a) => a.attempt > 1)
      .reduce((sum, a) => sum + a.cost_usd, 0) ?? 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal--wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>成本报表</h2>
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
                  <div className="cost-stat__label">总电费</div>
                  <div className="cost-stat__value cost-stat__value--accent">
                    {fmtUsd(t.cost_usd)}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">运行次数</div>
                  <div className="cost-stat__value">{t.runs}</div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">输入 token</div>
                  <div className="cost-stat__value">{fmtInt(t.tokens_in)}</div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">输出 token</div>
                  <div className="cost-stat__value">{fmtInt(t.tokens_out)}</div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">缓存命中</div>
                  <div className="cost-stat__value">{fmtInt(t.cached_tokens)}</div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">返工电费</div>
                  <div className="cost-stat__value cost-stat__value--warn">
                    {fmtUsd(reworkCost)}
                  </div>
                </div>
              </div>

              {report.byDay.length > 0 && (
                <section className="cost-section">
                  <h3 className="cost-section__title">每日电费趋势</h3>
                  <div className="cost-chart">
                    {report.byDay.map((d) => (
                      <div className="cost-chart__col" key={d.day} title={`${d.day}: ${fmtUsd(d.cost_usd)} (${d.runs} 次)`}>
                        <div className="cost-chart__bar-wrap">
                          <div
                            className="cost-chart__bar"
                            style={{
                              height: `${Math.max(2, (d.cost_usd / maxDayCost) * 100)}%`,
                            }}
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
                        <th>运行</th>
                        <th className="num">输入</th>
                        <th className="num">输出</th>
                        <th className="num">电费</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byGraph.map((g) => (
                        <tr key={g.graph_id}>
                          <td className="run-table__name">{g.graph_name}</td>
                          <td>{g.runs}</td>
                          <td className="num mono">{fmtInt(g.tokens_in)}</td>
                          <td className="num mono">{fmtInt(g.tokens_out)}</td>
                          <td className="num mono">{fmtUsd(g.cost_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="cost-section">
                <h3 className="cost-section__title">最费钱的厂房（Top {report.byNode.length}）</h3>
                {report.byNode.length === 0 ? (
                  <p className="muted">暂无数据</p>
                ) : (
                  <table className="run-table cost-table">
                    <thead>
                      <tr>
                        <th>产线</th>
                        <th>厂房</th>
                        <th className="num">尝试</th>
                        <th className="num">返工</th>
                        <th className="num">电费</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byNode.map((n, i) => (
                        <tr key={`${n.graph_id}-${n.node_id}`}>
                          <td className="muted">{n.graph_name}</td>
                          <td className="mono">{n.node_id}</td>
                          <td className="num mono">{n.attempts}</td>
                          <td className="num mono">{n.reworks > 0 ? n.reworks : "—"}</td>
                          <td className="num mono">{fmtUsd(n.cost_usd)}</td>
                        </tr>
                      ))}
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
