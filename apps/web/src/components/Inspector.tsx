import { useState } from "react";
import { useGraph } from "../store/graph";
import { useVisibleRuntime } from "../store/run";

/** Cheap line-level diff — enough to see what a rework attempt actually changed. */
function diffLines(a: string, b: string) {
  const left = a.split(/(?<=\s)/);
  const right = b.split(/(?<=\s)/);
  const out: { text: string; kind: "same" | "add" | "del" }[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      out.push({ text: left[i]!, kind: "same" });
      i++;
      j++;
    } else if (j < right.length && !left.includes(right[j]!, i)) {
      out.push({ text: right[j]!, kind: "add" });
      j++;
    } else if (i < left.length) {
      out.push({ text: left[i]!, kind: "del" });
      i++;
    } else {
      out.push({ text: right[j]!, kind: "add" });
      j++;
    }
  }
  return out;
}

export default function Inspector() {
  const { graph, selectedId, updateNode } = useGraph();
  const runtime = useVisibleRuntime();
  const [tab, setTab] = useState<number | "diff">(1);

  const node = graph.nodes.find((n) => n.id === selectedId);
  if (!node) {
    return (
      <aside className="panel inspector">
        <div className="panel__bar">
          <span>厂房详情</span>
        </div>
        <p className="empty">选中一座厂房查看详情</p>
      </aside>
    );
  }

  const rt = runtime.nodes[node.id];
  const attempts = Object.keys(rt?.outputs ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  const showDiff = tab === "diff" && attempts.length >= 2;
  const activeAttempt = typeof tab === "number" ? tab : attempts.at(-1)!;

  const prev = attempts.at(-2);
  const last = attempts.at(-1);

  return (
    <aside className="panel inspector">
      <div className="panel__bar">
        <span>{node.name}</span>
        <span className="muted">{node.kind}</span>
      </div>

      <div className="inspector__body">
        <label className="field">
          <span>名称</span>
          <input value={node.name} onChange={(e) => updateNode(node.id, { name: e.target.value })} />
        </label>

        {node.kind === "agent" && node.agent && (
          <>
            <label className="field">
              <span>模型</span>
              <input
                value={node.agent.model}
                onChange={(e) =>
                  updateNode(node.id, { agent: { ...node.agent!, model: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>指令</span>
              <textarea
                rows={3}
                value={node.agent.prompt}
                onChange={(e) =>
                  updateNode(node.id, { agent: { ...node.agent!, prompt: e.target.value } })
                }
              />
            </label>
          </>
        )}

        {node.kind === "gate" && node.gate && (
          <>
            <label className="field">
              <span>返工次数上限</span>
              <input
                type="number"
                min={1}
                max={10}
                value={node.gate.maxAttempts}
                onChange={(e) =>
                  updateNode(node.id, {
                    gate: { ...node.gate!, maxAttempts: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              <span>次数耗尽后</span>
              <select
                value={node.gate.onExhausted}
                onChange={(e) =>
                  updateNode(node.id, {
                    gate: {
                      ...node.gate!,
                      onExhausted: e.target.value as "pass" | "scrap" | "halt",
                    },
                  })
                }
              >
                <option value="halt">停线等人工</option>
                <option value="scrap">报废</option>
                <option value="pass">放行</option>
              </select>
            </label>
          </>
        )}

        {rt && (
          <section className="usage">
            <h3 className="label">本次运行</h3>
            <dl>
              <div>
                <dt>状态</dt>
                <dd>{rt.status}</dd>
              </div>
              <div>
                <dt>尝试</dt>
                <dd>{rt.attempt}</dd>
              </div>
              <div>
                <dt>token</dt>
                <dd>
                  {rt.tokensIn} / {rt.tokensOut}
                </dd>
              </div>
              <div>
                <dt>电费</dt>
                <dd>${rt.costUsd.toFixed(5)}</dd>
              </div>
            </dl>
          </section>
        )}

        {attempts.length > 0 && (
          <section className="attempts">
            <h3 className="label">产出</h3>
            <div className="tabs">
              {attempts.map((a) => (
                <button
                  key={a}
                  className={`chip ${tab === a ? "is-on" : ""}`}
                  onClick={() => setTab(a)}
                >
                  尝试 {a}
                </button>
              ))}
              {attempts.length >= 2 && (
                <button
                  className={`chip ${tab === "diff" ? "is-on" : ""}`}
                  onClick={() => setTab("diff")}
                >
                  对比
                </button>
              )}
            </div>

            {showDiff ? (
              <pre className="output output--diff">
                {diffLines(rt!.outputs[prev!] ?? "", rt!.outputs[last!] ?? "").map((p, i) => (
                  <span key={i} className={`d-${p.kind}`}>
                    {p.text}
                  </span>
                ))}
              </pre>
            ) : (
              <pre className="output">{rt?.outputs[activeAttempt] ?? ""}</pre>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
