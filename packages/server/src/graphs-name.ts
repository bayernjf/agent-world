/**
 * Case-insensitive, trimmed duplicate-name detection across the persisted
 * graph list. `excludeId` lets the rename path skip the row it's updating.
 *
 * Lives in its own module so the route can use it AND unit tests can cover
 * the rules without spinning up a Hono server.
 */
export interface GraphNameRow {
  id: string;
  name: string;
}

export function findGraphIdByName(
  graphs: ReadonlyArray<GraphNameRow>,
  name: string,
  excludeId?: string,
): string | null {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  for (const g of graphs) {
    if (excludeId && g.id === excludeId) continue;
    if (g.name.trim().toLowerCase() === target) return g.id;
  }
  return null;
}
