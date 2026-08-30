import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CostReport as Report } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Range = "7d" | "30d" | "all";
type Granularity = "day" | "week" | "month";

const RANGE_LABEL: Record<Range, string> = {
  "7d": "近 7 天",
  "30d": "近 30 天",
  all: "全部",
};

const GRAN_LABEL: Record<Granularity, string> = {
  day: "日",
  week: "周",
  month: "月",
};

/** Smart default granularity based on time range. */
function defaultGranularity(range: Range): Granularity {
  if (range === "7d") return "day";
  if (range === "30d") return "week";
  return "month";
}

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
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  // When the range changes, pick a sensible default granularity.
  useEffect(() => {
    setGranularity(defaultGranularity(range));
  }, [range]);

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

  const csvHref = useMemo(() => {
    const b = rangeToBounds(range);
    const qs = new URLSearchParams();
    if (b.from !== undefined) qs.set("from", String(b.from));
    if (b.to !== undefined) qs.set("to", String(b.to));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return `/api/costs.csv${suffix}`;
  }, [range]);

  const chartData = useMemo(() => {
    if (!report)
      return {
        rows: [] as Array<{
          cost_usd: number;
          runs: number;
          day?: string;
          week?: string;
          month?: string;
        }>,
        label: "日",
      };
    if (granularity === "week") return { rows: report.byWeek, label: "周" };
    if (granularity === "month") return { rows: report.byMonth, label: "月" };
    return { rows: report.byDay, label: "日" };
  }, [report, granularity]);

  const maxChartCost = useMemo(
    () => Math.max(1, ...chartData.rows.map((d) => d.cost_usd)),
    [chartData],
  );

  const chartLabel = (d: { day?: string; week?: string; month?: string }) => {
    if (granularity === "week") return d.week ? d.week.slice(2) : ""; // 2026-W33 → W33
    if (granularity === "month") return d.month ?? ""; // 2026-08
    return d.day ? d.day.slice(5) : ""; // MM-DD
  };

  const chartKey = (d: { day?: string; week?: string; month?: string }) =>
    d.day ?? d.week ?? d.month ?? "";

  if (!open) return null;

  const t = report?.totals;
  const reworkCost =
    report?.byAttempt
      .filter((a) => a.attempt > 1)
      .reduce((sum, a) => sum + a.cost_usd, 0) ?? 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
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
            <div className="seg">
              {(Object.keys(GRAN_LABEL) as Granularity[]).map((g) => (
                <button
                  key={g}
                  className={`seg__btn ${granularity === g ? "is-on" : ""}`}
                  onClick={() => setGranularity(g)}
                >
                  {GRAN_LABEL[g]}
                </button>
              ))}
            </div>
            <a
              className="chip"
              href={csvHref}
              download
              onClick={(e) => {
                if (!report) e.preventDefault();
              }}
            >
              导出 CSV
            </a>
            <Tooltip content="关闭">
              <button className="icon-btn" onClick={onClose}>
                ✕
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="modal__body">
          {loading || !report || !t ? (
            <p
              className="muted"
              style={{ textAlign: "center", padding: "40px 0" }}
            >
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
                  <div className="cost-stat__value">
                    {fmtInt(t.cached_tokens)}
                  </div>
                </div>
                <div className="cost-stat">
                  <div className="cost-stat__label">返工电费</div>
                  <div className="cost-stat__value cost-stat__value--warn">
                    {fmtUsd(reworkCost)}
                  </div>
                </div>
              </div>

              {chartData.rows.length > 0 && (
                <section className="cost-section">
                  <h3 className="cost-section__title">
                    {chartData.label}电费趋势
                  </h3>
                  <div className="cost-chart">
                    {chartData.rows.map((d) => (
                      <div
                        className="cost-chart__col"
                        key={chartKey(d)}
                        title={`${chartKey(d)}: ${fmtUsd(d.cost_usd)} (${d.runs} 次)`}
                      >
                        <div className="cost-chart__bar-wrap">
                          <div
                            className="cost-chart__bar"
                            style={{
                              height: `${Math.max(2, (d.cost_usd / maxChartCost) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="cost-chart__label">{chartLabel(d)}</div>
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
                <h3 className="cost-section__title">
                  最费钱的节点（Top {report.byNode.length}）
                </h3>
                {report.byNode.length === 0 ? (
                  <p className="muted">暂无数据</p>
                ) : (
                  <table className="run-table cost-table">
                    <thead>
                      <tr>
                        <th>产线</th>
                        <th>节点</th>
                        <th className="num">尝试</th>
                        <th className="num">返工</th>
                        <th className="num">电费</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byNode.map((n, i) => (
                        <tr key={`${n.graph_id}-${n.node_id}`}>
                          <td className="muted">{n.graph_name}</td>
                          <td className="mono">{n.node_name}</td>
                          <td className="num mono">{n.attempts}</td>
                          <td className="num mono">
                            {n.reworks > 0 ? n.reworks : "—"}
                          </td>
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
