import { useEffect, useState } from "react";
import { UNIT_LABELS } from "@agent-world/core";
import { api, type AppConfig } from "../lib/api";
import { useGraph } from "../store/graph";
import { useVisibleRuntime } from "../store/run";

function formatUnits(units: Record<string, number> | undefined): string | null {
  if (!units) return null;
  const parts = Object.entries(units)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v}${UNIT_LABELS[k] ?? k}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

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

const ERROR_LABEL: Record<string, string> = {
  TIMEOUT: "超时",
  RATE_LIMIT: "限流",
  PROVIDER_ERROR: "模型服务错误",
  AUTH: "密钥错误",
  VALIDATION: "质检未通过",
  BUDGET: "节点预算超限",
  UNKNOWN: "未知错误",
  UNSUPPORTED: "暂不支持",
};

export default function Inspector() {
  const { graph, selectedId, updateNode, saveState } = useGraph();
  const runtime = useVisibleRuntime();
  const [tab, setTab] = useState<number | "diff">(1);
  const [showReasoning, setShowReasoning] = useState(false);
  const [settings, setSettings] = useState<AppConfig | null>(null);
  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {});
  }, []);
  const modelOptions = settings
    ? Object.entries(settings.providers)
        .filter(([, pp]) => pp.type !== "fake" && pp.enabled !== false)
        .flatMap(([pname, pp]) => pp.models.map((m) => ({ model: m, provider: pname })))
    : [];

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
  const reasoning = rt && activeAttempt ? rt.reasoning[activeAttempt] : undefined;
  const saveIndicator =
    saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败" : "";

  return (
    <aside className="panel inspector">
      <div className="panel__bar">
        <span>{node.name}</span>
        <span className="muted">{node.kind}</span>
      </div>

      <div className="inspector__body">
        <label className="field">
          <span>名称 {saveIndicator && <em className="save-state">{saveIndicator}</em>}</span>
          <input value={node.name} onChange={(e) => updateNode(node.id, { name: e.target.value })} />
        </label>

        {node.kind === "source" && (
          <div className="field">
            <span>参考图片 URL（视觉模型可看图）</span>
            <div className="image-list">
              {(node.source?.images ?? []).map((url, i) => (
                <div className="image-row" key={i}>
                  <input
                    value={url}
                    placeholder="https://..."
                    onChange={(e) => {
                      const images = [...(node.source?.images ?? [])];
                      images[i] = e.target.value;
                      updateNode(node.id, {
                        source: { ...(node.source ?? {}), images },
                      });
                    }}
                  />
                  <button
                    className="icon-btn icon-btn--danger"
                    title="移除"
                    onClick={() => {
                      const images = (node.source?.images ?? []).filter((_, j) => j !== i);
                      updateNode(node.id, {
                        source: { ...(node.source ?? {}), images },
                      });
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="btn image-list__add"
                onClick={() =>
                  updateNode(node.id, {
                    source: {
                      ...(node.source ?? {}),
                      images: [...(node.source?.images ?? []), ""],
                    },
                  })
                }
              >
                + 添加图片
              </button>
            </div>
          </div>
        )}

        {node.kind === "agent" && node.agent && (
          <>
            <label className="field">
              <span>模型</span>
              <select
                className="select"
                value={modelOptions.some((o) => o.model === node.agent!.model) ? node.agent.model : "__custom__"}
                onChange={(e) => {
                  if (e.target.value !== "__custom__") {
                    updateNode(node.id, { agent: { ...node.agent!, model: e.target.value } });
                  }
                }}
              >
                {modelOptions.map((o) => (
                  <option key={`${o.provider}::${o.model}`} value={o.model}>
                    {o.model} · {o.provider}
                  </option>
                ))}
                {!modelOptions.some((o) => o.model === node.agent!.model) && node.agent.model && (
                  <option value={node.agent.model}>{node.agent.model} (当前)</option>
                )}
              </select>
            </label>
            <label className="field">
              <span>温度 ({node.agent.temperature.toFixed(2)})</span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={node.agent.temperature}
                onChange={(e) =>
                  updateNode(node.id, {
                    agent: { ...node.agent!, temperature: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label className="field">
              <span>节点预算 (USD，留空不限制)</span>
              <input
                type="number"
                min="0"
                step="0.001"
                placeholder="不限制"
                value={node.agent.budgetUsd ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    agent: {
                      ...node.agent!,
                      budgetUsd: e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="field">
              <span>指令</span>
              <textarea
                rows={4}
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
              <span>质检标准</span>
              <textarea
                rows={3}
                placeholder="产出必须满足什么条件？不合格将沿返工线退回。"
                value={node.gate.criterion}
                onChange={(e) =>
                  updateNode(node.id, { gate: { ...node.gate!, criterion: e.target.value } })
                }
              />
            </label>
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

        {rt?.error && (
          <section className="error-box">
            <h3 className="label">{rt.errorCode ? ERROR_LABEL[rt.errorCode] ?? "错误" : "错误"}</h3>
            <p className="error-msg">{rt.error}</p>
            {rt.errorCode && <code className="error-code">{rt.errorCode}</code>}
          </section>
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
                  {rt.cachedTokens > 0 && <em className="muted"> (cache {rt.cachedTokens})</em>}
                </dd>
              </div>
              {formatUnits(rt.units) && (
                <div>
                  <dt>用量</dt>
                  <dd>{formatUnits(rt.units)}</dd>
                </div>
              )}
              {rt.costUsd > 0 && (
                <div>
                  <dt>电费</dt>
                  <dd>${rt.costUsd.toFixed(5)}</dd>
                </div>
              )}
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

            {reasoning && (
              <div className="reasoning">
                <button className="link" onClick={() => setShowReasoning((v) => !v)}>
                  {showReasoning ? "隐藏" : "查看"}思考过程
                </button>
                {showReasoning && <pre className="output reasoning__text">{reasoning}</pre>}
              </div>
            )}

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
