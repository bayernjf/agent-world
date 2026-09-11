import type { TourDef } from "./tour-types";
import { firstRunTour } from "./first-run.tour";

/**
 * Tour registry (§12.2). Every guided tour lives here exactly once. Add a new
 * version/feature tour by creating a `*.tour.ts` and appending it below — the
 * engine, ⌘K command generation and What's-new menu pick it up automatically.
 */
export const TOURS: TourDef[] = [firstRunTour];

const BY_ID = new Map<string, TourDef>(TOURS.map((tour) => [tour.id, tour]));

export function getTour(id: string): TourDef | undefined {
  return BY_ID.get(id);
}

export * from "./tour-types";
