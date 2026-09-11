import { describe, expect, it } from "vitest";
import {
  COL_GAP,
  FACTORY_SIZE,
  HARD_CAP,
  MIN_GAP,
  parkLayout,
  ROW_GAP,
  type ParkLayoutInput,
} from "./parkLayout.js";

function auto(id: string, category = "text"): ParkLayoutInput {
  return { id, category };
}
function manual(id: string, x: number, z: number, category = "text"): ParkLayoutInput {
  return { id, category, manual: { x, z } };
}
function allPairsNoOverlap(layout: Map<string, { x: number; z: number }>): boolean {
  const coords = [...layout.values()];
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const dx = coords[i]!.x - coords[j]!.x;
      const dz = coords[i]!.z - coords[j]!.z;
      if (Math.sqrt(dx * dx + dz * dz) < MIN_GAP) return false;
    }
  }
  return true;
}

describe("parkLayout", () => {
  it("1. empty input returns empty map", () => {
    expect(parkLayout([])).toEqual(new Map());
  });

  it("2. single auto factory centers at (0,0)", () => {
    const layout = parkLayout([auto("a")]);
    expect(layout.get("a")).toEqual({ x: 0, z: 0 });
  });

  it("3. five same-category factories form one evenly-spaced row with no overlap", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const layout = parkLayout(ids.map((id) => auto(id, "text")));
    const zs = new Set(ids.map((id) => layout.get(id)!.z));
    expect(zs.size).toBe(1); // 同一行
    expect(zs.has(0)).toBe(true); // 行居中
    const xs = ids.map((id) => layout.get(id)!.x).sort((a, b) => a - b);
    // 等距 COL_GAP
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeCloseTo(COL_GAP, 5);
    }
    expect(allPairsNoOverlap(layout)).toBe(true);
  });

  it("4. multiple categories form separate rows, each category in one row", () => {
    const layout = parkLayout([
      auto("a1", "text"),
      auto("a2", "text"),
      auto("b1", "image"),
      auto("c1", "video"),
      auto("c2", "video"),
    ]);
    // 三类 → 三行，z 值各不相同
    const zByCat: Record<string, number[]> = {};
    for (const [id, coord] of layout) {
      const cat = id.startsWith("a") ? "text" : id.startsWith("b") ? "image" : "video";
      (zByCat[cat] ??= []).push(coord.z);
    }
    const allZ = Object.values(zByCat).flat();
    expect(new Set(allZ).size).toBe(3);
    // 同类 z 相同
    for (const cat of Object.keys(zByCat)) {
      expect(new Set(zByCat[cat]).size).toBe(1);
    }
    // 行间距 = ROW_GAP
    const sortedZ = [...new Set(allZ)].sort((a, b) => a - b);
    for (let i = 1; i < sortedZ.length; i++) {
      expect(sortedZ[i]! - sortedZ[i - 1]!).toBeCloseTo(ROW_GAP, 5);
    }
    expect(allPairsNoOverlap(layout)).toBe(true);
  });

  it("5. manual coordinates are preserved and auto factories avoid them", () => {
    const layout = parkLayout([
      manual("m1", 0, 0, "text"),
      auto("a1", "text"),
      auto("a2", "text"),
    ]);
    expect(layout.get("m1")).toEqual({ x: 0, z: 0 });
    // 自动厂不与手动厂重叠
    for (const id of ["a1", "a2"]) {
      const c = layout.get(id)!;
      expect(Math.sqrt(c.x * c.x + c.z * c.z)).toBeGreaterThanOrEqual(MIN_GAP);
    }
    expect(allPairsNoOverlap(layout)).toBe(true);
  });

  it("6. deterministic: same input twice deep-equal AND shuffled input order yields same result", () => {
    const input = [
      auto("z", "video"),
      auto("a", "text"),
      auto("m", "image"),
      auto("b", "text"),
      manual("man", 500, 500, "text"),
    ];
    const r1 = parkLayout(input);
    const r2 = parkLayout(input);
    expect([...r1.entries()]).toEqual([...r2.entries()]);
    // 打乱顺序
    const shuffled = [...input].reverse();
    const r3 = parkLayout(shuffled);
    expect([...r1.entries()].sort()).toEqual([...r3.entries()].sort());
  });

  it("7. manual factory blocking an auto slot triggers spiral avoidance with no overlap", () => {
    // 单个自动厂本应在 (0,0)，手动厂堵在 (0,0) → 自动厂必须螺旋让位
    const layout = parkLayout([manual("blocker", 0, 0, "text"), auto("auto1", "text")]);
    expect(layout.get("blocker")).toEqual({ x: 0, z: 0 });
    const a = layout.get("auto1")!;
    expect(a.x).not.toBe(0);
    expect(a.z).not.toBe(0);
    expect(Math.sqrt(a.x * a.x + a.z * a.z)).toBeGreaterThanOrEqual(MIN_GAP);
    expect(allPairsNoOverlap(layout)).toBe(true);
  });

  it("8. N=100 all-auto factories have no overlap and stay performant", () => {
    const input: ParkLayoutInput[] = [];
    const cats = ["text", "image", "video", "document", "ecommerce"];
    for (let i = 0; i < 100; i++) {
      input.push(auto(`g${String(i).padStart(3, "0")}`, cats[i % cats.length]!));
    }
    const start = performance.now();
    const layout = parkLayout(input);
    const elapsed = performance.now() - start;
    expect(layout.size).toBe(100);
    expect(allPairsNoOverlap(layout)).toBe(true);
    // N=100 O(n²) 距离运算应远低于 50ms（CI 负载下放宽到 50ms）
    expect(elapsed).toBeLessThan(50);
  });

  it("9. missing/empty category falls into 自定义 bucket without throwing", () => {
    const layout = parkLayout([
      { id: "no-cat" },
      { id: "empty-cat", category: "" },
      auto("normal", "text"),
    ]);
    expect(layout.size).toBe(3);
    // no-cat 和 empty-cat 归入同一桶（自定义），与 normal 分行
    const noCatZ = layout.get("no-cat")!.z;
    const emptyCatZ = layout.get("empty-cat")!.z;
    const normalZ = layout.get("normal")!.z;
    expect(noCatZ).toBe(emptyCatZ);
    expect(noCatZ).not.toBe(normalZ);
    expect(allPairsNoOverlap(layout)).toBe(true);
  });

  it("10. all-manual input preserves coordinates exactly with zero auto rearrangement", () => {
    const input = [
      manual("m1", 100, 200, "text"),
      manual("m2", -500, 800, "image"),
      manual("m3", 0, 0, "video"),
    ];
    const layout = parkLayout(input);
    expect(layout.get("m1")).toEqual({ x: 100, z: 200 });
    expect(layout.get("m2")).toEqual({ x: -500, z: 800 });
    expect(layout.get("m3")).toEqual({ x: 0, z: 0 });
    // 手动厂不互相避让（尊重用户显式摆放），此处 m3 在原点不与 m1/m2 重叠
    expect(layout.size).toBe(3);
  });

  it("constants are exported and match the design spec", () => {
    expect(FACTORY_SIZE).toBe(200);
    expect(ROW_GAP).toBe(440);
    expect(COL_GAP).toBe(320);
    expect(MIN_GAP).toBe(240);
    expect(HARD_CAP).toBe(200);
  });
});
