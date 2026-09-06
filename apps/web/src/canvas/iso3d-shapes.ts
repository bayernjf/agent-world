import * as THREE from "three";
import {
  NODE_CATEGORY,
  type NodeCategory,
  type NodeKind,
  type NodeRuntime,
} from "@agent-world/core";
import { PLANT_H, PLANT_W } from "../store/graph";

/** Height of the base node block in 3D world units. */
export const NODE_HEIGHT = 120;
/** Y the pipes (and freight) run at, level with the block mid-height. */
export const PIPE_Y = NODE_HEIGHT / 2;
/** Emissive color applied to the selected node. */
export const SELECT_COLOR = 0xffd54a;

/** Base block color per node category (five factory-zone tints). */
export const CATEGORY_COLORS: Record<NodeCategory, number> = {
  generation: 0x8b7cf6,
  control: 0xff9d2e,
  data: 0x2eb8a6,
  integrations: 0x69c35b,
  io: 0xd9a441,
};

export function categoryColor(kind: NodeKind): number {
  return CATEGORY_COLORS[NODE_CATEGORY[kind]];
}

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

/** Set every "body" material's emissive (skips the LED, which is status-driven). */
export function setGroupEmissive(group: THREE.Group, color: number): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.role === "led") return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (mat && "emissive" in mat) (mat as THREE.MeshLambertMaterial).emissive.setHex(color);
    }
  });
}

/** Create six materials for a box so top, sides and front/back read as 3D faces. */
function shadedMaterials(color: number): THREE.MeshLambertMaterial[] {
  const base = new THREE.Color(color);
  const top = base.clone().offsetHSL(0, 0, 0.1);
  const front = base.clone().offsetHSL(0, 0, -0.05);
  const back = base.clone().offsetHSL(0, 0, -0.15);
  const side = base.clone().offsetHSL(0, 0, -0.1);
  const bottom = base.clone().offsetHSL(0, 0, -0.2);
  // BoxGeometry face groups: +x, -x, +y, -y, +z, -z.
  return [
    new THREE.MeshLambertMaterial({ color: side }),
    new THREE.MeshLambertMaterial({ color: side }),
    new THREE.MeshLambertMaterial({ color: top }),
    new THREE.MeshLambertMaterial({ color: bottom }),
    new THREE.MeshLambertMaterial({ color: front }),
    new THREE.MeshLambertMaterial({ color: back }),
  ];
}

/** A node's 3D group: the base block, its kind-specific topper, and a status LED. */
export interface NodeShape {
  group: THREE.Group;
  led: THREE.Mesh;
}

/** Build a node's block + kind-specific topper + LED, colored by category. */
export function buildNodeShape(kind: NodeKind): NodeShape {
  const group = new THREE.Group();
  const color = categoryColor(kind);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(PLANT_W, NODE_HEIGHT, PLANT_H),
    shadedMaterials(color),
  );
  base.position.y = NODE_HEIGHT / 2;
  base.userData.role = "body";
  group.add(base);

  // Status LED, mounted on the front face's top edge so it never fights the topper.
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(5, 12, 12),
    new THREE.MeshLambertMaterial({ color: 0x3a4148, emissive: 0x000000 }),
  );
  led.position.set(0, NODE_HEIGHT - 8, PLANT_H / 2 + 2);
  led.userData.role = "led";
  group.add(led);

  addTopper(group, kind, color);

  return { group, led };
}

/** Add a mesh to the group, tagged as a highlightable body part. */
function add(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): void {
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.userData.role = "body";
  group.add(mesh);
}

const TOP = NODE_HEIGHT;

/**
 * A small programmatic "machine" topper per node kind, giving each of the 29
 * kinds a distinguishable silhouette (Two-Point-Hospital-style shorthand).
 */
function addTopper(group: THREE.Group, kind: NodeKind, color: number): void {
  switch (kind) {
    case "textGen":
      add(group, new THREE.SphereGeometry(10, 16, 16), color, 0, TOP + 10, 0);
      break;
    case "imageGen":
      add(group, new THREE.BoxGeometry(26, 20, 4), color, 0, TOP + 12, 0);
      break;
    case "videoGen":
      add(group, new THREE.SphereGeometry(8, 16, 16), color, 0, TOP + 9, 0);
      add(group, new THREE.ConeGeometry(6, 12, 12), color, 0, TOP + 17, 0);
      break;
    case "audioGen":
      add(group, new THREE.CylinderGeometry(7, 7, 12, 16), color, 0, TOP + 7, 0);
      break;
    case "generic":
      add(group, new THREE.OctahedronGeometry(12), color, 0, TOP + 12, 0);
      break;
    case "source":
      // Inverted cone = funnel.
      add(group, new THREE.ConeGeometry(11, 16, 16), color, 0, TOP + 8, 0, Math.PI);
      break;
    case "sink":
      add(group, new THREE.ConeGeometry(11, 16, 16), color, 0, TOP + 9, 0);
      break;
    case "gate":
      add(group, new THREE.BoxGeometry(3, 18, 3), color, -8, TOP + 9, 0);
      add(group, new THREE.BoxGeometry(3, 18, 3), color, 8, TOP + 9, 0);
      add(group, new THREE.BoxGeometry(19, 3, 3), color, 0, TOP + 18, 0);
      break;
    case "branch":
      add(group, new THREE.SphereGeometry(4, 12, 12), color, -8, TOP + 6, 0);
      add(group, new THREE.SphereGeometry(4, 12, 12), color, 0, TOP + 11, 0);
      add(group, new THREE.SphereGeometry(4, 12, 12), color, 8, TOP + 6, 0);
      break;
    case "map":
      add(group, new THREE.BoxGeometry(28, 3, 20), color, 0, TOP + 4, 0);
      break;
    case "loop":
      add(group, new THREE.TorusGeometry(9, 3, 12, 24), color, 0, TOP + 10, 0, Math.PI / 2);
      break;
    case "parallel":
      add(group, new THREE.BoxGeometry(4, 16, 4), color, -8, TOP + 8, 0);
      add(group, new THREE.BoxGeometry(4, 16, 4), color, 8, TOP + 8, 0);
      break;
    case "table":
      add(group, new THREE.BoxGeometry(30, 4, 24), color, 0, TOP + 4, 0);
      break;
    case "database":
      add(group, new THREE.CylinderGeometry(10, 10, 16, 20), color, 0, TOP + 9, 0);
      break;
    case "fileParse":
      // Tilted document.
      add(group, new THREE.BoxGeometry(22, 2, 16), color, 0, TOP + 12, 0, -0.5);
      break;
    case "translate":
      add(group, new THREE.SphereGeometry(6, 16, 16), color, -7, TOP + 7, 0);
      add(group, new THREE.SphereGeometry(6, 16, 16), color, 7, TOP + 7, 0);
      break;
    case "ocr":
      add(group, new THREE.BoxGeometry(20, 3, 14), color, 0, TOP + 3, 0);
      add(group, new THREE.SphereGeometry(5, 12, 12), color, 0, TOP + 9, 0);
      break;
    case "convert":
      // Hourglass: two cones tip-to-tip.
      add(group, new THREE.ConeGeometry(9, 13, 16), color, 0, TOP + 7, 0);
      add(group, new THREE.ConeGeometry(9, 13, 16), color, 0, TOP + 19, 0, Math.PI);
      break;
    case "code":
      add(group, new THREE.BoxGeometry(16, 8, 10), color, 0, TOP + 5, 0);
      add(group, new THREE.BoxGeometry(12, 8, 8), color, 0, TOP + 13, 0);
      break;
    case "http":
      add(group, new THREE.TorusGeometry(8, 3, 12, 24), color, 0, TOP + 9, 0, Math.PI / 2);
      add(group, new THREE.SphereGeometry(4, 12, 12), color, 0, TOP + 19, 0);
      break;
    case "search":
      add(group, new THREE.TorusGeometry(8, 3, 12, 24), color, 0, TOP + 10, 0, Math.PI / 2);
      add(group, new THREE.BoxGeometry(3, 14, 3), color, 9, TOP + 5, 0, 0, 0, 0.7);
      break;
    case "notify":
      add(group, new THREE.ConeGeometry(8, 12, 16), color, 0, TOP + 7, 0);
      add(group, new THREE.SphereGeometry(4, 12, 12), color, 0, TOP + 16, 0);
      break;
    case "vcs":
      add(group, new THREE.SphereGeometry(5, 12, 12), color, -7, TOP + 7, 0);
      add(group, new THREE.SphereGeometry(5, 12, 12), color, 7, TOP + 7, 0);
      break;
    case "human":
      add(group, new THREE.CylinderGeometry(5, 5, 10, 16), color, 0, TOP + 5, 0);
      add(group, new THREE.SphereGeometry(6, 16, 16), color, 0, TOP + 14, 0);
      break;
    case "subprocess":
      add(group, new THREE.BoxGeometry(14, 8, 12), color, 0, TOP + 5, 0);
      add(group, new THREE.BoxGeometry(10, 8, 9), color, 0, TOP + 13, 0);
      break;
    case "compliance":
      add(group, new THREE.BoxGeometry(16, 20, 4), color, 0, TOP + 12, 0);
      break;
    case "publish":
      add(group, new THREE.ConeGeometry(8, 14, 16), color, 0, TOP + 9, 0);
      break;
    case "fanout":
      add(group, new THREE.SphereGeometry(4, 12, 12), color, -12, TOP + 7, 0);
      add(group, new THREE.SphereGeometry(4, 12, 12), color, 0, TOP + 7, 0);
      add(group, new THREE.SphereGeometry(4, 12, 12), color, 12, TOP + 7, 0);
      break;
    case "select":
      add(group, new THREE.OctahedronGeometry(11), color, 0, TOP + 12, 0);
      break;
  }
}
