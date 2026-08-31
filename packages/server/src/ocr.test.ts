import { afterEach, describe, expect, it, vi } from "vitest";
import { assertOcrSource, DEFAULT_CORE_PATH, DEFAULT_LANG_PATH, DEFAULT_WORKER_PATH } from "./ocr.js";

describe("ocr source allowlist (audit M7③)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows the default official CDN endpoints", () => {
    expect(() => assertOcrSource("langPath", DEFAULT_LANG_PATH)).not.toThrow();
    expect(() => assertOcrSource("workerPath", DEFAULT_WORKER_PATH)).not.toThrow();
    expect(() => assertOcrSource("corePath", DEFAULT_CORE_PATH)).not.toThrow();
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
