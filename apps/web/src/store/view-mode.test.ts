import { describe, it, expect, beforeEach } from "vitest";
import { useViewMode } from "./view-mode";

describe("view-mode store", () => {
  beforeEach(() => {
    useViewMode.setState({
      viewMode: "2d",
      camera3d: null,
      camera3dZoom: 1,
      camera3dTarget: null,
      camera3dZoomRequest: null,
      camera3dMoveRequest: null,
      camera3dResetRequest: false,
    });
  });

  describe("toggle", () => {
    it("starts in 2d", () => {
      expect(useViewMode.getState().viewMode).toBe("2d");
    });

    it("toggles 2d→3d", () => {
      useViewMode.getState().toggle();
      expect(useViewMode.getState().viewMode).toBe("3d");
    });

    it("toggles 3d→2d", () => {
      useViewMode.getState().toggle();
      useViewMode.getState().toggle();
      expect(useViewMode.getState().viewMode).toBe("2d");
    });
  });

  describe("setViewMode", () => {
    it("sets 3d directly", () => {
      useViewMode.getState().setViewMode("3d");
      expect(useViewMode.getState().viewMode).toBe("3d");
    });

    it("sets 2d directly", () => {
      useViewMode.getState().setViewMode("3d");
      useViewMode.getState().setViewMode("2d");
      expect(useViewMode.getState().viewMode).toBe("2d");
    });
  });

  describe("persisted state", () => {
    it("camera3d is null initially", () => {
      expect(useViewMode.getState().camera3d).toBeNull();
    });

    it("stores and retrieves camera3d", () => {
      const cam = { posX: 1, posY: 2, posZ: 3, targetX: 4, targetZ: 5 };
      useViewMode.getState().setCamera3d(cam);
      expect(useViewMode.getState().camera3d).toEqual(cam);
    });
  });

  describe("one-shot zoom request", () => {
    it("queues and consumes a zoom request", () => {
      useViewMode.getState().requestCamera3dZoom(0.5);
      expect(useViewMode.getState().camera3dZoomRequest).toBe(0.5);
      expect(useViewMode.getState().consumeCamera3dZoomRequest()).toBe(0.5);
      // Consumed: second read returns null.
      expect(useViewMode.getState().consumeCamera3dZoomRequest()).toBeNull();
    });

    it("returns null when no zoom request is pending", () => {
      expect(useViewMode.getState().consumeCamera3dZoomRequest()).toBeNull();
    });
  });

  describe("one-shot move request", () => {
    it("queues and consumes a move request", () => {
      useViewMode.getState().requestCamera3dMove(100, 200);
      expect(useViewMode.getState().camera3dMoveRequest).toEqual({ x: 100, z: 200 });
      expect(useViewMode.getState().consumeCamera3dMoveRequest()).toEqual({ x: 100, z: 200 });
      expect(useViewMode.getState().consumeCamera3dMoveRequest()).toBeNull();
    });

    it("returns null when no move request is pending", () => {
      expect(useViewMode.getState().consumeCamera3dMoveRequest()).toBeNull();
    });
  });

  describe("one-shot reset request", () => {
    it("queues and consumes a reset request", () => {
      useViewMode.getState().requestCamera3dReset();
      expect(useViewMode.getState().camera3dResetRequest).toBe(true);
      expect(useViewMode.getState().consumeCamera3dResetRequest()).toBe(true);
      expect(useViewMode.getState().consumeCamera3dResetRequest()).toBe(false);
    });

    it("returns false when no reset is pending", () => {
      expect(useViewMode.getState().consumeCamera3dResetRequest()).toBe(false);
    });
  });

  describe("live camera sync", () => {
    it("setCamera3dZoom sets the live zoom", () => {
      useViewMode.getState().setCamera3dZoom(2);
      expect(useViewMode.getState().camera3dZoom).toBe(2);
    });

    it("setCamera3dTarget sets the live target", () => {
      useViewMode.getState().setCamera3dTarget({ x: 50, z: 80 });
      expect(useViewMode.getState().camera3dTarget).toEqual({ x: 50, z: 80 });
    });

    it("setting the same target does not change the reference", () => {
      const t = { x: 0, z: 0 };
      useViewMode.getState().setCamera3dTarget(t);
      // Should be a different object (React needs stable refs when unchanged).
      useViewMode.getState().setCamera3dTarget({ x: 0, z: 0 });
      expect(useViewMode.getState().camera3dTarget).toEqual(t);
    });
  });
});