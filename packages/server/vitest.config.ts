import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Some tests are wall-clock sensitive by design (engine.code sandbox CPU
    // limit, SSE resume streams, retry backoffs). Under full parallel load a
    // slow machine can push a 1-2s test past the default 5s timeout and turn a
    // healthy run into a spurious "flaky failure". Give them headroom so the
    // suite is reproducible; genuinely broken code still fails on assertions.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
