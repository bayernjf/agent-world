import i18n from "../i18n";

/**
 * Engine run statuses, plus the legacy ids older logs and A/B reports still
 * carry. These are the short labels a list row or a select option needs; the
 * control panel's status line uses longer wording of its own.
 */
export const RUN_STATUS_KEY: Record<string, string> = {
  idle: "run:status.idle",
  running: "run:status.running",
  done: "run:status.done",
  halted: "run:status.halted",
  failed: "run:status.failed",
  tripped: "run:status.tripped",
  cancelled: "run:status.cancelled",
  interrupted: "run:status.interrupted",
  completed: "run:status.completed",
  approved: "run:status.approved",
  rejected: "run:status.rejected",
};

/** Short label for a run status; falls back to the raw id the engine sent. */
export function runStatusLabel(status: string): string {
  const key = RUN_STATUS_KEY[status];
  return key ? i18n.t(key) : status;
}
