import { useRef, useState } from "react";
import type { SourceFile } from "@agent-world/core";
import { api } from "../lib/api";
import { useGraph } from "../store/graph";

interface Props {
  nodeId: string;
  files: SourceFile[];
  onBeginEdit: () => void;
  onCommitEdit: () => void;
}

/** parseDocument only speaks these three (PDF / DOCX / PPTX). */
const SUPPORTED_EXT = ["pdf", "docx", "pptx"] as const;
const ACCEPT =
  ".pdf,.docx,.pptx,application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/**
 * Documents are read into memory whole before parsing, so the practical ceiling
 * is the server's inline cap (MAX_INLINE_BYTES), which is lower than the 25MB
 * the upload route accepts. Stop the user here instead of letting fileParse fail.
 */
const MAX_PARSE_BYTES = 5 * 1024 * 1024;

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1]!.toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function SourceFiles({
  nodeId,
  files,
  onBeginEdit,
  onCommitEdit,
}: Props) {
  const { updateNode, graph } = useGraph();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setFiles = (next: SourceFile[]) =>
    updateNode(nodeId, {
      source: {
        ...(graph.nodes.find((n) => n.id === nodeId)?.source ?? {}),
        files: next,
      },
    });

  const uploadFiles = async (list: File[]) => {
    // Nothing may be dropped silently: the image-only picker swallowed every
    // document a user dragged in, which is how the 「合同文件」 intake ended up
    // unable to produce a file at all (dogfood 2026-09-01).
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of list) {
      if (!SUPPORTED_EXT.includes(extOf(f.name) as (typeof SUPPORTED_EXT)[number]))
        rejected.push(`${f.name}（仅支持 PDF / DOCX / PPTX）`);
      else if (f.size > MAX_PARSE_BYTES)
        rejected.push(`${f.name}（${formatSize(f.size)}，解析上限 5 MB）`);
      else accepted.push(f);
    }
    setError(rejected.length ? `已跳过：${rejected.join("；")}` : null);
    if (!accepted.length) return;

    setUploading(true);
    try {
      const uploaded = await Promise.all(accepted.map((f) => api.uploadArtifact(f)));
      const added: SourceFile[] = uploaded.map((a) => ({
        uri: a.uri ?? `/api/artifacts/${a.id}`,
        label: a.label ?? undefined,
        mimeType: a.mimeType ?? undefined,
        sizeBytes: a.sizeBytes,
      }));
      setFiles([...files, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = (i: number) => setFiles(files.filter((_, j) => j !== i));

  return (
    <div className="field">
      <span>文档（PDF / DOCX / PPTX，供「文件解析」车间读取）</span>

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
          void uploadFiles([...e.dataTransfer.files]);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void uploadFiles([...e.target.files]);
          }}
        />
        {uploading ? "上传中…" : "点击上传文档，或把文件拖到这里"}
      </div>

      {files.length > 0 && (
        <div className="image-list">
          {files.map((f, i) => {
            const name = f.label || decodeURIComponent(f.uri.split("/").pop() || f.uri);
            return (
              <div className="image-row image-row--with-thumb" key={f.uri + i}>
                <span className="image-row__thumb image-row__thumb--placeholder">
                  {extOf(name).toUpperCase() || "文"}
                </span>
                <input
                  readOnly
                  value={f.sizeBytes ? `${name} · ${formatSize(f.sizeBytes)}` : name}
                  title={f.uri}
                  onFocus={onBeginEdit}
                  onBlur={onCommitEdit}
                />
                <button
                  className="icon-btn icon-btn--danger"
                  onClick={() => remove(i)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="diag diag--error">{error}</p>}
    </div>
  );
}
