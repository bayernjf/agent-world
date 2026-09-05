/**
 * design-feedback §3.2: remember the most recent uncaught window error so the
 * feedback form can attach it as diagnostics. Only message + lineno are kept —
 * never the stack (it can embed local paths and variable values).
 */
let lastError: { message: string; lineno: number } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    // Resource-load failures (img/script) arrive as Event without message.
    if (!e.message) return;
    lastError = { message: String(e.message).slice(0, 500), lineno: e.lineno ?? 0 };
  });
}

export function getLastError(): { message: string; lineno: number } | null {
  return lastError;
}
