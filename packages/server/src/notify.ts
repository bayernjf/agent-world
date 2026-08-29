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

/** Failure detail for one node, for alerting. */
export interface FailedNodeInfo {
  nodeId: string;
  error: string;
  errorCode?: string;
}

export interface FailedNotification {
  runId: string;
  graphId: string;
  failedNodes: FailedNodeInfo[];
  skippedCount: number;
}

/**
 * Fire-and-forget alert when a run finishes failed. The operator configures
 * `RUN_FAILED_WEBHOOK` (a POST endpoint, e.g. a Slack/Feishu bot or a pager);
 * if unset this is a no-op. Failures are logged but never block the run.
 */
export async function notifyFailed(n: FailedNotification): Promise<void> {
  const url = process.env.RUN_FAILED_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "run.failed", ...n, ts: Date.now() }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn("[notify] failed webhook failed:", (err as Error).message);
  }
}
