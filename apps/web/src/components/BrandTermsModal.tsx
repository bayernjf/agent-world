import { useCallback, useEffect, useState } from "react";
import { api, type BrandTerm } from "../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function BrandTermsModal({ open, onClose }: Props) {
  const [terms, setTerms] = useState<BrandTerm[]>([]);
  const [term, setTerm] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTerms(await api.listBrandTerms());
    } catch {
      /* ignore transient failures */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, load]);

  if (!open) return null;

  const add = async () => {
    setError(null);
    try {
      await api.addBrandTerm(term, note);
      setTerm("");
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    }
  };

  const remove = async (id: string) => {
    await api.deleteBrandTerm(id);
    await load();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>品牌词库</h2>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="modal__body">
          <p className="muted">
            维护建议融入的品牌词。在厂房(agent)节点的「品牌词」处点「从品牌词库载入」即可一键带入；质检
            gate 可设「品牌词覆盖率门槛」，低于则打回上游重写。
          </p>
          <ul className="brand-list">
            {terms.length === 0 && <li className="muted">暂无品牌词，先在下方添加。</li>}
            {terms.map((t) => (
              <li key={t.id}>
                <div>
                  <span className="brand-term">{t.term}</span>
                  {t.note && <span className="muted"> — {t.note}</span>}
                </div>
                <button className="ghost-btn" onClick={() => void remove(t.id)}>
                  删除
                </button>
              </li>
            ))}
          </ul>
          <div className="brand-add">
            <input
              placeholder="品牌词，如 显瘦"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
            <input placeholder="备注（可选）" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn btn--primary btn--sm" onClick={() => void add()} disabled={!term.trim()}>
              添加
            </button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </div>
      </div>
    </div>
  );
}
