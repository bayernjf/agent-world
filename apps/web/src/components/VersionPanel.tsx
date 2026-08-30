import { useEffect, useState } from "react";
import type { Graph } from "@agent-world/core";
import { TemplatePreview } from "./TemplatePicker";

interface VersionSummary {
  id: string;
  graphId: string;
  name: string;
  note: string;
  contentHash: string;
  createdAt: number;
}

interface VersionsResponse {
  versions: VersionSummary[];
  /** Content hash of the graph as executed by the most recent run; null if never run. */
  latestRunHash: string | null;
  /** Content hash of the live graph right now. */
  currentHash: string;
}

interface Props {
  open: boolean;
  graphId: string;
  graphName: string;
  onClose: () => void;
  onRestored: () => void;
}

export default function VersionPanel({ open, graphId, graphName, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [latestRunHash, setLatestRunHash] = useState<string | null>(null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ name: string; graph: Graph } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (open && graphId) load();
  }, [open, graphId]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/graphs/${graphId}/versions`);
      const data = (await res.json()) as VersionsResponse;
      setVersions(data.versions ?? []);
      setLatestRunHash(data.latestRunHash ?? null);
      setCurrentHash(data.currentHash ?? null);
    } catch {
      setVersions([]);
      setLatestRunHash(null);
      setCurrentHash(null);
    } finally {
      setLoading(false);
    }
  }

  async function saveVersion() {
    if (!newName.trim()) {
      setNewName(new Date().toLocaleString());
    }
    setSaving(true);
    try {
      await fetch(`/api/graphs/${graphId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName || new Date().toLocaleString(), note: newNote }),
      });
      setNewName("");
      setNewNote("");
      load();
    } catch (e) {
      alert("保存失败: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function restoreVersion(id: string) {
    if (!confirm("确定恢复到此版本吗？当前产线的修改将被覆盖。")) return;
    try {
      const res = await fetch(`/api/graphs/${graphId}/versions/${id}/restore`, { method: "POST" });
      if (!res.ok) throw new Error("恢复失败");
      onRestored();
      onClose();
    } catch (e) {
      alert("恢复失败: " + (e as Error).message);
    }
  }

  async function deleteVersion(id: string) {
    if (!confirm("确定删除此版本吗？")) return;
    try {
      await fetch(`/api/graphs/${graphId}/versions/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      alert("删除失败: " + (e as Error).message);
    }
  }

  /** Load a version's full snapshot for the preview overlay (read-only). */
  async function openPreview(id: string) {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/graphs/${graphId}/versions/${id}`);
      const data = (await res.json()) as { name: string; snapshot: Graph };
      setPreview({ name: data.name, graph: data.snapshot });
    } catch {
      alert("预览加载失败");
    } finally {
      setPreviewLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal version-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>产线版本 — {graphName}</h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>关闭</button>
        </div>

        <div className="version-panel__save">
          <input
            type="text"
            placeholder="版本名称（留空用时间戳）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="input"
            style={{ flex: 1 }}
          />
          <input
            type="text"
            placeholder="备注（可选）"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="input"
            style={{ flex: 1 }}
          />
          <button className="btn btn--sm" onClick={saveVersion} disabled={saving}>
            {saving ? "保存中..." : "保存当前版本"}
          </button>
        </div>

        <div className="version-panel__list">
          {loading && <p className="muted" style={{ textAlign: "center", padding: "20px" }}>加载中...</p>}
          {!loading && versions.length === 0 && (
            <p className="muted" style={{ textAlign: "center", padding: "40px" }}>
              暂无版本。点击上方"保存当前版本"创建第一个快照。
            </p>
          )}
          {versions.map((v) => (
            <div key={v.id} className="version-item">
              <div className="version-item__head">
                <span className="version-item__name">
                  {v.name}
                  {latestRunHash && v.contentHash === latestRunHash && (
                    <span className="version-item__flag version-item__flag--ran">最近运行</span>
                  )}
                  {currentHash && v.contentHash === currentHash && (
                    <span className="version-item__flag version-item__flag--current">与当前一致</span>
                  )}
                </span>
                <span className="muted">{new Date(v.createdAt).toLocaleString()}</span>
              </div>
              {v.note && v.note !== "auto" && <p className="version-item__note muted">{v.note}</p>}
              <div className="version-item__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => openPreview(v.id)} disabled={previewLoading}>
                  预览
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => restoreVersion(v.id)}>恢复</button>
                <button className="btn btn--ghost btn--sm btn--danger" onClick={() => deleteVersion(v.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal version-preview" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>{preview.name}</h2>
              <button className="btn btn--ghost btn--sm" onClick={() => setPreview(null)}>关闭</button>
            </div>
            <div className="version-preview__body">
              <TemplatePreview
                nodes={preview.graph.nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.x, y: n.y }))}
                edges={preview.graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind }))}
              />
              <p className="version-preview__summary muted">
                {preview.graph.nodes.length} 个节点 · {preview.graph.edges.length} 条连线 ·{" "}
                {Object.entries(
                  preview.graph.nodes.reduce<Record<string, number>>((acc, n) => {
                    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
                    return acc;
                  }, {}),
                )
                  .map(([kind, count]) => `${kind}×${count}`)
                  .join(" / ")}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
