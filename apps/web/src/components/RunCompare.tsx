import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface RunSummary {
  id: string;
  graph_id: string;
  graph_name: string;
  status: string;
  trigger: string;
  budget_usd: number | null;
  started_at: number;
  ended_at: number | null;
}

interface RunStats {
  nodes: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

interface NodeOutput {
  nodeId: string;
  output: string;
}

interface Props {
  open: boolean;
  graphId: string;
  onClose: () => void;
}

export default function RunCompare({ open, graphId, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runA, setRunA] = useState<string>("");
  const [runB, setRunB] = useState<string>("");
  const [statsA, setStatsA] = useState<RunStats | null>(null);
  const [statsB, setStatsB] = useState<RunStats | null>(null);
  const [outputsA, setOutputsA] = useState<NodeOutput[]>([]);
  const [outputsB, setOutputsB] = useState<NodeOutput[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && graphId) loadRuns();
  }, [open, graphId]);

  async function loadRuns() {
    try {
      const res = await fetch(`/api/runs?graphId=${graphId}&limit=50`);
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch {
      setRuns([]);
    }
  }

  async function compare() {
    if (!runA || !runB) return;
    setLoading(true);
    try {
      const [sA, sB, eA, eB] = await Promise.all([
        fetch(`/api/runs/${runA}/stats`).then((r) => r.json()),
        fetch(`/api/runs/${runB}/stats`).then((r) => r.json()),
        fetch(`/api/runs/${runA}/events`).then((r) => r.json()),
        fetch(`/api/runs/${runB}/events`).then((r) => r.json()),
      ]);
      setStatsA(sA);
      setStatsB(sB);
      setOutputsA(extractOutputs(eA.events ?? eA));
      setOutputsB(extractOutputs(eB.events ?? eB));
    } catch (e) {
      alert(t("modals:runCompare.compareFailed", { message: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  }

  function extractOutputs(events: any[]): NodeOutput[] {
    const out: NodeOutput[] = [];
    for (const ev of events) {
      if (ev.type === "node.finished" && ev.output) {
        out.push({ nodeId: ev.nodeId, output: ev.output });
      }
    }
    return out;
  }

  function diffText(a: string, b: string): { added: number; removed: number } {
    const aLines = new Set(a.split("\n"));
    const bLines = new Set(b.split("\n"));
    let added = 0, removed = 0;
    for (const l of bLines) if (!aLines.has(l)) added++;
    for (const l of aLines) if (!bLines.has(l)) removed++;
    return { added, removed };
  }

  if (!open) return null;

  const allNodeIds = [...new Set([...outputsA.map((o) => o.nodeId), ...outputsB.map((o) => o.nodeId)])];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal run-compare" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:runCompare.title")}</h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>

        <div className="run-compare__selectors">
          <div>
            <label className="label">{t("modals:runCompare.runA")}</label>
            <select className="input" value={runA} onChange={(e) => setRunA(e.target.value)}>
              <option value="">{t("modals:runCompare.selectRun")}</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.started_at).toLocaleString(i18n.language)} — {r.status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t("modals:runCompare.runB")}</label>
            <select className="input" value={runB} onChange={(e) => setRunB(e.target.value)}>
              <option value="">{t("modals:runCompare.selectRun")}</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.started_at).toLocaleString(i18n.language)} — {r.status}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn--sm" onClick={compare} disabled={!runA || !runB || loading}>
            {loading ? t("modals:runCompare.comparing") : t("modals:runCompare.start")}
          </button>
        </div>

        {statsA && statsB && (
          <div className="run-compare__stats">
            <h3>{t("modals:runCompare.statsTitle")}</h3>
            <table className="compare-table">
              <thead>
                <tr>
                  <th>{t("modals:runCompare.metric")}</th>
                  <th>{t("modals:runCompare.runA")}</th>
                  <th>{t("modals:runCompare.runB")}</th>
                  <th>{t("modals:runCompare.difference")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t("modals:runCompare.totalCost")}</td>
                  <td>${statsA.cost_usd.toFixed(4)}</td>
                  <td>${statsB.cost_usd.toFixed(4)}</td>
                  <td className={statsB.cost_usd > statsA.cost_usd ? "diff-up" : "diff-down"}>
                    {(statsB.cost_usd - statsA.cost_usd).toFixed(4)}
                  </td>
                </tr>
                <tr>
                  <td>{t("modals:runCompare.inputTokens")}</td>
                  <td>{statsA.tokens_in.toLocaleString(i18n.language)}</td>
                  <td>{statsB.tokens_in.toLocaleString(i18n.language)}</td>
                  <td>
                    {(statsB.tokens_in - statsA.tokens_in).toLocaleString(i18n.language)}
                  </td>
                </tr>
                <tr>
                  <td>{t("modals:runCompare.outputTokens")}</td>
                  <td>{statsA.tokens_out.toLocaleString(i18n.language)}</td>
                  <td>{statsB.tokens_out.toLocaleString(i18n.language)}</td>
                  <td>
                    {(statsB.tokens_out - statsA.tokens_out).toLocaleString(i18n.language)}
                  </td>
                </tr>
                <tr>
                  <td>{t("modals:runCompare.nodeCount")}</td>
                  <td>{statsA.nodes}</td>
                  <td>{statsB.nodes}</td>
                  <td>{statsB.nodes - statsA.nodes}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {outputsA.length > 0 && outputsB.length > 0 && (
          <div className="run-compare__outputs">
            <h3>{t("modals:runCompare.outputsTitle")}</h3>
            <div className="output-diff-list">
              {allNodeIds.map((nodeId) => {
                const a = outputsA.find((o) => o.nodeId === nodeId);
                const b = outputsB.find((o) => o.nodeId === nodeId);
                const diff = a && b ? diffText(a.output, b.output) : null;
                return (
                  <div key={nodeId} className="output-diff-item">
                    <div className="output-diff-item__head">
                      <span className="output-diff-item__node">{nodeId}</span>
                      {diff && (
                        <span className="muted">
                          {t("modals:runCompare.diffLines", {
                            added: diff.added,
                            removed: diff.removed,
                          })}
                        </span>
                      )}
                    </div>
                    <div className="output-diff-item__cols">
                      <div className="output-diff-col">
                        <div className="output-diff-col__label">A</div>
                        <pre className="output-diff-col__text">
                          {a?.output ?? t("modals:runCompare.noOutput")}
                        </pre>
                      </div>
                      <div className="output-diff-col">
                        <div className="output-diff-col__label">B</div>
                        <pre className="output-diff-col__text">
                          {b?.output ?? t("modals:runCompare.noOutput")}
                        </pre>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
