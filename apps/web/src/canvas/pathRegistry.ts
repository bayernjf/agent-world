/**
 * Pipes register their rendered <path> here so the canvas packet layer can sample
 * real positions with getPointAtLength instead of re-deriving the geometry.
 */
export const pathRegistry = new Map<string, SVGPathElement>();

export function registerPath(edgeId: string, el: SVGPathElement | null) {
  if (el) pathRegistry.set(edgeId, el);
  else pathRegistry.delete(edgeId);
}
