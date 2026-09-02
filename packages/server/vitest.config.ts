import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Some tests are wall-clock sensitive by design (engine.code sandbox CPU
    // limit, SSE resume streams, retry backoffs). Under full parallel load a
    // slow machine can push a 1-2s test past the default 5s timeout and turn a
    // healthy run into a spurious "flaky failure". Give them headroom so the
    // suite is reproducible; genuinely broken code still fails on assertions.
    //
    // The budget must stay ABOVE the engine's own code-node timeoutMs (default
    // 30s): otherwise a slow-but-healthy subprocess on a loaded 2-vCPU runner
    // trips vitest first and the failure is an opaque "Test timed out" instead
    // of the engine's honest TIMEOUT node.failed (2026-09-01, PR #98).
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
