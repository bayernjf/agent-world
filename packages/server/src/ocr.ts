import type { OcrConfig } from "@agent-world/core";

export interface OcrResult {
  /** Recognised text (may be empty when the image has no readable characters). */
  text: string;
  /** Tesseract's mean confidence, 0-100. */
  confidence: number;
}

/**
 * Official tessdata CDN. Language files are always fetched over the network
 * (browser and Node alike), so this stays a URL; `cachePath` keeps a local copy
 * after the first run. Overridable per node via OcrConfig.langPath.
 */
export const DEFAULT_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0";

/**
 * Worker / core assets are **not** defaulted to a CDN on purpose. Under Node,
 * tesseract.js spawns `new worker_threads.Worker(workerPath)`, which rejects any
 * URL (`ERR_WORKER_PATH`), and it already resolves both assets to the files
 * bundled with the installed packages. Passing the old CDN pins broke every ocr
 * node in production *and* pointed v5 scripts at the installed v7 core.
 */

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
  // A graph author must not make tesseract load JS/WASM from an arbitrary
  // (potentially internal) URL — local paths and the allowlisted CDNs only.
  assertOcrSource("langPath", langPath);
  const options: Parameters<typeof Tesseract.createWorker>[2] = { langPath, gzip: true };
  // Explicit overrides stay for browser/self-hosted deployments; unset means
  // "let tesseract.js resolve its own bundled assets" (the only thing Node accepts).
  if (cfg.workerPath) {
    assertOcrSource("workerPath", cfg.workerPath);
    options.workerPath = cfg.workerPath;
  }
  if (cfg.corePath) {
    assertOcrSource("corePath", cfg.corePath);
    options.corePath = cfg.corePath;
  }
  const worker = await Tesseract.createWorker(cfg.lang, 1, options);
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text ?? "", confidence: data.confidence ?? 0 };
  } finally {
    await worker.terminate();
  }
}
