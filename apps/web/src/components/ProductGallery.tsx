import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type StoredArtifact } from "../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
}

type KindFilter = "all" | StoredArtifact["kind"];

const KIND_LABEL: Record<StoredArtifact["kind"], string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
  file: "文件",
  json: "数据",
  uri: "链接",
};

const FILTERS: KindFilter[] = ["all", "image", "video", "audio", "text", "json", "file", "uri"];
const PAGE = 60;

function resolveUrl(a: StoredArtifact): string | null {
  if (a.uri) return a.uri;
  if (a.storage === "local") return `/api/artifacts/${encodeURIComponent(a.id)}`;
  return null;
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ProductGallery({ open, onClose }: Props) {
  const [filter, setFilter] = useState<KindFilter>("all");
  const [items, setItems] = useState<StoredArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const page = await api.listArtifacts(PAGE, offset);
      setItems((prev) => (offset === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reset whenever the modal opens or the kind filter changes.
  useEffect(() => {
    if (open) void load(0);
  }, [open, filter, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((a) => a.kind === filter)),
    [items, filter],
  );

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>成品库</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="seg">
              {FILTERS.map((k) => (
                <button
                  key={k}
                  className={`seg__btn ${filter === k ? "is-on" : ""}`}
                  onClick={() => setFilter(k)}
                >
                  {k === "all" ? "全部" : KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <button className="icon-btn" onClick={onClose} title="关闭">
              ✕
            </button>
          </div>
        </div>

        <div className="modal__body">
          {filtered.length === 0 && !loading ? (
            <p className="muted" style={{ textAlign: "center", padding: "40px 0" }}>
              暂无成品。运行产线后，产出的图片、文本、数据等会汇集到这里。
            </p>
          ) : (
            <div className="gallery">
              {filtered.map((a) => (
                <GalleryCard key={a.id} artifact={a} />
              ))}
            </div>
          )}

          {hasMore && filter === "all" && (
            <div className="gallery__more">
              <button
                className="btn btn--ghost"
                disabled={loading}
                onClick={() => void load(items.length)}
              >
                {loading ? "加载中…" : "加载更多"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GalleryCard({ artifact: a }: { artifact: StoredArtifact }) {
  const url = resolveUrl(a);
  const title = a.label ?? `${KIND_LABEL[a.kind]} · ${a.id}`;

  return (
    <div className="gallery-card">
      <div className="gallery-card__media">
        {a.kind === "image" && url ? (
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={a.label ?? "image"} loading="lazy" />
          </a>
        ) : a.kind === "video" && url ? (
          <video src={url} controls preload="metadata" muted />
        ) : a.kind === "audio" && url ? (
          <audio src={url} controls preload="none" />
        ) : (
          <a
            className="gallery-card__file"
            href={url ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            <span className="gallery-card__kind">{KIND_LABEL[a.kind]}</span>
            <span className="gallery-card__open">{url ? "打开 ↗" : "无内容"}</span>
          </a>
        )}
      </div>
      <div className="gallery-card__meta">
        <span className="gallery-card__title" title={title}>
          {title}
        </span>
        <span className="gallery-card__sub muted mono">
          {formatDate(a.createdAt)}
          {a.sizeBytes ? ` · ${formatSize(a.sizeBytes)}` : ""}
        </span>
      </div>
    </div>
  );
}
