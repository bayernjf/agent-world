import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  MAX_LABEL_CHARS,
  NODE_LABEL_Y,
  makeNodeLabel,
  truncateNodeName,
} from "./nodeLabel";

describe("truncateNodeName", () => {
  it("returns short names unchanged (trimmed)", () => {
    expect(truncateNodeName("写草稿")).toBe("写草稿");
    expect(truncateNodeName("  写草稿  ")).toBe("写草稿");
  });

  it("truncates names longer than the cap with an ellipsis", () => {
    const long = "这是一个非常非常非常非常长的节点名称啊";
    const out = truncateNodeName(long);
    const chars = Array.from(out);
    expect(chars.length).toBe(MAX_LABEL_CHARS);
    expect(chars[chars.length - 1]).toBe("…");
  });

  it("does not split surrogate pairs (emoji stay intact)", () => {
    const out = truncateNodeName("😀".repeat(20), 6);
    // 5 kept emoji + ellipsis, no lone surrogates.
    expect(Array.from(out)).toHaveLength(6);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("makeNodeLabel", () => {
  it("builds a camera-facing sprite positioned above the node", () => {
    const sprite = makeNodeLabel("写草稿", "textGen");
    expect(sprite.isSprite).toBe(true);
    expect(sprite.position.y).toBe(NODE_LABEL_Y);
    expect(sprite.position.x).toBe(0);
    expect(sprite.position.z).toBe(0);
    expect(sprite.userData.role).toBe("label");
    // Pill keeps a fixed world height; width follows the text aspect.
    expect(sprite.scale.y).toBe(36);
    expect(sprite.scale.x).toBeGreaterThan(0);
  });

  it("never intercepts raycasts (does not steal node picking)", () => {
    const sprite = makeNodeLabel("翻译", "translate");
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, NODE_LABEL_Y, 100),
      new THREE.Vector3(0, 0, -1),
    );
    const hits = raycaster.intersectObject(sprite, false);
    expect(hits).toHaveLength(0);
  });

  it("reuses the cached texture for the same name + kind", () => {
    const a = makeNodeLabel("重复节点", "imageGen");
    const b = makeNodeLabel("重复节点", "imageGen");
    expect((a.material as THREE.SpriteMaterial).map).toBe(
      (b.material as THREE.SpriteMaterial).map,
    );
  });

  it("applies truncation to over-long names without throwing", () => {
    expect(() =>
      makeNodeLabel("x".repeat(80), "generic"),
    ).not.toThrow();
  });
});
