import type { OcrConfig } from "@agent-world/core";

export interface OcrResult {
  /** Recognised text (may be empty when the image has no readable characters). */
  text: string;
  /** Tesseract's mean confidence, 0-100. */
  confidence: number;
}

/** Official tesseract.js CDN endpoints. Overridable per-node via OcrConfig. */
export const DEFAULT_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0";
export const DEFAULT_WORKER_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js@v5.1.1/dist/worker.min.js";
export const DEFAULT_CORE_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.0";

/**
 * Hosts whose assets tesseract.js may load over the network (M7③). Anything
 * else — including a graph author pointing langPath/workerPath/corePath at an
 * internal host or an arbitrary URL — must be a local filesystem path instead.
 * Air-gapped deployments use on-disk paths; extending the allowlist is an
 * operator decision via OCR_ALLOWED_HOSTS (comma-separated). Read per call so
 * runtime env changes take effect.
 */
function allowedOcrHosts(): Set<string> {
  return new Set(
    (process.env.OCR_ALLOWED_HOSTS ?? "tessdata.projectnaptha.com,cdn.jsdelivr.net")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Refuse network sources that are neither local paths nor allowlisted hosts. */
export function assertOcrSource(kind: string, value: string): void {
  if (!/^https?:\/\//i.test(value)) return; // local filesystem path — fine
  let host: string;
  try {
    host = new URL(value).host.toLowerCase();
  } catch {
    throw new Error(`OCR ${kind} 不是合法地址: ${value}`);
  }
  if (!allowedOcrHosts().has(host)) {
    throw new Error(`OCR ${kind} 仅允许本地路径或白名单域（${[...allowedOcrHosts()].join(" / ")}）`);
  }
}

/**
 * Recognise text in a single image via tesseract.js (WASM, no native deps).
 * The heavy module is loaded lazily so it never blocks engine startup, and the
 * worker is terminated after every call to free its WASM memory. Throws on
 * load/recognise failure — the engine maps that to node failure.
 */
export async function ocrImage(image: Buffer, cfg: OcrConfig): Promise<OcrResult> {
  const Tesseract = await import("tesseract.js");
  const langPath = cfg.langPath ?? DEFAULT_LANG_PATH;
  const workerPath = cfg.workerPath ?? DEFAULT_WORKER_PATH;
  const corePath = cfg.corePath ?? DEFAULT_CORE_PATH;
  // A graph author must not make tesseract load JS/WASM from an arbitrary
  // (potentially internal) URL — local paths and the allowlisted CDNs only.
  assertOcrSource("langPath", langPath);
  assertOcrSource("workerPath", workerPath);
  assertOcrSource("corePath", corePath);
  const worker = await Tesseract.createWorker(cfg.lang, 1, {
    langPath,
    workerPath,
    corePath,
    gzip: true,
  });
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text ?? "", confidence: data.confidence ?? 0 };
  } finally {
    await worker.terminate();
  }
}
