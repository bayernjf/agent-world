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
 * Emissive intensity for the selection highlight. Kept well below the bloom
 * pass threshold (0.92) so the selected node gets a soft self-glow instead of
 * a blown-out halo — some body materials (factory windows) already carry a
 * higher default intensity, and 1.0 × bright yellow blooms harshly.
 */
export const SELECT_EMISSIVE_INTENSITY = 0.4;

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
 * Set every "body" material's emissive (skips the LED, which is status-driven).
 * `intensity` controls how strongly the color self-emits; callers pass a low
 * value for the selection highlight and the default restores materials to 1.0.
 */
export function setGroupEmissive(group: THREE.Group, color: number, intensity = 1): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.role === "led") return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (mat && "emissive" in mat) {
        const m = mat as THREE.MeshStandardMaterial;
        m.emissive.setHex(color);
        m.emissiveIntensity = intensity;
      }
    }
  });
}

/** Build the realistic PBR machine for a node kind (kit-part composition). */
export function buildNodeShape(kind: NodeKind): NodeShape {
  return buildIndustrialShape(kind);
}
