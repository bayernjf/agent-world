import { z } from "zod";

/**
 * An Artifact is a typed, addressable piece of content produced by a node.
 * Text output is the default; image/video/audio/file/JSON carry enough
 * metadata for the UI to render them without parsing raw strings.
 */
export const ArtifactKind = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "file",
  "json",
  "uri",
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const Artifact = z.object({
  id: z.string().min(1),
  kind: ArtifactKind,
  /** MIME type when known (image/png, video/mp4, audio/wav, ...). */
  mimeType: z.string().optional(),
  /** Inline content for text/json. For binary use uri. */
  content: z.string().optional(),
  /** Remote or data URI for binary / external artifacts. */
  uri: z.string().optional(),
  /** Human-readable label (filename, title). */
  label: z.string().optional(),
  /** Size in bytes, if known. */
  sizeBytes: z.number().int().nonnegative().optional(),
  /** Kind-specific metadata (dimensions, duration, prompt, etc.). */
  metadata: z.record(z.unknown()).optional(),
});
export type Artifact = z.infer<typeof Artifact>;

/** Human-readable short label used in packet summaries. */
export function artifactLabel(a: Artifact): string {
  if (a.label) return a.label;
  switch (a.kind) {
    case "image":
      return "图片";
    case "video":
      return "视频";
    case "audio":
      return "音频";
    case "file":
      return "文件";
    case "json":
      return "数据";
    case "uri":
      return "链接";
  default:
    return a.content ? (a.content.length > 80 ? a.content.slice(0, 80) + "…" : a.content) : "文本";
  }
}

/** Truck / freight colour per artifact kind. */
export const ARTIFACT_COLORS: Record<ArtifactKind, string> = {
  text: "#ffb020",
  image: "#35e0f0",
  video: "#b388ff",
  audio: "#69f0ae",
  file: "#ff8a65",
  json: "#fdd835",
  uri: "#80d8ff",
};

/**
 * Best-effort extraction of artifacts from a node's text output.
 * Detects markdown images, bare image URLs, and JSON blocks.
 */
export function extractArtifacts(
  text: string,
  idPrefix: string,
): Artifact[] {
  const out: Artifact[] = [];
  let n = 0;
  const nextId = () => `${idPrefix}-a${++n}`;

  // Markdown images: ![alt](url)
  const mdImg = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdImg.exec(text))) {
    out.push({
      id: nextId(),
      kind: "image",
      uri: m[2],
      label: m[1] || undefined,
    });
  }

  // Bare image URLs not already inside markdown
  const bareUrl = /(?<!!)\bhttps?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?\S*)?/gi;
  const seen = new Set(out.map((a) => a.uri));
  while ((m = bareUrl.exec(text))) {
    const url = m[0];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ id: nextId(), kind: "image", uri: url });
  }

  // Bare video URLs
  const videoUrl = /\bhttps?:\/\/\S+\.(?:mp4|webm|mov|m4v)(?:\?\S*)?/gi;
  while ((m = videoUrl.exec(text))) {
    out.push({ id: nextId(), kind: "video", uri: m[0] });
  }

  // Bare audio URLs
  const audioUrl = /\bhttps?:\/\/\S+\.(?:mp3|wav|ogg|m4a|flac)(?:\?\S*)?/gi;
  while ((m = audioUrl.exec(text))) {
    out.push({ id: nextId(), kind: "audio", uri: m[0] });
  }

  // Fenced JSON blocks
  const jsonBlock = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  while ((m = jsonBlock.exec(text))) {
    try {
      const parsed = JSON.parse(m[1]!);
      out.push({
        id: nextId(),
        kind: "json",
        content: JSON.stringify(parsed),
      });
    } catch {
      // not valid JSON, skip
    }
  }

  return out;
}
