import { describe, it, expect, vi, afterEach } from "vitest";
import {
  findAnchor,
  holeRect,
  placeCard,
  registerTourAction,
  runTourAction,
  type Rect,
} from "./guided-tour-engine";

const VP = { width: 1280, height: 800 };
const CARD = { width: 200, height: 100 };
const GAP = 12;

describe("placeCard", () => {
  it("centers for a null target", () => {
    const p = placeCard(null, "center", CARD, VP, GAP);
    expect(p).toEqual({ top: 350, left: 540, placement: "center" });
  });

  it("places to the right, vertically centered on the anchor", () => {
    const target: Rect = { top: 100, left: 100, width: 50, height: 40 };
    const p = placeCard(target, "right", CARD, VP, GAP);
    expect(p.left).toBe(162); // 100 + 50 + 12
    expect(p.top).toBe(70); // 100 + 20 - 50
    expect(p.placement).toBe("right");
  });

  it("flips to the left when the right side overflows", () => {
    const target: Rect = { top: 300, left: 1200, width: 50, height: 40 };
    const p = placeCard(target, "right", CARD, VP, GAP);
    expect(p.placement).toBe("left");
    expect(p.left).toBe(1200 - GAP - CARD.width);
  });

  it("flips above when the bottom overflows", () => {
    const target: Rect = { top: 760, left: 400, width: 80, height: 30 };
    const p = placeCard(target, "bottom", CARD, VP, GAP);
    expect(p.placement).toBe("top");
  });

  it("clamps the card inside the viewport", () => {
    const target: Rect = { top: -5, left: 10, width: 40, height: 20 };
    const p = placeCard(target, "bottom", CARD, VP, GAP);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left + CARD.width).toBeLessThanOrEqual(VP.width - 12);
  });
});

describe("holeRect", () => {
  it("grows the rect by the padding on every side", () => {
    expect(holeRect({ top: 10, left: 20, width: 30, height: 40 }, 6)).toEqual({
      top: 4,
      left: 14,
      width: 42,
      height: 52,
    });
  });
});

describe("tour action registry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs a registered action by key and ignores unknown keys", () => {
    const fn = vi.fn();
    registerTourAction("unit:action", fn);
    runTourAction("unit:action");
    expect(fn).toHaveBeenCalledOnce();
    expect(() => runTourAction("unit:missing")).not.toThrow();
    expect(() => runTourAction(undefined)).not.toThrow();
  });

  it("swallows a throwing action so the tour never breaks", () => {
    registerTourAction("unit:boom", () => {
      throw new Error("x");
    });
    expect(() => runTourAction("unit:boom")).not.toThrow();
  });
});

describe("findAnchor", () => {
  it("resolves a data-tour element and returns null when absent", () => {
    expect(findAnchor("missing:anchor")).toBeNull();
    const el = document.createElement("div");
    el.setAttribute("data-tour", "raw:input");
    document.body.appendChild(el);
    expect(findAnchor("raw:input")).toBe(el);
    el.remove();
  });

  it("returns null for a centered (empty) target", () => {
    expect(findAnchor(null)).toBeNull();
    expect(findAnchor(undefined)).toBeNull();
  });
});
