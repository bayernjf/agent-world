import { useState, type ElementType, type ReactNode } from "react";
import {
  ARTIFACT_COLORS,
  artifactLabel,
  type Artifact,
  type ArtifactKind,
} from "@agent-world/core";
import { proxyImageUrl } from "./api";
import { sanitizeUrl } from "./sanitize-html";
import Tooltip from "../components/Tooltip";
import i18n from "../i18n";
import { useTranslation } from "react-i18next";

/**
 * Shape shared by runtime `Artifact` (core) and persisted `StoredArtifact` (api).
 * Callers pass already-resolved `uri`; optional `status`/`cost`/`createdAt` feed
 * the card chrome (cost/failure are Phase C — joined from usage events).
 */
export interface ArtifactLike {
  id: string;
  kind: ArtifactKind;
  uri?: string | null;
  content?: string | null;
  label?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  metadata?: Record<string, unknown> | null;
  status?: "ok" | "failed";
  cost?: number | null;
  createdAt?: number | null;
  graphId?: string | null;
  graphName?: string | null;
}

/** Small shared helpers (also used by ProductGallery). */
export function formatSize(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(ts?: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* text / markdown                                                     */
/* ------------------------------------------------------------------ */

/** Small Markdown → React renderer (moved from FinishedProduct, now shared). */
export function renderMarkdown(md: string): ReactNode[] {
  const lines = md.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={key++}>
          {list.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,3}\s/.test(line)) {
      flushList();
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s/, "");
      const Tag = `h${Math.min(level, 3)}` as ElementType;
      blocks.push(<Tag key={key++}>{renderInline(text)}</Tag>);
    } else if (/^[-*]\s/.test(line)) {
      list.push(line.replace(/^[-*]\s/, ""));
    } else if (/^\d+\.\s/.test(line)) {
      list.push(line.replace(/^\d+\.\s/, ""));
    } else if (line === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={key++}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return blocks;
}

/** Inline formatting: **bold**, *italic*, `code`, [text](url), ![alt](url). */
export function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex =
    /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0]!;
    if (tok.startsWith("![")) {
      const mm = tok.match(/!\[([^\]]*)\]\(([^)]+)\)/)!;
      const src = sanitizeUrl(mm[2], "image");
      // Drop images whose URL scheme is not allowed (audit M8); keep alt text.
      parts.push(src ? <img key={k++} src={src} alt={mm[1]} loading="lazy" /> : mm[1]);
    } else if (tok.startsWith("[")) {
      const mm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      const href = sanitizeUrl(mm[2], "link");
      // A disallowed scheme (e.g. javascript:) renders as inert label text (M8).
      parts.push(
        href ? (
          <a key={k++} href={href} target="_blank" rel="noopener noreferrer">
            {mm[1]}
          </a>
        ) : (
          <span key={k++}>{mm[1]}</span>
        ),
      );
    } else if (tok.startsWith("**")) {
      parts.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(<code key={k++}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("*")) {
      parts.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/* ------------------------------------------------------------------ */
/* json tree                                                           */
/* ------------------------------------------------------------------ */

export function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function displayVal(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  return String(v);
}

function JsonNode({
  k,
  value,
  depth,
}: {
  k?: string;
  value: unknown;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object";
  if (!isObj) {
    return (
      <div className="json-leaf">
        {k !== undefined && <span className="json-key">{k}: </span>}
        <span className={`json-val json-${typeof value}`}>
          {displayVal(value)}
        </span>
      </div>
    );
  }
  const entries: [string, unknown][] = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const summary = isArr ? `Array(${entries.length})` : `{${entries.length}}`;
  return (
    <div className="json-node">
      <div className="json-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="json-caret">{open ? "▾" : "▸"}</span>
        {k !== undefined && <span className="json-key">{k}: </span>}
        <span className="json-summary">{summary}</span>
      </div>
      {open && (
        <div className="json-children">
          {entries.map(([ck, cv]) => (
            <JsonNode key={ck} k={ck} value={cv} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function JsonView({ data }: { data: unknown }) {
  return <div className="json-view">{<JsonNode value={data} depth={0} />}</div>;
}

/* ------------------------------------------------------------------ */
/* per-kind renderers                                                  */
/* ------------------------------------------------------------------ */

const placeholder = (key: string) => (
  <span className="artifact-empty">{i18n.t(key)}</span>
);

function TextArtifact({ a }: { a: ArtifactLike }) {
  if (!a.content) return placeholder("run:artifacts.noContent");
  if (a.mimeType === "text/markdown" || a.mimeType === "text/x-markdown") {
    return <div className="artifact-md">{renderMarkdown(a.content)}</div>;
  }
  if (a.mimeType === "application/json") {
    return <JsonView data={safeParse(a.content)} />;
  }
  return <pre className="artifact__content">{a.content}</pre>;
}

function ImageArtifact({ a }: { a: ArtifactLike }) {
  const [broken, setBroken] = useState(false);
  if (!a.uri) return placeholder("run:artifacts.noImage");
  if (broken) {
    return (
      <div className="artifact-image-fallback">
        <span className="artifact-image-fallback__icon">IMG</span>
        <span>{i18n.t("run:artifacts.imageBroken")}</span>
        <a href={a.uri} target="_blank" rel="noopener noreferrer">
          {i18n.t("run:artifacts.openOriginal")}
        </a>
      </div>
    );
  }
  return (
    <a className="artifact-media" href={a.uri} target="_blank" rel="noopener noreferrer">
      <img
        src={proxyImageUrl(a.uri) ?? a.uri}
        alt={a.label ?? "image"}
        loading="lazy"
        onError={() => setBroken(true)}
      />
    </a>
  );
}

function VideoArtifact({ a }: { a: ArtifactLike }) {
  if (!a.uri) return placeholder("run:artifacts.noVideo");
  return (
    <video
      className="artifact-media"
      src={a.uri}
      controls
      preload="metadata"
      muted
    />
  );
}

function AudioArtifact({ a }: { a: ArtifactLike }) {
  if (!a.uri) return placeholder("run:artifacts.noAudio");
  return (
    <audio className="artifact-media" src={a.uri} controls preload="none" />
  );
}

function FileArtifact({ a }: { a: ArtifactLike }) {
  if (!a.uri) return placeholder("run:artifacts.noFile");
  return (
    <a
      className="artifact-file"
      href={a.uri}
      target="_blank"
      rel="noopener noreferrer"
      download={a.label ?? undefined}
    >
      <span className="artifact-file__icon">⬇</span>
      <span className="artifact-file__name">
        {a.label ?? i18n.t("run:artifacts.fileLabel")}
      </span>
    </a>
  );
}

function JsonArtifact({ a }: { a: ArtifactLike }) {
  if (!a.content) return placeholder("run:artifacts.noData");
  let data: unknown = safeParse(a.content);
  // Tolerant of double-encoded JSON (a JSON *string* value).
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      /* keep as raw string */
    }
  }
  if (typeof data === "string") {
    return <pre className="artifact__content">{data}</pre>;
  }
  return <JsonView data={data} />;
}

function UriArtifact({ a }: { a: ArtifactLike }) {
  if (!a.uri) return placeholder("run:artifacts.noLink");
  return (
    <a className="artifact-uri" href={a.uri} target="_blank" rel="noopener noreferrer">
      {a.label ?? a.uri} ↗
    </a>
  );
}

export const artifactRenderers: Record<
  ArtifactKind,
  (props: { a: ArtifactLike }) => ReactNode
> = {
  text: TextArtifact,
  image: ImageArtifact,
  video: VideoArtifact,
  audio: AudioArtifact,
  file: FileArtifact,
  json: JsonArtifact,
  uri: UriArtifact,
};

/* ------------------------------------------------------------------ */
/* shared card chrome                                                  */
/* ------------------------------------------------------------------ */

const KIND_LABEL: Record<ArtifactKind, string> = {
  text: "run:artifacts.type.text",
  image: "run:artifacts.type.image",
  video: "run:artifacts.type.video",
  audio: "run:artifacts.type.audio",
  file: "run:artifacts.type.file",
  json: "run:artifacts.type.json",
  uri: "run:artifacts.type.uri",
};

export function ArtifactCard({
  a,
  showMeta = true,
}: {
  a: ArtifactLike;
  showMeta?: boolean;
}) {
  const { t } = useTranslation();
  const color = ARTIFACT_COLORS[a.kind] ?? "#ffb020";
  const uri = a.uri ?? undefined;
  const render =
    artifactRenderers[a.kind] ??
    (({ a: x }: { a: ArtifactLike }) =>
      placeholder("run:artifacts.unknownType"));
  const label = a.label ?? artifactLabel(a as unknown as Artifact);

  return (
    <div
      className={`artifact-card artifact-card--${a.kind}`}
      data-status={a.status ?? "ok"}
    >
      <div className="artifact-card__bar" style={{ background: color }} />
      <div className="artifact-card__body">{render({ a })}</div>
      {showMeta && (
        <div className="artifact-card__meta">
          <span className="artifact-card__title" title={label}>
            {label}
          </span>
          <span className="artifact-card__kind" style={{ color }}>
            {t(KIND_LABEL[a.kind])}
          </span>
          {a.graphName && (
            <Tooltip content={t("run:artifacts.sourceGraph")}>
              <span className="artifact-card__source">{a.graphName}</span>
            </Tooltip>
          )}
          <span className="artifact-card__sub muted mono">
            {formatDate(a.createdAt)}
            {a.sizeBytes ? ` · ${formatSize(a.sizeBytes)}` : ""}
            {a.cost != null ? (
              <span className="cost"> · ¥{a.cost.toFixed(4)}</span>
            ) : null}
          </span>
          {a.status === "failed" && (
            <span className="artifact-card__failed">
              {t("run:artifacts.generateFailed")}
            </span>
          )}
          <span className="artifact-card__actions">
            {uri && (
              <a
                href={uri}
                target="_blank"
                rel="noopener noreferrer"
                download={a.label ?? undefined}
              >
                {t("run:artifacts.download")}
              </a>
            )}
            {a.content && (
              <button type="button" onClick={() => copyText(a.content!)}>
                {t("run:artifacts.copy")}
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
