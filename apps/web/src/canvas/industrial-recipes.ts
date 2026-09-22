import * as THREE from "three";
import type { NodeKind } from "@agent-world/core";
import { categoryColor } from "./category-colors";
import { buildIndustrialTextGenShape } from "./industrial-shapes";
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
  lensHousing,
  manifold,
  MAT,
  motor,
  newNode,
  pipeRun,
  silo,
  valve,
  vessel,
  type Kit,
} from "./industrial-kit";

/** A node's 3D group plus its status LED (contract consumed by Canvas3D). */
export interface NodeShape {
  group: THREE.Group;
  led: THREE.Mesh;
}

/**
 * Build a realistic PBR machine for every node kind by composing shared kit
 * parts. Each recipe gets one category-colored accent plate so the five
 * factory zones stay distinguishable despite the common steel palette.
 */
export function buildIndustrialShape(kind: NodeKind): NodeShape {
  if (kind === "textGen") return buildIndustrialTextGenShape();

  const { k, led } = newNode();
  const color = categoryColor(kind);
  recipe(k, kind);
  accent(k, color);
  return { group: k.group, led };
}

function recipe(k: Kit, kind: NodeKind): void {
  switch (kind) {
    case "imageGen":
      cabinet(k, { x: -28 });
      lensHousing(k, { x: 24, y: 42 });
      break;
    case "videoGen":
      cabinet(k, { x: -32 });
      lensHousing(k, { x: 22, y: 42, lenses: 2 });
      motor(k, { x: 22, y: 66, s: 0.8 });
      break;
    case "audioGen":
      frame(k);
      horn(k, { x: 0, z: 0, scale: 1.6 });
      horn(k, { x: -34, z: -10, scale: 1 });
      horn(k, { x: 34, z: -10, scale: 1 });
      break;
    case "generic":
      frame(k);
      vessel(k, { x: 0 });
      motor(k, { x: -28, z: 10 });
      break;
    case "gate":
      gantry(k);
      pipeRun(k, { len: 120, y: 30, z: 0 });
      valve(k, { y: 30 });
      break;
    case "branch":
      frame(k);
      pipeRun(k, { len: 90, y: 36 });
      pipeRun(k, { len: 40, y: 36, axis: "z" });
      valve(k, { x: 0, y: 36 });
      break;
    case "map":
      conveyor(k, { len: 110 });
      k.put(new THREE.BoxGeometry(50, 2, 22), MAT.steel, 0, 24, 0);
      break;
    case "loop":
      frame(k);
      pipeRun(k, { len: 80, y: 30, z: -14 });
      pipeRun(k, { len: 80, y: 50, z: 14 });
      pipeRun(k, { len: 28, y: 40, axis: "z", x: -40 });
      pipeRun(k, { len: 28, y: 40, axis: "z", x: 40 });
      break;
    case "parallel":
      frame(k, { w: 120 });
      vessel(k, { x: -30, h: 32 });
      vessel(k, { x: 30, h: 32 });
      break;
    case "code":
      cabinet(k, { x: -30, h: 60 });
      docRack(k, { x: 26, w: 44, h: 58 });
      break;
    case "http":
      gantry(k);
      dish(k, { x: 0, y: 60, r: 20 });
      break;
    case "search":
      frame(k);
      dish(k, { x: 20, y: 52, r: 16, el: 1.1 });
      cabinet(k, { x: -30, h: 48 });
      break;
    case "fanout":
      frame(k);
      manifold(k, { branches: 4, y: 52 });
      break;
    case "select":
      frame(k);
      pipeRun(k, { len: 100, y: 34 });
      valve(k, { y: 34, s: 1.3 });
      break;
    case "table":
      conveyor(k, { len: 100, y: 16 });
      motor(k, { x: 0, y: 16, z: 20, s: 0.7 });
      break;
    case "database":
      frame(k);
      silo(k, { x: -28 });
      silo(k, { x: 28 });
      break;
    case "fileParse":
      hopper(k, { x: -30, z: 6 });
      docRack(k, { x: 24, w: 46 });
      break;
    case "ocr":
      conveyor(k, { len: 110 });
      gantry(k, { w: 100, h: 48, z: 0 });
      break;
    case "convert":
      frame(k);
      vessel(k, { x: -20, h: 44 });
      vessel(k, { x: 22, h: 30 });
      pipeRun(k, { len: 40, y: 48, z: 0 });
      break;
    case "subprocess":
      frame(k);
      vessel(k, { x: 18 });
      cabinet(k, { x: -28, h: 44 });
      break;
    case "translate":
      frame(k);
      cabinet(k, { x: -28, h: 52 });
      cabinet(k, { x: 28, h: 52 });
      break;
    case "notify":
      gantry(k);
      horn(k, { x: 0, y: 50, scale: 1.4 });
      break;
    case "vcs":
      frame(k);
      dish(k, { x: 26, y: 54, r: 15 });
      cabinet(k, { x: -26, h: 50 });
      break;
    case "human":
      cabinet(k, { x: 0, w: 60, h: 46, d: 26 });
      k.put(new THREE.BoxGeometry(50, 3, 24), MAT.steel, 0, 14, 24);
      for (const dx of [-22, 22]) {
        k.put(new THREE.BoxGeometry(3, 11, 3), MAT.steel, dx, 7, 24);
      }
      break;
    case "compliance":
      docRack(k, { x: -24, w: 46, h: 60 });
      cabinet(k, { x: 28, h: 64 });
      break;
    case "publish":
      gantry(k);
      dish(k, { x: -26, y: 56, r: 15 });
      horn(k, { x: 26, y: 50, scale: 1.2 });
      break;
    case "source":
      hopper(k, { x: 0, z: 4 });
      pipeRun(k, { len: 60, y: 24, axis: "z", z: -28 });
      break;
    case "sink":
      vessel(k, { x: 0 });
      pipeRun(k, { len: 60, y: 28, axis: "z", z: 28 });
      break;
  }
}
