import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { NODE_CATEGORY, type NodeKind } from "@agent-world/core";
import { PLANT_H } from "../store/graph";
import { MAT } from "./industrial-kit";
import {
  CATEGORY_COLORS,
  categoryColor,
  statusLedColor,
  buildNodeShape,
  setGroupEmissive,
  clearGroupEmissive,
  SELECT_COLOR,
  SELECT_EMISSIVE_INTENSITY,
} from "./iso3d-shapes";

const ALL_KINDS = Object.keys(NODE_CATEGORY) as NodeKind[];

describe("categoryColor", () => {
  const kindsByCategory: Record<string, NodeKind[]> = {};
  for (const kind of ALL_KINDS) {
    const cat = NODE_CATEGORY[kind];
    (kindsByCategory[cat] ??= []).push(kind);
  }

  for (const [cat, kinds] of Object.entries(kindsByCategory)) {
    it(`maps "${cat}" kinds to the correct color`, () => {
      const expected = CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS];
      expect(expected).toBeDefined();
      for (const k of kinds) {
        expect(categoryColor(k)).toBe(expected);
      }
    });
  }

  it("covers all 29 kinds", () => {
    expect(new Set(ALL_KINDS).size).toBe(29);
  });
});

describe("statusLedColor", () => {
  it("uses amber for halted regardless of status", () => {
    expect(statusLedColor("running", true)).toBe(0xffd54a);
    expect(statusLedColor(undefined, true)).toBe(0xffd54a);
    expect(statusLedColor("done", true)).toBe(0xffd54a);
  });

  it("uses green for running", () => {
    expect(statusLedColor("running", false)).toBe(0x69f0ae);
  });

  it("uses red for failed", () => {
    expect(statusLedColor("failed", false)).toBe(0xff5252);
  });

  it("uses dark green for done", () => {
    expect(statusLedColor("done", false)).toBe(0x4caf50);
  });

  it("uses orange for scrapped", () => {
    expect(statusLedColor("scrapped", false)).toBe(0xff8a65);
  });

  it("uses blue-grey for skipped", () => {
    expect(statusLedColor("skipped", false)).toBe(0x6b7a8a);
  });

  it("uses dark grey for idle/unknown", () => {
    expect(statusLedColor(undefined, false)).toBe(0x3a4148);
  });
});

describe("buildNodeShape — realistic rollout", () => {
  it("covers every one of the 29 kinds", () => {
    for (const kind of ALL_KINDS) {
      const shape = buildNodeShape(kind);
      expect(shape.group).toBeTruthy();
      expect(shape.led).toBeTruthy();
      expect(shape.led.userData.role).toBe("led");
      expect(shape.group.children.length, kind).toBeGreaterThanOrEqual(3);
    }
  });

  it("mounts the standard LED on a front stem for all non-textGen kinds", () => {
    for (const kind of ALL_KINDS) {
      if (kind === "textGen") continue;
      const { led } = buildNodeShape(kind);
      expect(led.position.z, kind).toBeCloseTo(PLANT_H / 2 + 3, 5);
      expect(led.position.y, kind).toBeCloseTo(13, 5);
    }
  });

  it("mounts the textGen LED on the front wall above the door", () => {
    const { led } = buildNodeShape("textGen");
    expect(led.position.z).toBeGreaterThan(0);
    expect(led.position.y).toBeGreaterThan(29);
  });

  it("applies the shared ground-plane rotation to every kind", () => {
    for (const kind of ALL_KINDS) {
      expect(buildNodeShape(kind).group.rotation.y, kind).toBeCloseTo(Math.PI / 8, 5);
    }
  });

  it("gives each non-textGen node exactly one category-colored accent", () => {
    for (const kind of ALL_KINDS) {
      if (kind === "textGen") continue;
      const accents = buildNodeShape(kind).group.children.filter((c) => c.userData.accent === true);
      expect(accents.length, kind).toBe(1);
    }
  });

  it("returns a fresh group per call", () => {
    expect(buildNodeShape("code").group).not.toBe(buildNodeShape("code").group);
  });
});

describe("selection highlight is per node, never per shared material", () => {
  const bodyMeshes = (group: THREE.Group) => {
    const out: THREE.Mesh[] = [];
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.role !== "led") out.push(mesh);
    });
    return out;
  };
  const sharedPool = () => Object.values(MAT) as THREE.MeshStandardMaterial[];
  const poolSnapshot = () => sharedPool().map((m) => [m.emissive.getHex(), m.emissiveIntensity]);

  it("lights the chosen node and leaves the kit pool alone", () => {
    // The shape of the old bug: every node composes the same module-level MAT, so
    // writing emissive in place lit up the whole park when one machine was picked.
    const before = poolSnapshot();
    const chosen = buildNodeShape("http");
    const other = buildNodeShape("http");
    const otherMats = bodyMeshes(other.group).map((m) => m.material);

    setGroupEmissive(chosen.group, SELECT_COLOR, SELECT_EMISSIVE_INTENSITY);

    expect(poolSnapshot()).toEqual(before);
    for (const mesh of bodyMeshes(chosen.group)) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.emissive.getHex()).toBe(SELECT_COLOR);
      expect(mat.emissiveIntensity).toBe(SELECT_EMISSIVE_INTENSITY);
    }
    bodyMeshes(other.group).forEach((mesh, i) => {
      expect(mesh.material).toBe(otherMats[i]);
    });
  });

  it("re-applying does not stack clones, and clearing restores the original objects", () => {
    const node = buildNodeShape("textGen");
    const originals = bodyMeshes(node.group).map((m) => m.material);

    setGroupEmissive(node.group, SELECT_COLOR, SELECT_EMISSIVE_INTENSITY);
    setGroupEmissive(node.group, SELECT_COLOR, 0.1);

    const highlighted = bodyMeshes(node.group);
    expect(highlighted.length).toBeGreaterThan(0);
    highlighted.forEach((mesh, i) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat).not.toBe(originals[i]);
      expect((mat.userData as { awHighlight?: boolean }).awHighlight).toBe(true);
      // Reading 0.1 (not 0.4, and not a clone of the previous clone) is the proof.
      expect(mat.emissiveIntensity).toBe(0.1);
    });

    clearGroupEmissive(node.group);
    bodyMeshes(node.group).forEach((mesh, i) => {
      expect(mesh.material).toBe(originals[i]);
    });
  });

  it("leaves the status LED to the per-frame LED driver", () => {
    const node = buildNodeShape("notify");
    const ledMat = node.led.material as THREE.MeshStandardMaterial;
    const before: [number, number] = [ledMat.emissive.getHex(), ledMat.emissiveIntensity];

    setGroupEmissive(node.group, SELECT_COLOR, SELECT_EMISSIVE_INTENSITY);
    clearGroupEmissive(node.group);

    expect([ledMat.emissive.getHex(), ledMat.emissiveIntensity]).toEqual(before);
  });
});
