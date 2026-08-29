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
 * Recognise text in a single image via tesseract.js (WASM, no native deps).
 * The heavy module is loaded lazily so it never blocks engine startup, and the
 * worker is terminated after every call to free its WASM memory. Throws on
 * load/recognise failure — the engine maps that to node failure.
 */
export async function ocrImage(image: Buffer, cfg: OcrConfig): Promise<OcrResult> {
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker(cfg.lang, 1, {
    langPath: cfg.langPath ?? DEFAULT_LANG_PATH,
    workerPath: cfg.workerPath ?? DEFAULT_WORKER_PATH,
    corePath: cfg.corePath ?? DEFAULT_CORE_PATH,
    gzip: true,
  });
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text ?? "", confidence: data.confidence ?? 0 };
  } finally {
    await worker.terminate();
  }
}
