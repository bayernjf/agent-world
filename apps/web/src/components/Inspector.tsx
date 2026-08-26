import { useEffect, useRef, useState } from "react";
import { UNIT_LABELS, artifactLabel, type Artifact, type Graph } from "@agent-world/core";
import { api, type AppConfig } from "../lib/api";
import { useGraph } from "../store/graph";
import { useVisibleRuntime } from "../store/run";
import SkillPicker from "./SkillPicker";
import FinishedProduct from "./FinishedProduct";
import SourceImages from "./SourceImages";
import ConnectorEditor from "./ConnectorEditor";

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
  const { graph, selectedId, updateNode, saveState, reloadGraph } = useGraph();
  const runtime = useVisibleRuntime();
  const [tab, setTab] = useState<number | "diff">(1);
  const [showReasoning, setShowReasoning] = useState(false);
  const [settings, setSettings] = useState<AppConfig | null>(null);

  // Group a free-text edit (name, prompt, criterion, image URL) into a single
  // undo entry: pause tracking on focus, then on blur append the pre-edit graph
  // as one history entry. Without this every keystroke would be undoable.
  const editStartRef = useRef<Graph | null>(null);
  const beginEdit = () => {
    editStartRef.current = graph;
    useGraph.temporal.getState().pause();
  };
  const commitEdit = () => {
    const temporal = useGraph.temporal.getState();
    const start = editStartRef.current;
    temporal.resume();
    if (start && start !== graph) {
      const setTemporal = useGraph.temporal as unknown as {
        setState: (fn: (st: { pastStates: unknown[]; futureStates: unknown[] }) => {
          pastStates: unknown[];
          futureStates: unknown[];
        }) => void;
      };
      setTemporal.setState((st) => ({
        pastStates: [...st.pastStates, { graph: start }],
        futureStates: [],
      }));
    }
    editStartRef.current = null;
  };

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
  const artifacts = rt?.artifacts ?? [];
  const saveIndicator =
    saveState === "saving"
      ? "保存中…"
      : saveState === "saved"
        ? "已保存"
        : saveState === "error"
          ? "保存失败"
          : "";

  return (
    <aside className="panel inspector">
      <div className="panel__bar">
        <span>{node.name}</span>
        <span className="muted">{node.kind}</span>
        {rt?.lastVerdict?.score != null && (
          <span
            className={`chip chip--score chip--score-${rt.lastVerdict.score >= 7 ? "good" : rt.lastVerdict.score >= 4 ? "warn" : "bad"}`}
            title={`质检评分 ${rt.lastVerdict.score}/10 — ${rt.lastVerdict.reason}`}
          >
            质量 {rt.lastVerdict.score}/10
          </span>
        )}
      </div>

      <div className="inspector__body">
        {saveState === "conflict" && (
          <div className="conflict-banner" role="alert">
            <span>该产线已在其他标签页被修改，当前改动未保存。</span>
            <button type="button" className="btn btn--small" onClick={() => void reloadGraph()}>
              重新载入
            </button>
          </div>
        )}
        <label className="field">
          <span>名称 {saveIndicator && <em className="save-state">{saveIndicator}</em>}</span>
          <input
            value={node.name}
            onFocus={beginEdit}
            onBlur={commitEdit}
            onChange={(e) => updateNode(node.id, { name: e.target.value })}
          />
        </label>

        {node.kind === "source" && (
          <SourceImages
            nodeId={node.id}
            images={node.source?.images ?? []}
            onBeginEdit={beginEdit}
            onCommitEdit={commitEdit}
          />
        )}

        {node.kind === "source" && (
          <>
          <div className="source-brief">
            <div className="source-brief__head label">创作简报（可选）</div>
          <label className="field">
            <span>商品名称</span>
            <input
              value={node.source?.productName ?? ""}
              placeholder="商品名称"
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  source: { ...(node.source ?? {}), productName: e.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>品牌 / 店铺</span>
            <input
              value={node.source?.brand ?? ""}
              placeholder="品牌 / 店铺"
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  source: { ...(node.source ?? {}), brand: e.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>目标人群（如 20-30岁通勤女生）</span>
            <input
              value={node.source?.audience ?? ""}
              placeholder="目标人群（如 20-30岁通勤女生）"
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  source: { ...(node.source ?? {}), audience: e.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>价格定位（如 中端 99-199 元）</span>
            <input
              value={node.source?.priceRange ?? ""}
              placeholder="价格定位（如 中端 99-199 元）"
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  source: { ...(node.source ?? {}), priceRange: e.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>语气调性（如 真诚种草、口语化）</span>
            <input
              value={node.source?.tone ?? ""}
              placeholder="语气调性（如 真诚种草、口语化）"
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) =>
                updateNode(node.id, {
                  source: { ...(node.source ?? {}), tone: e.target.value },
                })
              }
            />
          </label>
            <label className="field">
              <span>禁用词 / 禁用说法</span>
              <textarea
                rows={2}
                value={node.source?.prohibited ?? ""}
                placeholder="用逗号或换行分隔，如 最、第一、国家级"
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, {
                    source: { ...(node.source ?? {}), prohibited: e.target.value },
                  })
                }
              />
            </label>
            <label className="field">
              <span>品牌词（建议融入）</span>
              <textarea
                rows={2}
                value={node.source?.brandTerms ?? ""}
                placeholder="用逗号或换行分隔，如 显瘦、透气、百搭"
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, {
                    source: { ...(node.source ?? {}), brandTerms: e.target.value },
                  })
                }
              />
              <button
                type="button"
                className="ghost-btn"
                onClick={async () => {
                  const terms = await api.listBrandTerms();
                  const cur = (node.source?.brandTerms ?? "")
                    .split(/[\n,，、;；\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const merged = [...new Set([...cur, ...terms.map((t) => t.term)])].join("、");
                  updateNode(node.id, {
                    source: { ...(node.source ?? {}), brandTerms: merged },
                  });
                }}
              >
                从品牌词库载入
              </button>
            </label>
            <label className="field">
              <span>补充说明</span>
              <textarea
                rows={3}
                value={node.source?.notes ?? ""}
                placeholder="其他想让写手知道的背景、卖点、参考风格等"
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, {
                    source: { ...(node.source ?? {}), notes: e.target.value },
                  })
                }
              />
            </label>
          </div>

          <ConnectorEditor
            connector={node.source?.connector}
            onChange={(c) => updateNode(node.id, { source: { ...(node.source ?? {}), connector: c } })}
            onBeginEdit={beginEdit}
            onCommitEdit={commitEdit}
          />
          </>
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
              <span>输入策略</span>
              <select
                className="select"
                value={node.agent.inputPolicy?.mode ?? "all"}
                onChange={(e) =>
                  updateNode(node.id, {
                    agent: {
                      ...node.agent!,
                      inputPolicy: {
                        ...(node.agent!.inputPolicy ?? { mode: "all" as const }),
                        mode: e.target.value as "all" | "last" | "truncate" | "summary",
                      },
                    },
                  })
                }
              >
                <option value="all">全部拼接（默认）</option>
                <option value="last">仅最近上游</option>
                <option value="truncate">截断保留尾部</option>
                <option value="summary">摘要压缩（超阈值时）</option>
              </select>
            </label>
            <p className="note">
              {(() => {
                switch (node.agent.inputPolicy?.mode ?? "all") {
                  case "all":
                    return "默认：把全部上游输出按顺序拼接后作为输入。";
                  case "last":
                    return "只取最近一个上游节点的输出作为输入。";
                  case "truncate":
                    return "超过「最大字符数」时丢弃前面的内容、保留尾部最近片段（不调用模型，零额外开销）。";
                  case "summary":
                    return "超过「最大字符数」时调用 LLM 滚动摘要压缩、保留关键信息（更省 context，但会产生少量额外 token 消耗）；未超阈值则原样传递。";
                  default:
                    return "";
                }
              })()}
            </p>
            {(node.agent.inputPolicy?.mode === "truncate" ||
              node.agent.inputPolicy?.mode === "summary") && (
              <label className="field">
                <span>最大字符数</span>
                <input
                  type="number"
                  min="500"
                  step="500"
                  value={node.agent.inputPolicy?.maxChars ?? 8000}
                  onChange={(e) =>
                    updateNode(node.id, {
                      agent: {
                        ...node.agent!,
                        inputPolicy: {
                          mode: node.agent?.inputPolicy?.mode ?? "truncate",
                          maxChars: Number(e.target.value),
                        },
                      },
                    })
                  }
                />
              </label>
            )}
            <label className="field">
              <span>指令</span>
              <textarea
                rows={4}
                value={node.agent.prompt}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, { agent: { ...node.agent!, prompt: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>排版指令（图片位置/比例，下次运行生效）</span>
              <textarea
                rows={3}
                placeholder="例：主图用竖图 3:4 居中；场景图卡用 2 列网格；细节图靠右"
                value={node.agent.imageDirectives ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    agent: { ...node.agent!, imageDirectives: e.target.value },
                  })
                }
              />
            </label>
            <SkillPicker
              mounted={node.agent.skills}
              onChange={(skills) =>
                updateNode(node.id, { agent: { ...node.agent!, skills } })
              }
            />
          </>
        )}

        {node.kind === "imageGen" && node.imageGen && (
          <>
            <label className="field">
              <span>生图模型</span>
              <select
                className="select"
                value={
                  modelOptions.some((o) => o.model === node.imageGen!.model)
                    ? node.imageGen.model
                    : "__custom__"
                }
                onChange={(e) => {
                  if (e.target.value !== "__custom__") {
                    updateNode(node.id, { imageGen: { ...node.imageGen!, model: e.target.value } });
                  }
                }}
              >
                {modelOptions.map((o) => (
                  <option key={`${o.provider}::${o.model}`} value={o.model}>
                    {o.model} · {o.provider}
                  </option>
                ))}
                {!modelOptions.some((o) => o.model === node.imageGen!.model) && node.imageGen.model && (
                  <option value={node.imageGen.model}>{node.imageGen.model} (当前)</option>
                )}
              </select>
            </label>
            <label className="field">
              <span>尺寸 (如 1024x1024)</span>
              <input
                type="text"
                placeholder="1024x1024"
                value={node.imageGen.size ?? ""}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, {
                    imageGen: { ...node.imageGen!, size: e.target.value || undefined },
                  })
                }
              />
            </label>
            <label className="field">
              <span>生图提示词（留空则按品牌简报自动生成）</span>
              <textarea
                rows={4}
                placeholder="如：清新日系风格的主图，突出产品质感"
                value={node.imageGen.prompt ?? ""}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, { imageGen: { ...node.imageGen!, prompt: e.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>生成数量 (1–8)</span>
              <input
                type="number"
                min={1}
                max={8}
                value={node.imageGen.n ?? 1}
                onFocus={beginEdit}
                onBlur={commitEdit}
                onChange={(e) =>
                  updateNode(node.id, {
                    imageGen: {
                      ...node.imageGen!,
                      n: Math.min(8, Math.max(1, Number(e.target.value) || 1)),
                    },
                  })
                }
              />
            </label>
            <details className="adv">
              <summary>自定义端点（可选）</summary>
              <label className="field">
                <span>生图端点 baseURL</span>
                <input
                  type="text"
                  placeholder="https://your-sd-server/v1"
                  value={node.imageGen.baseUrl ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, { imageGen: { ...node.imageGen!, baseUrl: e.target.value || undefined } })
                  }
                />
              </label>
              <label className="field">
                <span>密钥（可选，留空用 provider 的 key）</span>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={node.imageGen.apiKey ?? ""}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) =>
                    updateNode(node.id, { imageGen: { ...node.imageGen!, apiKey: e.target.value || undefined } })
                  }
                />
              </label>
            </details>
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
                onFocus={beginEdit}
                onBlur={commitEdit}
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
              <span>质量分门槛（0–10，留空不卡）</span>
              <input
                type="number"
                min={0}
                max={10}
                value={node.gate.minScore ?? ""}
                onChange={(e) =>
                  updateNode(node.id, {
                    gate: {
                      ...node.gate!,
                      minScore: e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="field">
              <span>品牌词覆盖率门槛（0–100%，留空不卡）</span>
              <input
                type="number"
                min={0}
                max={100}
                value={
                  node.gate.minBrandCoverage != null
                    ? Math.round(node.gate.minBrandCoverage * 100)
                    : ""
                }
                onChange={(e) =>
                  updateNode(node.id, {
                    gate: {
                      ...node.gate!,
                      minBrandCoverage:
                        e.target.value === "" ? undefined : Number(e.target.value) / 100,
                    },
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

        {node.kind === "sink" && attempts.length > 0 && (
          <FinishedProduct sinkId={node.id} graph={graph} runtime={runtime} />
        )}

        {node.kind !== "sink" && attempts.length > 0 && (
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

            {rt?.toolCalls && rt.toolCalls.length > 0 && (
              <div className="tool-calls">
                <span className="tool-calls__label">工具调用</span>
                {rt.toolCalls.map((tc) => (
                  <div key={tc.callId} className="tool-call">
                    <div className="tool-call__head">
                      <span className="tool-call__name">{tc.name}</span>
                      {tc.error ? (
                        <span className="tool-call__status tool-call__status--err">错误</span>
                      ) : (
                        <span className="tool-call__status">完成</span>
                      )}
                    </div>
                    <pre className="tool-call__args">
                      {typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args, null, 2)}
                    </pre>
                    {tc.result !== undefined && (
                      <pre className="tool-call__result">
                        {typeof tc.result === "string"
                          ? tc.result
                          : JSON.stringify(tc.result, null, 2)}
                      </pre>
                    )}
                    {tc.error && <pre className="tool-call__error">{tc.error}</pre>}
                  </div>
                ))}
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

            {artifacts.length > 0 && (
              <div className="artifacts">
                <h4 className="label">产出物</h4>
                <div className="artifacts__grid">
                  {artifacts.map((a: Artifact) => (
                    <ArtifactChip key={a.id} artifact={a} />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function ArtifactChip({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === "image" && artifact.uri) {
    return (
      <a className="artifact artifact--image" href={artifact.uri} target="_blank" rel="noreferrer">
        <img src={artifact.uri} alt={artifact.label ?? "image"} loading="lazy" />
        <span className="artifact__label">{artifact.label ?? "图片"}</span>
      </a>
    );
  }
  if (artifact.kind === "video" && artifact.uri) {
    return (
      <a className="artifact artifact--video" href={artifact.uri} target="_blank" rel="noreferrer">
        <video src={artifact.uri} preload="metadata" muted />
        <span className="artifact__label">{artifact.label ?? "视频"}</span>
      </a>
    );
  }
  if (artifact.kind === "audio" && artifact.uri) {
    return (
      <div className="artifact artifact--audio">
        <audio src={artifact.uri} controls preload="none" />
      </div>
    );
  }
  if (artifact.uri) {
    return (
      <a className="artifact artifact--link" href={artifact.uri} target="_blank" rel="noreferrer">
        {artifactLabel(artifact)} ↗
      </a>
    );
  }
  return (
    <div className="artifact artifact--text">
      <span className="artifact__kind">{artifact.kind}</span>
      <pre className="artifact__content">{artifact.content ?? ""}</pre>
    </div>
  );
}
