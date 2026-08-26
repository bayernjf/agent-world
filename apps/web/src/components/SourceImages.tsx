import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useGraph } from "../store/graph";

interface Props {
  nodeId: string;
  images: string[];
  onBeginEdit: () => void;
  onCommitEdit: () => void;
}

function isImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith("/api/artifacts/");
}

export default function SourceImages({ nodeId, images, onBeginEdit, onCommitEdit }: Props) {
  const { updateNode, graph } = useGraph();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setImages = (next: string[]) =>
    updateNode(nodeId, {
      source: { ...(graph.nodes.find((n) => n.id === nodeId)?.source ?? {}), images: next },
    });

  const uploadFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(list.map((f) => api.uploadArtifact(f)));
      const urls = uploaded.map((a) => a.uri).filter((u): u is string => !!u);
      setImages([...images, ...urls]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const updateUrl = (i: number, value: string) => {
    const next = [...images];
    next[i] = value;
    setImages(next);
  };
  const remove = (i: number) => setImages(images.filter((_, j) => j !== i));

  return (
    <div className="field">
      <span>产品图片（上传或粘贴 URL，视觉模型可看图）</span>

      <div
        className={`image-dropzone ${dragOver ? "is-over" : ""} ${uploading ? "is-loading" : ""}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {uploading ? "上传中…" : "点击上传，或把产品图拖到这里"}
      </div>

      <div className="image-list">
        {images.map((url, i) => (
          <div className="image-row image-row--with-thumb" key={i}>
            {isImageUrl(url) ? (
              <img className="image-row__thumb" src={url} alt="" loading="lazy" />
            ) : (
              <span className="image-row__thumb image-row__thumb--placeholder">图</span>
            )}
            <input
              value={url}
              placeholder="https://... 或 /api/artifacts/..."
              onFocus={onBeginEdit}
              onBlur={onCommitEdit}
              onChange={(e) => updateUrl(i, e.target.value)}
            />
            <button
              className="icon-btn icon-btn--danger"
              title="移除"
              onClick={() => remove(i)}
            >
              ✕
            </button>
          </div>
        ))}
        <button className="btn image-list__add" onClick={() => setImages([...images, ""])}>
          + 添加图片 URL
        </button>
      </div>

      {error && <p className="diag diag--error">{error}</p>}
    </div>
  );
}
