/**
 * Full video dialects for gateways whose video API diverges from the plain
 * OpenAI-compatible shape. Extracted into its own module so both config.ts and
 * hub-catalog.ts can import it without a runtime cycle (the only import here
 * is type-only, so it is erased at compile time).
 */
import type { ProviderConfig } from "./config.js";

export type VideoDialect = NonNullable<ProviderConfig["videoAdapter"]>;

/**
 * agnes video dialect (verified against official docs 2026-10-03,
 * wiki.agnes-ai.com/en/docs/agnes-video-25-flash):
 * - `mode` is one of text/keyframe/reference (the old literal "ti2vid" was
 *   never valid and silently fell back to text);
 * - flash is fixed to `size:"720P"` + `aspect_ratio` (width/height ignored);
 * - duration is `seconds` as a string "4"–"12";
 * - async retrieval is GET /agnesapi?video_id=..&model_name=.. (outside /v1).
 */
export const AGNES_VIDEO_ADAPTER: VideoDialect = {
  // mode is taken from the node's VideoGenConfig (default "text").
  createBody: { size: "720P" },
  aspectAsRatio: true,
  maxN: 1,
  omitDuration: false,
  secondsField: "seconds",
  secondsRange: [4, 12],
  // keyframe first-frame / reference images (URLs, ≤5 for flash).
  firstFramePath: "first_frame",
  imagesPath: "images",
  // Leading "/" resolves against the base origin, giving
  // https://apihub.agnes-ai.com/agnesapi?video_id=..&model_name=..
  retrievalUrlTemplate: "/agnesapi?video_id={jobId}&model_name={model}",
  // The completed task carries the video URL at the top-level `url` field
  // (metadata is empty); the parser falls back to metadata.url/output[0].
  resultUrlPath: "url",
  // Real produced duration is reported as a numeric STRING, e.g. "5.0"
  // (verified live 2026-09-09); videoBillingSeconds coerces it.
  durationPath: "seconds",
};
