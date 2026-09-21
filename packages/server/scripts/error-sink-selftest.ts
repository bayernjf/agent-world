/**
 * Error-sink connectivity self-test (#57).
 *
 * Sends one synthetic ErrorRecord (kind "manual") to the configured webhook and
 * awaits the response, so the exit status reflects delivery. The production
 * createWebhookErrorSink is intentionally fire-and-forget (returns no promise and
 * swallows network errors), which is right for the server but cannot prove a
 * relay is reachable — this CLI fills that gap. The body shape matches
 * ErrorRecord in src/errors.ts exactly, so a relay that accepts this self-test
 * also accepts what the running server posts.
 *
 * Usage:
 *   ERROR_REPORT_WEBHOOK_URL=https://relay.example/intake \
 *   pnpm --filter @agent-world/server exec tsx scripts/error-sink-selftest.ts
 *   pnpm --filter @agent-world/server exec tsx scripts/error-sink-selftest.ts https://relay.example/intake
 *
 * Exit codes: 0 delivered (HTTP 2xx), 1 unreachable / non-2xx, 2 no URL configured.
 */
import { randomUUID } from "node:crypto";

const url = process.argv.find((a) => a.startsWith("http")) ?? process.env.ERROR_REPORT_WEBHOOK_URL;

if (!url) {
  console.error("no webhook URL: pass it as the first arg or set ERROR_REPORT_WEBHOOK_URL.");
  process.exitCode = 2;
} else {
  // Mirrors ErrorRecord in src/errors.ts (stack omitted for the synthetic event).
  const record = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    kind: "manual" as const,
    name: "ErrorSinkSelfTest",
    message: "agent-world error sink self-test",
    bindings: { selfTest: true },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    console.log(`POST ${url} -> ${res.status} ${res.statusText}`);
    if (res.ok) {
      console.log("self-test delivered: relay accepted the ErrorRecord payload.");
    } else {
      console.error("relay rejected the payload; check its expected format/auth (see runbook).");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`self-test POST failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
