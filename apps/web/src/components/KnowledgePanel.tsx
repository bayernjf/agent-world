import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  source: string;
  tags: string[];
  created_at: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function KnowledgePanel({ open, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newTags, setNewTags] = useState("");

  useEffect(() => {
    if (open) load();
  }, [open]);

  async function load() {
    try {
      const res = await fetch("/api/knowledge?limit=100");
      const data = await res.json();
      setEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setEntries([]);
    }
  }

  async function doSearch() {
    if (!query.trim()) {
      load();
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/knowledge/search?q=${encodeURIComponent(query)}&limit=50`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } finally {
      setSearching(false);
    }
  }

  async function addEntry() {
    if (!newTitle.trim() || !newContent.trim()) return;
    try {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          content: newContent,
          source: "manual",
          tags: newTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      setNewTitle("");
      setNewContent("");
      setNewTags("");
      setAdding(false);
      load();
    } catch (e) {
      alert(t("modals:knowledge.addFailed", { message: (e as Error).message }));
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm(t("modals:knowledge.deleteConfirm"))) return;
    try {
      await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      alert(t("modals:knowledge.deleteFailed", { message: (e as Error).message }));
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal knowledge-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:knowledge.title")}</h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>{t("common.close")}</button>
        </div>

        <div className="knowledge-panel__toolbar">
          <input
            type="text"
            placeholder={t("modals:knowledge.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            className="input"
            style={{ flex: 1 }}
          />
          <button className="btn btn--sm" onClick={doSearch} disabled={searching}>
            {searching ? t("modals:knowledge.searching") : t("common.search")}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => { setQuery(""); load(); }}>{t("common.reset")}</button>
          <button className="btn btn--sm" onClick={() => setAdding(!adding)}>
            {adding ? t("common.cancel") : t("modals:knowledge.add")}
          </button>
        </div>

        {adding && (
          <div className="knowledge-panel__add">
            <input
              type="text"
              placeholder={t("modals:knowledge.titlePlaceholder")}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="input"
            />
            <textarea
              placeholder={t("modals:knowledge.contentPlaceholder")}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="input"
              rows={4}
            />
            <input
              type="text"
              placeholder={t("modals:knowledge.tagsPlaceholder")}
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              className="input"
            />
            <button className="btn btn--sm" onClick={addEntry}>{t("common.save")}</button>
          </div>
        )}

        <div className="knowledge-panel__count muted">
          {query
            ? t("modals:knowledge.countFiltered", { total, results: entries.length })
            : t("modals:knowledge.countAll", { total })}
        </div>

        <div className="knowledge-panel__list">
          {entries.length === 0 && (
            <p className="muted" style={{ textAlign: "center", padding: "40px" }}>
              {query ? t("modals:knowledge.emptySearch") : t("modals:knowledge.empty")}
            </p>
          )}
          {entries.map((entry) => (
            <div key={entry.id} className="knowledge-item">
              <div className="knowledge-item__head">
                <span className="knowledge-item__title">{entry.title}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => deleteEntry(entry.id)}>{t("common.delete")}</button>
              </div>
              <p className="knowledge-item__content">{entry.content.slice(0, 300)}{entry.content.length > 300 ? "..." : ""}</p>
              <div className="knowledge-item__meta muted">
                <span>{t("modals:knowledge.source", { source: entry.source })}</span>
                <span>{new Date(entry.created_at).toLocaleString(i18n.language)}</span>
                {entry.tags.length > 0 && (
                  <span>{t("modals:knowledge.tags", { tags: entry.tags.join(", ") })}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
