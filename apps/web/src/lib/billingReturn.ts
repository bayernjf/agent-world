/**
 * M3 S6 A5 — parse the Stripe Checkout/Portal return query.
 *
 * The web app is a single page whose billing UI is a Settings *modal* (there is
 * no /settings/billing route), so the server is told to return to same-origin
 * `/?billing=success|cancel|manage-done` and this module decides what to do on
 * the resulting full-page reload. Kept framework-free so it is trivially unit
 * testable.
 */

export type BillingReturn = "success" | "cancel" | "manage-done" | null;

/** Only these whitelisted values trigger a post-return action. */
const KNOWN = new Set(["success", "cancel", "manage-done"]);

/** Query key used on the return URL. */
export const BILLING_RETURN_KEY = "billing";

/**
 * Read the return marker from a `location.search`-shaped string.
 * Returns null for missing/empty/unknown values (and for non-string input).
 */
export function parseBillingReturn(search: string): BillingReturn {
  if (typeof search !== "string" || search.length === 0) return null;
  // URLSearchParams tolerates a leading "?" and repeated keys (takes the first).
  const raw = new URLSearchParams(search).get(BILLING_RETURN_KEY);
  if (raw && KNOWN.has(raw)) return raw as Exclude<BillingReturn, null>;
  return null;
}

/** Build the same-origin relative return path sent to the server. */
export function billingReturnPath(value: Exclude<BillingReturn, null>): string {
  return `/?${BILLING_RETURN_KEY}=${value}`;
}
