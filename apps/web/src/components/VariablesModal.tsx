import { useEffect, useState } from "react";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  variables: Record<string, unknown> | undefined;
  onClose: () => void;
  onSave: (vars: Record<string, unknown>) => void;
}

/**
 * Edits the graph's default variables (key → JSON value). Runtime writes from
 * `set_variable` (persisted per-run) override these; `${var.xxx}` reads them.
 */
export default function VariablesModal({
  open,
  variables,
  onClose,
  onSave,
}: Props) {
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(
      Object.entries(variables ?? {}).map(([k, v]) => ({
        key: k,
        value: JSON.stringify(v) ?? "",
      })),
    );
    setError(null);
  }, [open, variables]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const setRow = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const commit = () => {
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      const key = r.key.trim();
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        setError(`变量名重复：${key}`);
        return;
      }
      const text = r.value.trim();
      if (text === "") {
        setError(`变量 ${key} 缺少值`);
        return;
      }
      try {
        out[key] = JSON.parse(text);
      } catch {
        setError(
          `变量 ${key} 的值不是合法 JSON（字符串需加引号，如 "文本"；对象/数组用 {...} / [...]）`,
        );
        return;
      }
    }
    onSave(out);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>产线变量</h2>
          <Tooltip content="关闭">
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="form-hint">
            变量是跨运行持久化的状态：节点可用 <code>{"${var.xxx}"}</code>{" "}
            读取（如 <code>{"${var.brand}"}</code>），agent 可用内置工具{" "}
            <code>set_variable</code> /<code>get_variable</code>{" "}
            读写。此处为默认值，运行后的写入会覆盖它。
          </p>
          <div className="var-table">
            <div className="var-table__head">
              <span>变量名（key）</span>
              <span>值（JSON）</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div className="var-table__row" key={i}>
                <input
                  className="input var-table__key"
                  value={r.key}
                  placeholder="如 stats.count"
                  onChange={(e) => setRow(i, { key: e.target.value })}
                />
                <input
                  className="input var-table__value"
                  value={r.value}
                  placeholder='如 "可口可乐" 或 {"n": 3} 或 3'
                  onChange={(e) => setRow(i, { value: e.target.value })}
                />
                <button
                  className="icon-btn icon-btn--danger"

                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            className="chip"
            onClick={() => setRows((rs) => [...rs, { key: "", value: "" }])}
          >
            + 添加变量
          </button>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal__footer">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn--primary" onClick={commit}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
