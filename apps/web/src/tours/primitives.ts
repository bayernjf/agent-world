import type { Placement, StepDef } from "./tour-types";

/**
 * Reusable step builders (§12.8) so future tours don't repeat the boilerplate
 * for centered welcome/finish cards and anchored explanation steps.
 *
 * Title/body arguments are full i18n key literals (namespace-qualified) so the
 * i18n keys.test scanner can validate them.
 */

/** A spotlight-free card centered in the viewport (welcome / finish). */
export function centeredStep(titleKey: string, bodyKey: string): StepDef {
  return { target: null, placement: "center", titleKey, bodyKey };
}

/** A spotlight card anchored to a `data-tour` element. */
export function anchoredStep(
  target: string,
  placement: Placement,
  titleKey: string,
  bodyKey: string,
  before?: string,
): StepDef {
  return { target, placement, titleKey, bodyKey, before };
}

/** Terminal centered card. */
export function finishStep(titleKey: string, bodyKey: string): StepDef {
  return centeredStep(titleKey, bodyKey);
}
