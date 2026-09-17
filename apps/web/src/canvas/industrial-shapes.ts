import * as THREE from "three";
import { PLANT_H, PLANT_W } from "../store/graph";
import type { NodeShape } from "./iso3d-shapes";
import { concreteTexture, corrugatedMetalTexture, hazardStripesTexture } from "./industrial-textures";

/**
 * Realistic industrial "factory" for the textGen node (prototype for the
 * 写实工业风 direction). Keeps the same ~150×92 footprint so pipe anchors and
 * the rotated-ground-plane layout stay byte-identical to the stylized blocks.
 *
 * Layout (x = across the 150-wide footprint, z = 92-deep, y = up):
 *   - concrete plinth foundation
 *   - concrete main hall with a corrugated sawtooth roof
 *   - rusty chimney (left) with a static steam puff
 *   - steel storage tank (right) on hazard-striped base, with a ball top
 *   - steel pipe arcing from the tank into the hall
 *   - glowing high windows + a door on the front face
 *   - status LED above the door (driven by the existing loop)
 */

const NODE_ROTATION = Math.PI / 8; // keep in sync with iso3d-shapes.ts

function add(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.userData.role = "body";
  group.add(m);
  return m;
}

export function buildIndustrialTextGenShape(): NodeShape {
  const group = new THREE.Group();

  // Materials (per-node; the graph-sync teardown disposes them, textures are shared).
  const concrete = new THREE.MeshStandardMaterial({
    map: concreteTexture(),
    roughness: 0.95,
    metalness: 0.05,
  });
  const corrugated = new THREE.MeshStandardMaterial({
    map: corrugatedMetalTexture(),
    roughness: 0.45,
    metalness: 0.85,
  });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.28, metalness: 0.95 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x7a4a32, roughness: 0.7, metalness: 0.45 });
  const hazard = new THREE.MeshStandardMaterial({
    map: hazardStripesTexture(),
    roughness: 0.55,
    metalness: 0.3,
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0xfff2d0,
    emissive: 0xffb85a,
    emissiveIntensity: 1.5,
    roughness: 0.4,
  });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.6, metalness: 0.6 });
  const steamMat = new THREE.MeshStandardMaterial({
    color: 0xdfe6ea,
    transparent: true,
    opacity: 0.35,
    roughness: 1,
    depthWrite: false,
  });

  // --- Plinth foundation ---
  add(group, new THREE.BoxGeometry(PLANT_W, 5, PLANT_H), concrete, 0, 2.5, 0);

  // --- Main hall (concrete) ---
  add(group, new THREE.BoxGeometry(120, 55, 76), concrete, 0, 32.5, 0);

  // --- Sawtooth roof (corrugated metal) ---
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-60, 0);
  roofShape.lineTo(-60, 16); // vertical glazing face (north light)
  roofShape.lineTo(-20, 0);
  roofShape.lineTo(-20, 16);
  roofShape.lineTo(20, 0);
  roofShape.lineTo(20, 16);
  roofShape.lineTo(60, 0);
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 76, bevelEnabled: false });
  add(group, roofGeo, corrugated, 0, 60, -38);

  // --- Chimney (rusty) + cap ---
  add(group, new THREE.CylinderGeometry(5, 7, 60, 20), rust, -66, 35, 0);
  add(group, new THREE.CylinderGeometry(9, 9, 4, 20), rust, -66, 66, 0);

  // --- Static steam puff above the chimney ---
  add(group, new THREE.SphereGeometry(5, 12, 12), steamMat, -66, 71, 0);
  add(group, new THREE.SphereGeometry(7, 12, 12), steamMat, -66, 77, 2);
  add(group, new THREE.SphereGeometry(6, 12, 12), steamMat, -66, 83, -1);

  // --- Storage tank (steel) on a hazard-striped base, ball top ---
  add(group, new THREE.CylinderGeometry(17, 17, 6, 24), hazard, 70, 8, 0);
  add(group, new THREE.CylinderGeometry(15, 15, 34, 24), steel, 70, 24, 0);
  add(group, new THREE.SphereGeometry(15, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), steel, 70, 41, 0);

  // --- Pipe arcing from the tank into the hall ---
  const pipeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(70, 40, 0),
    new THREE.Vector3(63, 48, 0),
    new THREE.Vector3(60, 46, 0),
  ]);
  add(group, new THREE.TubeGeometry(pipeCurve, 24, 3, 10), steel, 0, 0, 0);

  // --- Glowing high windows on the front face ---
  for (let i = 0; i < 4; i++) {
    add(group, new THREE.BoxGeometry(14, 10, 1.5), windowMat, -45 + i * 30, 44, 38.5);
  }

  // --- Front door ---
  add(group, new THREE.BoxGeometry(22, 24, 1.5), doorMat, 0, 17, 38.5);

  // --- Status LED above the door (the existing loop drives its color/emissive) ---
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(4, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x3a4148, emissive: 0x000000 }),
  );
  led.position.set(0, 32, 39.5);
  led.userData.role = "led";
  group.add(led);

  // Rotate on the ground plane like every other node so a side face reads.
  group.rotation.y = NODE_ROTATION;

  return { group, led };
}
