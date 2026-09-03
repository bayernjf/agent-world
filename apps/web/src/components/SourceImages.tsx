import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

export default function SourceImages({
  nodeId,
  images,
  onBeginEdit,
  onCommitEdit,
}: Props) {
  const { updateNode, graph } = useGraph();
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setImages = (next: string[]) =>
    updateNode(nodeId, {
      source: {
        ...(graph.nodes.find((n) => n.id === nodeId)?.source ?? {}),
        images: next,
      },
    });

  const uploadFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(
        list.map((f) => api.uploadArtifact(f)),
      );
      const urls = uploaded.map((a) => a.uri).filter((u): u is string => !!u);
      setImages([...images, ...urls]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("nodes:sourceImages.uploadFailed"));
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
      <span>{t("nodes:sourceImages.label")}</span>

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
          if (e.dataTransfer.files.length)
            void uploadFiles(e.dataTransfer.files);
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
        {uploading
          ? t("nodes:sourceImages.uploading")
          : t("nodes:sourceImages.dropzone")}
      </div>

      <div className="image-list">
        {images.map((url, i) => (
          <div className="image-row image-row--with-thumb" key={i}>
            {isImageUrl(url) ? (
              <img
                className="image-row__thumb"
                src={url}
                alt=""
                loading="lazy"
              />
            ) : (
              <span className="image-row__thumb image-row__thumb--placeholder">
                {t("nodes:sourceImages.thumbFallback")}
              </span>
            )}
            <input
              value={url}
              placeholder={t("nodes:sourceImages.urlPlaceholder")}
              onFocus={onBeginEdit}
              onBlur={onCommitEdit}
              onChange={(e) => updateUrl(i, e.target.value)}
            />
            <button
              className="icon-btn icon-btn--danger"

              onClick={() => remove(i)}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn image-list__add"
          onClick={() => setImages([...images, ""])}
        >
          {t("nodes:sourceImages.addUrl")}
        </button>
      </div>

      {error && <p className="diag diag--error">{error}</p>}
    </div>
  );
}
