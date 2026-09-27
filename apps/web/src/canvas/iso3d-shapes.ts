import * as THREE from "three";
import { type NodeKind, type NodeRuntime } from "@agent-world/core";
import { CATEGORY_COLORS, categoryColor } from "./category-colors";
import { buildIndustrialShape, type NodeShape } from "./industrial-recipes";

export { CATEGORY_COLORS, categoryColor };
export type { NodeShape };

/** Height of a node body in 3D world units (pipes/freight reference this). */
export const NODE_HEIGHT = 50;
/** Y the pipes (and freight) run at, level with the body mid-height. */
export const PIPE_Y = NODE_HEIGHT / 2;
/** Radius of the solid 3D pipe (tube) drawn for each edge. */
export const PIPE_RADIUS = 3;
/** Ground-plane rotation of every node (radians), so a straight-on view reveals side faces. */
export const NODE_ROTATION = Math.PI / 8;
/** Emissive color applied to the selected node. */
export const SELECT_COLOR = 0xffd54a;
/**
 * Emissive intensity for the selection highlight. Kept well below the bloom pass
 * threshold (0.92) so the selected node gets a soft self-glow instead of a
 * blown-out halo — some body materials (factory windows) already carry a higher
 * default intensity, and 1.0 × bright yellow blooms harshly. Dropped from 0.4 on
 * the "selection should read as a highlight, not as a lamp" request; the ring
 * under the node carries the "this one is picked" signal, not the body glow.
 */
export const SELECT_EMISSIVE_INTENSITY = 0.22;

/** LED color per runtime status (grey = idle). */
export function statusLedColor(
  status: NodeRuntime["status"] | undefined,
  halted: boolean,
): number {
  if (halted) return 0xffd54a; // waiting on a human decision
  switch (status) {
    case "running":
      return 0x69f0ae;
    case "failed":
      return 0xff5252;
    case "done":
      return 0x4caf50;
    case "scrapped":
      return 0xff8a65;
    case "skipped":
      return 0x6b7a8a;
    default:
      return 0x3a4148;
  }
}

/**
 * Meshes currently wearing a highlight clone, mapped to the material they should
 * go back to. A WeakMap so a mesh that is dropped by the graph-sync teardown
 * needs no bookkeeping here.
 */
const HIGHLIGHTED = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();

const isHighlightClone = (mat: THREE.Material | undefined | null): boolean =>
  !!mat && (mat.userData as { awHighlight?: boolean } | undefined)?.awHighlight === true;

function applyHighlight(mesh: THREE.Mesh, color: number, intensity: number): void {
  // Re-applying must clone from the *original*, never from the previous clone —
  // otherwise a rebuild-on-click chain would stack clones and drift the emissive.
  const base = HIGHLIGHTED.get(mesh) ?? mesh.material;
  const build = (mat: THREE.Material): THREE.Material => {
    if (!("emissive" in mat)) return mat;
    const clone = (mat as THREE.MeshStandardMaterial).clone();
    // Assigned wholesale, not spread: `clone()` may carry the source's userData,
    // and inheriting `awShared` here would make the teardown skip this clone.
    clone.userData = { awHighlight: true };
    clone.emissive.setHex(color);
    clone.emissiveIntensity = intensity;
    return clone;
  };
  HIGHLIGHTED.set(mesh, base);
  mesh.material = Array.isArray(base) ? base.map(build) : build(base);
}

function removeHighlight(mesh: THREE.Mesh): void {
  const original = HIGHLIGHTED.get(mesh);
  if (!original) return;
  const current = mesh.material;
  for (const mat of Array.isArray(current) ? current : [current]) {
    // Disposing the clone releases its program; the textures it points at are
    // the shared module-level ones and stay alive.
    if (isHighlightClone(mat)) mat?.dispose();
  }
  mesh.material = original;
  HIGHLIGHTED.delete(mesh);
}

/**
 * Highlight one node: every "body" material gets the emissive color at
 * `intensity` (the LED is skipped because it is status-driven).
 *
 * This swaps in per-mesh clones instead of writing to the material it already
 * points at, because `MAT` in industrial-kit is a **module-level pool shared by
 * every node**. Mutating it in place lit up the whole park when a single machine
 * was selected, and the "un-highlight the previous node" write reset those same
 * shared objects — so what you saw depended on which node you had clicked last.
 */
export function setGroupEmissive(group: THREE.Group, color: number, intensity = 1): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.role === "led") return;
    applyHighlight(mesh, color, intensity);
  });
}

/** Undo {@link setGroupEmissive} for this node only, leaving shared materials alone. */
export function clearGroupEmissive(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    removeHighlight(mesh);
  });
}

/** Build the realistic PBR machine for a node kind (kit-part composition). */
export function buildNodeShape(kind: NodeKind): NodeShape {
  return buildIndustrialShape(kind);
}
