import * as THREE from "three";
import { PLANT_H, PLANT_W } from "../store/graph";
import {
  brushedSteelTexture,
  concreteTexture,
  corrugatedMetalTexture,
  darkMetalTexture,
  hazardStripesTexture,
} from "./industrial-textures";

/**
 * Reusable PBR industrial kit. Materials/textures here are module-level
 * singletons shared by every node (never disposed; the graph-sync teardown
 * only disposes per-node geometries). Recipes compose these parts into a
 * distinct machine per node kind — see industrial-recipes.ts.
 */

export const MAT = {
  concrete: new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95, metalness: 0.05 }),
  corrugated: new THREE.MeshStandardMaterial({
    map: corrugatedMetalTexture(),
    roughness: 0.45,
    metalness: 0.85,
  }),
  steel: new THREE.MeshStandardMaterial({ map: brushedSteelTexture(), roughness: 0.35, metalness: 0.9 }),
  darkMetal: new THREE.MeshStandardMaterial({ map: darkMetalTexture(), roughness: 0.6, metalness: 0.6 }),
  rust: new THREE.MeshStandardMaterial({ color: 0x7a4a32, roughness: 0.7, metalness: 0.45 }),
  hazard: new THREE.MeshStandardMaterial({ map: hazardStripesTexture(), roughness: 0.55, metalness: 0.3 }),
};

export interface Kit {
  group: THREE.Group;
  put(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx?: number,
    ry?: number,
    rz?: number,
  ): THREE.Mesh;
}

export function kit(group: THREE.Group): Kit {
  return {
    group,
    put(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.userData.role = "body";
      group.add(m);
      return m;
    },
  };
}

/** Ground-plane rotation shared with iso3d-shapes, kept here so recipes match. */
export const NODE_ROTATION = Math.PI / 8;
const FRONT_Z = PLANT_H / 2;

/** A fresh node: rotated group + concrete plinth + a front status LED on a stem. */
export function newNode(): { k: Kit; led: THREE.Mesh } {
  const group = new THREE.Group();
  const k = kit(group);

  k.put(new THREE.BoxGeometry(PLANT_W + 18, 5, PLANT_H + 18), MAT.concrete, 0, 2.5, 0);

  // LED sits just in front of the plinth on a short steel stem, so it never
  // fights the machine body regardless of the recipe.
  k.put(new THREE.CylinderGeometry(1.5, 1.5, 7, 8), MAT.steel, 0, 8.5, FRONT_Z + 3);
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(4, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x3a4148, emissive: 0x000000 }),
  );
  led.position.set(0, 13, FRONT_Z + 3);
  led.userData.role = "led";
  group.add(led);

  group.rotation.y = NODE_ROTATION;
  return { k, led };
}

// ---- parts -----------------------------------------------------------------

export function frame(
  k: Kit,
  { w = 120, d = 70, h = 70, x = 0, z = 0 }: { w?: number; d?: number; h?: number; x?: number; z?: number } = {},
): void {
  const post = 3;
  const y0 = 5;
  const corners: [number, number][] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [-w / 2, d / 2],
    [w / 2, d / 2],
  ];
  for (const [dx, dz] of corners) {
    k.put(new THREE.BoxGeometry(post, h, post), MAT.steel, x + dx, y0 + h / 2, z + dz);
  }
  for (const zz of [-d / 2, d / 2]) {
    k.put(new THREE.BoxGeometry(w, post, post), MAT.steel, x, y0 + h, z + zz);
    k.put(new THREE.BoxGeometry(w, post, post), MAT.steel, x, y0 + h * 0.5, z + zz);
  }
}

export function cabinet(
  k: Kit,
  { w = 38, h = 55, d = 28, x = 0, y = 5, z = 0, ry = 0 }: { w?: number; h?: number; d?: number; x?: number; y?: number; z?: number; ry?: number } = {},
): void {
  k.put(new THREE.BoxGeometry(w, h, d), MAT.darkMetal, x, y + h / 2, z, 0, ry, 0);
  // Door seam.
  k.put(new THREE.BoxGeometry(0.8, h * 0.9, 0.6), MAT.steel, x, y + h / 2, z + d / 2 + 0.4, 0, ry, 0);
  // Glowing status panel.
  k.put(new THREE.BoxGeometry(w * 0.4, 6, 0.8), panel(), x, y + h - 10, z + d / 2 + 0.5, 0, ry, 0);
}

export function vessel(
  k: Kit,
  { r = 15, h = 38, x = 0, z = 0 }: { r?: number; h?: number; x?: number; z?: number } = {},
): void {
  const yC = 20 + h / 2;
  const legs: [number, number][] = [
    [-r * 0.7, -r * 0.7],
    [r * 0.7, -r * 0.7],
    [-r * 0.7, r * 0.7],
    [r * 0.7, r * 0.7],
  ];
  for (const [dx, dz] of legs) {
    k.put(new THREE.CylinderGeometry(1.5, 1.5, 16, 8), MAT.steel, x + dx, 13, z + dz);
  }
  k.put(new THREE.CylinderGeometry(r, r, h, 24), MAT.steel, x, yC, z);
  k.put(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.steel, x, yC + h / 2, z);
  k.put(
    new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    MAT.steel,
    x,
    yC - h / 2,
    z,
  );
}

export function silo(
  k: Kit,
  { r = 15, h = 30, cone = 18, x = 0, z = 0 }: { r?: number; h?: number; cone?: number; x?: number; z?: number } = {},
): void {
  k.put(new THREE.CylinderGeometry(r, r, h, 24), MAT.corrugated, x, 22 + h / 2, z);
  k.put(new THREE.CylinderGeometry(r, r * 0.3, cone, 24), MAT.corrugated, x, 22 - cone / 2, z);
  k.put(new THREE.CylinderGeometry(r + 1, r + 1, 3, 24), MAT.steel, x, 22 + h + 1.5, z);
}

export function pipeRun(
  k: Kit,
  { len = 60, r = 3, x = 0, y = 30, z = 0, axis = "x" }: { len?: number; r?: number; x?: number; y?: number; z?: number; axis?: "x" | "z" } = {},
): void {
  if (axis === "x") {
    k.put(new THREE.CylinderGeometry(r, r, len, 12), MAT.steel, x, y, z, 0, 0, Math.PI / 2);
    for (const dx of [-len / 2, len / 2]) {
      k.put(new THREE.CylinderGeometry(r + 1.5, r + 1.5, 1.5, 12), MAT.steel, x + dx, y, z, 0, 0, Math.PI / 2);
    }
  } else {
    k.put(new THREE.CylinderGeometry(r, r, len, 12), MAT.steel, x, y, z, Math.PI / 2, 0, 0);
    for (const dz of [-len / 2, len / 2]) {
      k.put(new THREE.CylinderGeometry(r + 1.5, r + 1.5, 1.5, 12), MAT.steel, x, y, z + dz, Math.PI / 2, 0, 0);
    }
  }
}

export function valve(
  k: Kit,
  { x = 0, y = 30, z = 0, s = 1 }: { x?: number; y?: number; z?: number; s?: number } = {},
): void {
  k.put(new THREE.CylinderGeometry(4 * s, 4 * s, 8 * s, 12), MAT.steel, x, y, z, 0, 0, Math.PI / 2);
  k.put(new THREE.BoxGeometry(1.5 * s, 6 * s, 1.5 * s), MAT.steel, x, y + 4 * s, z);
  k.put(new THREE.TorusGeometry(4 * s, 0.8 * s, 8, 16), MAT.darkMetal, x, y + 8 * s, z);
}

export function manifold(
  k: Kit,
  { branches = 3, x = 0, y = 40, z = 0 }: { branches?: number; x?: number; y?: number; z?: number } = {},
): void {
  const span = branches * 22;
  k.put(new THREE.CylinderGeometry(4, 4, span, 12), MAT.steel, x, y, z, 0, 0, Math.PI / 2);
  for (let i = 0; i < branches; i++) {
    const dx = -span / 2 + 11 + i * 22;
    k.put(new THREE.CylinderGeometry(2.5, 2.5, 24, 10), MAT.steel, x + dx, y - 12, z);
    k.put(new THREE.CylinderGeometry(4, 4, 3, 10), MAT.steel, x + dx, y - 24, z);
  }
}

export function motor(
  k: Kit,
  { x = 0, z = 0, y = 24, axis = "x", s = 1 }: { x?: number; z?: number; y?: number; axis?: "x" | "z"; s?: number } = {},
): void {
  const rz = axis === "x" ? Math.PI / 2 : 0;
  const rx = axis === "z" ? Math.PI / 2 : 0;
  k.put(new THREE.CylinderGeometry(7 * s, 7 * s, 16 * s, 16), MAT.darkMetal, x, y, z, rx, 0, rz);
  k.put(new THREE.CylinderGeometry(2 * s, 2 * s, 10 * s, 10), MAT.steel, x + (axis === "x" ? 12 * s : 0), y, z, rx, 0, rz);
  k.put(new THREE.BoxGeometry(14 * s, 2 * s, 14 * s), MAT.rust, x - (axis === "x" ? 6 * s : 0), y - 7 * s, z);
}

export function conveyor(
  k: Kit,
  { len = 100, x = 0, z = 0, y = 18 }: { len?: number; x?: number; z?: number; y?: number } = {},
): void {
  k.put(new THREE.BoxGeometry(len, 3, 26), MAT.darkMetal, x, y, z);
  for (const dx of [-len / 2, len / 2]) {
    k.put(new THREE.CylinderGeometry(8, 8, 28, 12), MAT.steel, x + dx, y, z, Math.PI / 2, 0, 0);
  }
  for (const dx of [-len / 3, len / 3]) {
    k.put(new THREE.BoxGeometry(3, y - 5, 3), MAT.steel, x + dx, (y - 5) / 2, z);
  }
}

export function hopper(
  k: Kit,
  { top = 22, bottom = 6, h = 30, x = 0, z = 0, y = 25 }: { top?: number; bottom?: number; h?: number; x?: number; z?: number; y?: number } = {},
): void {
  k.put(new THREE.CylinderGeometry(top, top, 10, 24), MAT.steel, x, y + h / 2, z);
  k.put(new THREE.CylinderGeometry(top, bottom, h, 24), MAT.steel, x, y, z);
}

export function lensHousing(
  k: Kit,
  { x = 0, z = 0, y = 40, lenses = 1 }: { x?: number; z?: number; y?: number; lenses?: 1 | 2 } = {},
): void {
  k.put(new THREE.BoxGeometry(lenses === 2 ? 56 : 34, 26, 24), MAT.darkMetal, x, y, z);
  for (let i = 0; i < lenses; i++) {
    const dx = lenses === 2 ? x + (-14 + i * 28) : x;
    k.put(new THREE.CylinderGeometry(7, 7, 12, 20), MAT.steel, dx, y, z + 16, Math.PI / 2, 0, 0);
    k.put(new THREE.CylinderGeometry(5, 5, 3, 20), lensGlass(), dx, y, z + 23, Math.PI / 2, 0, 0);
  }
}

export function dish(
  k: Kit,
  { r = 18, x = 0, z = 0, y = 55, el = 0.6 }: { r?: number; x?: number; z?: number; y?: number; el?: number } = {},
): void {
  k.put(new THREE.CylinderGeometry(2, 3, 30, 10), MAT.steel, x, 30, z);
  k.put(
    new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    MAT.steel,
    x,
    y,
    z,
    -el,
    0,
    0,
  );
  k.put(new THREE.CylinderGeometry(1, 1, r * 0.8, 8), MAT.darkMetal, x, y + 6, z, 0.5, 0, 0);
}

export function horn(
  k: Kit,
  { x = 0, z = 0, y = 38, scale = 1 }: { x?: number; z?: number; y?: number; scale?: number } = {},
): void {
  k.put(new THREE.CylinderGeometry(2 * scale, 2 * scale, 12 * scale, 10), MAT.steel, x, y - 8 * scale, z);
  k.put(
    new THREE.CylinderGeometry(3 * scale, 10 * scale, 14 * scale, 20),
    MAT.darkMetal,
    x,
    y + 5 * scale,
    z,
  );
}

export function gantry(
  k: Kit,
  { w = 110, h = 60, x = 0, z = 0 }: { w?: number; h?: number; x?: number; z?: number } = {},
): void {
  for (const dx of [-w / 2, w / 2]) {
    k.put(new THREE.BoxGeometry(4, h, 4), MAT.steel, x + dx, 5 + h / 2, z);
  }
  k.put(new THREE.BoxGeometry(w + 6, 5, 6), MAT.steel, x, 5 + h, z);
  k.put(new THREE.BoxGeometry(w + 2, 2, 12), MAT.hazard, x, 5 + h - 6, z);
}

export function docRack(
  k: Kit,
  { x = 0, z = 0, w = 50, h = 55 }: { x?: number; z?: number; w?: number; h?: number } = {},
): void {
  for (const dx of [-w / 2, w / 2]) {
    for (const dz of [-10, 10]) {
      k.put(new THREE.BoxGeometry(2, h, 2), MAT.steel, x + dx, 5 + h / 2, z + dz);
    }
  }
  for (let i = 0; i < 4; i++) {
    k.put(new THREE.BoxGeometry(w, 1.5, 22), MAT.steel, x, 8 + i * 14, z);
    k.put(new THREE.BoxGeometry(w * 0.7, 10, 2), MAT.corrugated, x - 4, 14 + i * 14, z + 8, -0.15, 0, 0);
  }
}

// ---- accent (category color) ----------------------------------------------

let panelMat: THREE.MeshStandardMaterial | null = null;
function panel(): THREE.MeshStandardMaterial {
  if (!panelMat) panelMat = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffb85a, emissiveIntensity: 1.4 });
  return panelMat;
}

let lensMat: THREE.MeshPhysicalMaterial | null = null;
function lensGlass(): THREE.MeshPhysicalMaterial {
  if (!lensMat) lensMat = new THREE.MeshPhysicalMaterial({ color: 0x1a2b3a, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.85 });
  return lensMat;
}

/** One small category-colored accent plate per node so factory zones read. */
export function accent(
  k: Kit,
  color: number,
  { w = 24, h = 6, x = 0, y = 20, z = FRONT_Z + 1 }: { w?: number; h?: number; x?: number; y?: number; z?: number } = {},
): void {
  k.put(
    new THREE.BoxGeometry(w, h, 1.5),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 }),
    x,
    y,
    z,
  ).userData.accent = true;
}
