import { afterEach, describe, expect, it, vi } from "vitest";
import { assertOcrSource, DEFAULT_LANG_PATH, ocrImage } from "./ocr.js";

// tesseract.js is only ever loaded lazily inside ocrImage; stub it so these
// tests assert *what we hand the library*, without spawning a real worker.
const { createWorker } = vi.hoisted(() => ({
  createWorker: vi.fn(async (..._args: unknown[]) => ({
    recognize: async () => ({ data: { text: "ACME SUPPLY CO", confidence: 91 } }),
    terminate: async () => {},
  })),
}));
vi.mock("tesseract.js", () => ({ createWorker }));

describe("ocr source allowlist (audit M7③)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows the default official language CDN", () => {
    expect(() => assertOcrSource("langPath", DEFAULT_LANG_PATH)).not.toThrow();
  });

  it("allows local filesystem paths (air-gapped deployments)", () => {
    expect(() => assertOcrSource("langPath", "/usr/share/tessdata")).not.toThrow();
    expect(() => assertOcrSource("workerPath", "./local/worker.min.js")).not.toThrow();
    expect(() => assertOcrSource("corePath", "C:\\tessdata\\core")).not.toThrow();
  });

  it("refuses a graph author pointing at an arbitrary network host", () => {
    expect(() => assertOcrSource("langPath", "https://attacker.example.com/tessdata")).toThrow(/仅允许本地路径或白名单域/);
    expect(() => assertOcrSource("workerPath", "https://169.254.169.254/worker.js")).toThrow(/仅允许本地路径或白名单域/);
    expect(() => assertOcrSource("corePath", "http://127.0.0.1:8080/core")).toThrow(/仅允许本地路径或白名单域/);
  });

  it("refuses malformed URLs", () => {
    expect(() => assertOcrSource("langPath", "http://")).toThrow(/不是合法地址/);
  });

  it("honours an operator-extended allowlist via OCR_ALLOWED_HOSTS", () => {
    vi.stubEnv("OCR_ALLOWED_HOSTS", "cdn.example.org");
    expect(() => assertOcrSource("corePath", "https://cdn.example.org/x/core.wasm")).not.toThrow();
    expect(() => assertOcrSource("langPath", "https://cdn.other.com/tessdata")).toThrow(/仅允许本地路径或白名单域/);
  });
});

// Dogfood tpl-scan-ocr (2026-09-01): every ocr node failed with ERR_WORKER_PATH
// because the code pinned v5 CDN scripts as defaults — worker_threads only takes
// a local file, and the installed tesseract.js already resolves its own assets.
describe("ocrImage — what tesseract.js is actually given", () => {
  afterEach(() => createWorker.mockClear());

  it("leaves worker/core to tesseract.js unless configured", async () => {
    const res = await ocrImage(Buffer.from("img"), { lang: "eng" });
    expect(res).toEqual({ text: "ACME SUPPLY CO", confidence: 91 });
    expect(createWorker).toHaveBeenCalledTimes(1);
    const [lang, oem, options] = createWorker.mock.calls[0] as [string, number, Record<string, unknown>];
    expect(lang).toBe("eng");
    expect(oem).toBe(1);
    expect(options.langPath).toBe(DEFAULT_LANG_PATH);
    expect("workerPath" in options).toBe(false);
    expect("corePath" in options).toBe(false);
  });

  it("passes an explicit allowlisted override through", async () => {
    await ocrImage(Buffer.from("img"), {
      lang: "eng",
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/worker.min.js",
      corePath: "/opt/tess/core",
    });
    const [, , options] = createWorker.mock.calls[0] as [string, number, Record<string, unknown>];
    expect(options.workerPath).toContain("cdn.jsdelivr.net");
    expect(options.corePath).toBe("/opt/tess/core");
  });

  it("refuses a non-allowlisted language host before spawning anything", async () => {
    await expect(ocrImage(Buffer.from("img"), { lang: "eng", langPath: "http://169.254.169.254/tess" })).rejects.toThrow(
      /仅允许本地路径或白名单域/,
    );
    expect(createWorker).not.toHaveBeenCalled();
  });
});
