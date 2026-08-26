/** Notifications fired from engine lifecycle events (4.7). */

export interface HaltNotification {
  runId: string;
  graphId: string;
  nodeId?: string;
  reason?: string;
}

/**
 * Fire-and-forget notification when a run halts for a human decision. The
 * operator configures `RUN_HALT_WEBHOOK` (a POST endpoint); if unset this is a
 * no-op. Failures are logged but never block the run.
 */
export async function notifyHalt(n: HaltNotification): Promise<void> {
  const url = process.env.RUN_HALT_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "run.halted", ...n, ts: Date.now() }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn("[notify] halt webhook failed:", (err as Error).message);
  }
}
