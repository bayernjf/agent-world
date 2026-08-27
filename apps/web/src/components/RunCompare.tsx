import { useEffect, useState } from "react";

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
      alert("对比失败: " + (e as Error).message);
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
          <h2>运行对比</h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>关闭</button>
        </div>

        <div className="run-compare__selectors">
          <div>
            <label className="label">运行 A</label>
            <select className="input" value={runA} onChange={(e) => setRunA(e.target.value)}>
              <option value="">选择运行...</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.started_at).toLocaleString()} — {r.status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">运行 B</label>
            <select className="input" value={runB} onChange={(e) => setRunB(e.target.value)}>
              <option value="">选择运行...</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.started_at).toLocaleString()} — {r.status}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn--sm" onClick={compare} disabled={!runA || !runB || loading}>
            {loading ? "对比中..." : "开始对比"}
          </button>
        </div>

        {statsA && statsB && (
          <div className="run-compare__stats">
            <h3>成本与用量对比</h3>
            <table className="compare-table">
              <thead>
                <tr>
                  <th>指标</th>
                  <th>运行 A</th>
                  <th>运行 B</th>
                  <th>差异 (B-A)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>总成本 (USD)</td>
                  <td>${statsA.cost_usd.toFixed(4)}</td>
                  <td>${statsB.cost_usd.toFixed(4)}</td>
                  <td className={statsB.cost_usd > statsA.cost_usd ? "diff-up" : "diff-down"}>
                    {(statsB.cost_usd - statsA.cost_usd).toFixed(4)}
                  </td>
                </tr>
                <tr>
                  <td>输入 Token</td>
                  <td>{statsA.tokens_in.toLocaleString()}</td>
                  <td>{statsB.tokens_in.toLocaleString()}</td>
                  <td>{(statsB.tokens_in - statsA.tokens_in).toLocaleString()}</td>
                </tr>
                <tr>
                  <td>输出 Token</td>
                  <td>{statsA.tokens_out.toLocaleString()}</td>
                  <td>{statsB.tokens_out.toLocaleString()}</td>
                  <td>{(statsB.tokens_out - statsA.tokens_out).toLocaleString()}</td>
                </tr>
                <tr>
                  <td>节点数</td>
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
            <h3>节点输出对比</h3>
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
                          +{diff.added} / -{diff.removed} 行
                        </span>
                      )}
                    </div>
                    <div className="output-diff-item__cols">
                      <div className="output-diff-col">
                        <div className="output-diff-col__label">A</div>
                        <pre className="output-diff-col__text">{a?.output ?? "(无输出)"}</pre>
                      </div>
                      <div className="output-diff-col">
                        <div className="output-diff-col__label">B</div>
                        <pre className="output-diff-col__text">{b?.output ?? "(无输出)"}</pre>
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
