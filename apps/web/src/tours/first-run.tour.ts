import type { TourDef } from "./tour-types";
import { anchoredStep, centeredStep, finishStep } from "./primitives";

/**
 * First-run tour — the registry's first entry. Shown exactly once, right after
 * a brand-new account creates its first production line (the in-session 0→1
 * moment, see docs/design-guided-tour.md §五/§12.4). Existing users upgrading
 * never auto-see it; they can replay it from ⌘K / the What's-new menu.
 *
 * Anchor ids follow the `<feature>:<element>` contract (§12.7) and are rendered
 * by the feature components themselves via data-tour. `before` keys are resolved
 * by the engine's action registry (registered in App).
 */
export const firstRunTour: TourDef = {
  id: "first-run",
  version: "1.0.0",
  titleKey: "tour:firstRun.title",
  priority: 0,
  autoStart: true,
  targeting: { minGraphCount: 1 },
  onStart: "workspace:ensure2d",
  steps: [
    centeredStep(
      "tour:firstRun.steps.welcome.title",
      "tour:firstRun.steps.welcome.body",
    ),
    anchoredStep(
      "raw:input",
      "right",
      "tour:firstRun.steps.raw.title",
      "tour:firstRun.steps.raw.body",
      "panel:expandControl",
    ),
    anchoredStep(
      "workspace:toolbar",
      "bottom",
      "tour:firstRun.steps.toolbar.title",
      "tour:firstRun.steps.toolbar.body",
    ),
    anchoredStep(
      "workspace:stage",
      "center",
      "tour:firstRun.steps.canvas.title",
      "tour:firstRun.steps.canvas.body",
    ),
    anchoredStep(
      "raw:dispatch",
      "right",
      "tour:firstRun.steps.dispatch.title",
      "tour:firstRun.steps.dispatch.body",
      "panel:expandControl",
    ),
    anchoredStep(
      "inspector:panel",
      "left",
      "tour:firstRun.steps.inspector.title",
      "tour:firstRun.steps.inspector.body",
      "inspector:expandAndSelect",
    ),
    anchoredStep(
      "hud:actions",
      "bottom",
      "tour:firstRun.steps.hud.title",
      "tour:firstRun.steps.hud.body",
    ),
    finishStep(
      "tour:firstRun.steps.finish.title",
      "tour:firstRun.steps.finish.body",
    ),
  ],
};
