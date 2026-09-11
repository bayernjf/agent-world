import { describe, it, expect } from "vitest";
import { parkLayout, type ParkFactory } from "./CanvasPark";

function makeFactory(overrides: Partial<ParkFactory> = {}): ParkFactory {
  return {
    id: "f1",
    name: "Test",
    category: "text",
    status: "idle",
    pendingReview: 0,
    ...overrides,
  };
}

describe("parkLayout", () => {
  it("returns empty map for no factories", () => {
    const result = parkLayout([]);
    expect(result.size).toBe(0);
  });

  it("places a single factory near origin", () => {
    const f = makeFactory({ id: "only" });
    const result = parkLayout([f]);
    expect(result.size).toBe(1);
    const pos = result.get("only")!;
    // Single category row should be centered near origin
    expect(Math.abs(pos.x)).toBeLessThan(200);
    expect(Math.abs(pos.z)).toBeLessThan(200);
  });

  it("places multiple factories without overlap", () => {
    const factories: ParkFactory[] = [
      makeFactory({ id: "a1", category: "text" }),
      makeFactory({ id: "a2", category: "text" }),
      makeFactory({ id: "a3", category: "text" }),
      makeFactory({ id: "b1", category: "image" }),
      makeFactory({ id: "b2", category: "image" }),
    ];
    const result = parkLayout(factories);
    expect(result.size).toBe(5);

    // All positions should be unique (no overlap)
    const positions = [...result.values()];
    const seen = new Set<string>();
    for (const p of positions) {
      const key = `${Math.round(p.x)},${Math.round(p.z)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("respects manual coordinates and does not overlap them", () => {
    const manual = makeFactory({ id: "manual", category: "text", manual: { x: 0, z: 0 } });
    const auto = makeFactory({ id: "auto", category: "text" });
    const result = parkLayout([manual, auto]);

    expect(result.get("manual")).toEqual({ x: 0, z: 0 });
    const autoPos = result.get("auto")!;
    // Auto should not be at the exact same position as manual (collision avoidance)
    const samePosition = autoPos.x === 0 && autoPos.z === 0;
    expect(samePosition).toBe(false);
  });

  it("is deterministic: same input produces same output", () => {
    const factories: ParkFactory[] = [
      makeFactory({ id: "c1", category: "video" }),
      makeFactory({ id: "c2", category: "document" }),
      makeFactory({ id: "c3", category: "ecommerce" }),
      makeFactory({ id: "c4", category: "research" }),
    ];
    const first = parkLayout(factories);
    const second = parkLayout(factories);
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it("groups factories by category into rows", () => {
    const factories: ParkFactory[] = [
      makeFactory({ id: "t1", category: "text" }),
      makeFactory({ id: "t2", category: "text" }),
      makeFactory({ id: "i1", category: "image" }),
      makeFactory({ id: "i2", category: "image" }),
    ];
    const result = parkLayout(factories);

    // Same category should be on the same row (same z)
    const t1z = result.get("t1")!.z;
    const t2z = result.get("t2")!.z;
    const i1z = result.get("i1")!.z;
    const i2z = result.get("i2")!.z;
    expect(t1z).toBe(t2z);
    expect(i1z).toBe(i2z);
    // Different categories should be on different rows
    expect(t1z).not.toBe(i1z);
  });

  it("handles 100 factories without error", () => {
    const categories = ["text", "image", "video", "document", "ecommerce", "research"];
    const factories: ParkFactory[] = Array.from({ length: 100 }, (_, i) =>
      makeFactory({ id: `f${i}`, category: categories[i % 6]! }),
    );
    const result = parkLayout(factories);
    expect(result.size).toBe(100);
  });
});
