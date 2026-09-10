import { describe, expect, it } from "vitest";
import { NODE_CATEGORY, type NodeKind } from "@agent-world/core";
import { CATEGORY_COLORS, categoryColor, statusLedColor, buildNodeShape } from "./iso3d-shapes";

describe("categoryColor", () => {
  const kindsByCategory: Record<string, NodeKind[]> = {};
  for (const kind of Object.keys(NODE_CATEGORY) as NodeKind[]) {
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
    const covered = new Set(Object.keys(NODE_CATEGORY));
    expect(covered.size).toBe(29);
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

describe("buildNodeShape", () => {
  it("returns a group with a base block, LED and topper", () => {
    const shape = buildNodeShape("textGen");
    expect(shape.group).toBeDefined();
    expect(shape.led).toBeDefined();
    expect(shape.led.userData.role).toBe("led");
    // base + LED → at least 2 children; most kinds also have a topper (≥3).
    expect(shape.group.children.length).toBeGreaterThanOrEqual(2);
  });

  it("positions the LED on the front face top edge", () => {
    const shape = buildNodeShape("textGen");
    const frontZ = 92 / 2 + 2; // PLANT_H/2 + led offset
    expect(shape.led.position.z).toBeCloseTo(frontZ, 5);
    expect(shape.led.position.y).toBeCloseTo(50 - 8, 5); // NODE_HEIGHT - led inset
  });

  it("applies ground-plane rotation", () => {
    const shape = buildNodeShape("gate");
    expect(shape.group.rotation.y).toBeCloseTo(Math.PI / 8, 5);
  });

  it("gives a sampling of kinds their own topper (≥3 children)", () => {
    const samples: NodeKind[] = ["textGen", "gate", "fanout", "loop", "http", "compliance", "code", "imageGen"];
    for (const k of samples) {
      const shape = buildNodeShape(k);
      expect(shape.group.children.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("returns a fresh group per call", () => {
    const a = buildNodeShape("textGen");
    const b = buildNodeShape("textGen");
    expect(a.group).not.toBe(b.group);
  });
});