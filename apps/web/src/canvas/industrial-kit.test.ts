import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  accent,
  cabinet,
  conveyor,
  dish,
  docRack,
  frame,
  gantry,
  hopper,
  horn,
  kit,
  lensHousing,
  manifold,
  MAT,
  motor,
  newNode,
  pipeRun,
  silo,
  valve,
  vessel,
} from "./industrial-kit";

const HALF_W = 84; // (PLANT_W+18)/2
const HALF_H = 55; // (PLANT_H+18)/2
const MAX_TOP = 110;

function bodies(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.userData.role === "body");
}

const PARTS: ((k: ReturnType<typeof kit>) => void)[] = [
  (k) => frame(k),
  (k) => cabinet(k),
  (k) => vessel(k),
  (k) => silo(k),
  (k) => pipeRun(k),
  (k) => valve(k),
  (k) => manifold(k),
  (k) => motor(k),
  (k) => conveyor(k),
  (k) => hopper(k),
  (k) => lensHousing(k),
  (k) => dish(k),
  (k) => horn(k),
  (k) => gantry(k),
  (k) => docRack(k),
  (k) => accent(k, 0x8b7cf6),
];

describe("industrial kit parts", () => {
  it("tags every mesh as a highlightable body and stays within the footprint/height", () => {
    for (const part of PARTS) {
      const group = new THREE.Group();
      part(kit(group));
      const meshes = bodies(group);
      expect(meshes.length).toBeGreaterThan(0);
      for (const m of meshes) {
        expect(Math.abs(m.position.x), m.geometry.type).toBeLessThanOrEqual(HALF_W);
        expect(Math.abs(m.position.z), m.geometry.type).toBeLessThanOrEqual(HALF_H);
        expect(m.position.y, m.geometry.type).toBeLessThanOrEqual(MAX_TOP);
      }
    }
  });

  it("flags only the accent part", () => {
    const group = new THREE.Group();
    accent(kit(group), 0x2eb8a6);
    expect(group.children.filter((c) => c.userData.accent === true)).toHaveLength(1);
  });

  it("shares module-level PBR materials (stable identity)", () => {
    expect(MAT.steel).toBe(MAT.steel);
    const a = new THREE.Group();
    const b = new THREE.Group();
    vessel(kit(a));
    vessel(kit(b));
    expect(a.children[1]!.material).toBe(b.children[1]!.material);
  });
});

describe("newNode", () => {
  it("builds a rotated node with plinth, LED and a stem", () => {
    const { k, led } = newNode();
    expect(led.userData.role).toBe("led");
    expect(k.group.rotation.y).toBeCloseTo(Math.PI / 8, 5);
    expect(k.group.children.length).toBeGreaterThanOrEqual(3);
    // LED is never traversed as a highlightable body.
    expect(bodies(k.group).includes(led)).toBe(false);
  });
});
