/**
 * CanvasPark — RTS Stage B L0 macro-park scene (production).
 *
 * Renders N low-poly "factories" (one per pipeline) in a single InstancedMesh
 * draw call, with sprite billboards, per-frame status colors and a raycast
 * selection + HTML action popover (enter / retry / pause cron).
 *
 * Design: docs/design-rts-stage-b.md B4 (scene), B6 (live state), B7 (select +
 * popover), B8 (camera memory for drill-down). Mount-once: renderer/camera/loop
 * are created once; factories prop changes only update matrices/billboards.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { parkLayout } from "@agent-world/core";
import { useViewMode } from "../store/view-mode";

// --- Constants (aligned with L1 Canvas3D, larger park scale) ---
const PITCH = Math.PI / 3; // lock pitch 60deg from vertical
const YAW = (5 * Math.PI) / 4; // classic RTS left-rear view
const CAMERA_DIST = 3000; // park scale, L1 is 1200
const FACTORY_SIZE = 200; // three geometry size (layout constants live in core/parkLayout.ts)
const FACTORY_H = 140;
const MAX_FACTORIES = 100;
const GROUND_SIZE = 6000;
const BREATH_SPEED = 0.006; // B6: running factory breathing frequency

// --- Types ---
export type FactoryStatus = "running" | "done" | "failed" | "halted" | "idle";

export interface ParkFactory {
  id: string;
  name: string;
  category: string;
  status: FactoryStatus;
  pendingReview: number;
  /** True when the pipeline has at least one cron trigger (shows the pause-cron action). */
  hasCron?: boolean;
  /** Last run id, used by the retry action. */
  lastRunId?: string | null;
  manual?: { x: number; z: number }; // manual coordinates take priority
}

interface ParkSceneState {
  factoryGroup: THREE.Group;
  instancedMesh: THREE.InstancedMesh;
  billboardGroup: THREE.Group;
  selectionRing: THREE.Mesh;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  layout: Map<string, { x: number; z: number }>;
  idByIndex: string[]; // instanceId to graphId mapping
  dummy: THREE.Object3D; // reused object, avoids per-frame allocation
}

// --- Status colors (reuse L1 semantics) ---
const STATUS_COLORS: Record<FactoryStatus, number> = {
  running: 0x4ade80, // green
  done: 0x60a5fa, // blue
  failed: 0xf87171, // red
  halted: 0xfbbf24, // yellow
  idle: 0x6b7280, // gray
};

// Deterministic category palette: any category string (including the Chinese
// template categories) hashes to a stable low-poly color.
const CATEGORY_PALETTE = [
  0x818cf8, 0xf472b6, 0xfb923c, 0x34d399, 0x22d3ee, 0xa78bfa, 0x94a3b8, 0xfacc15,
];

function categoryColor(cat: string): number {
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length]!;
}

// --- Sprite text texture generation (cached by text/color) ---
const textureCache = new Map<string, THREE.CanvasTexture>();

function makeTextTexture(text: string, color: string, fontSize = 48): THREE.CanvasTexture {
  const cacheKey = `${text}|${color}|${fontSize}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas); // headless / no-2d-context fallback
  const font = `bold ${fontSize}px sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const pad = 16;
  canvas.width = Math.ceil(metrics.width) + pad * 2;
  canvas.height = fontSize + pad * 2;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  textureCache.set(cacheKey, tex);
  return tex;
}

function makeBadgeTexture(count: number): THREE.CanvasTexture {
  const text = count > 99 ? "99+" : String(count);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas); // headless fallback
  const size = 80;
  canvas.width = size;
  canvas.height = size;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#ef4444";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

export default function CanvasPark({
  factories,
  onEnter,
  onRetry,
  onToggleCron,
}: {
  factories: ParkFactory[];
  onEnter?: (id: string) => void;
  onRetry?: (id: string, lastRunId: string | null | undefined) => void;
  onToggleCron?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const mountRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const parkRef = useRef<ParkSceneState | null>(null);
  // live data ref: rAF reads every frame, does not trigger React re-render
  const dataRef = useRef(factories);
  dataRef.current = factories;
  // Selection lives in React (drives the popover) and is mirrored into a ref for rAF.
  const [selId, setSelId] = useState<string | null>(null);
  const selRef = useRef<string | null>(selId);
  selRef.current = selId;
  // Action callbacks mirrored into refs so the mount-once effect never re-binds.
  const actionsRef = useRef({ onEnter, onRetry, onToggleCron });
  actionsRef.current = { onEnter, onRetry, onToggleCron };

  const selected = useMemo(
    () => (selId ? factories.find((f) => f.id === selId) ?? null : null),
    [selId, factories],
  );

  // === Mount-once effect: renderer / camera / lights / ground / loop / events ===
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      renderer.setSize(width, height);
      parkRef.current?.camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14181d);

    const aspect = mount.clientWidth / mount.clientHeight;
    const frustum = 1600;
    const camera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      0.1,
      10000,
    );

    const h = CAMERA_DIST * Math.sin(PITCH);
    const y = CAMERA_DIST * Math.cos(PITCH);
    camera.position.set(h * Math.cos(YAW), y, h * Math.sin(YAW));
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = undefined;
    controls.minPolarAngle = PITCH;
    controls.maxPolarAngle = PITCH;
    // B8: restore the L0 camera pose saved on the previous drill-down.
    const saved = useViewMode.getState().parkCamera;
    if (saved) {
      camera.position.set(saved.posX, saved.posY, saved.posZ);
      controls.target.set(saved.targetX, saved.targetY, saved.targetZ);
      camera.zoom = saved.zoom;
    }
    controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(-600, 1200, -600);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -3000;
    dir.shadow.camera.right = 3000;
    dir.shadow.camera.top = 3000;
    dir.shadow.camera.bottom = -3000;
    dir.shadow.camera.near = 100;
    dir.shadow.camera.far = 5000;
    scene.add(ambient, dir);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshLambertMaterial({ color: 0x1c2229 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(GROUND_SIZE, 60, 0x2a323b, 0x20262d);
    grid.position.y = 0.5;
    scene.add(grid);

    // empty groups: filled by data-sync effect
    const factoryGroup = new THREE.Group();
    const billboardGroup = new THREE.Group();
    scene.add(factoryGroup, billboardGroup);

    // InstancedMesh: N factories one draw call
    const factoryGeo = new THREE.BoxGeometry(FACTORY_SIZE, FACTORY_H, FACTORY_SIZE);
    const factoryMat = new THREE.MeshLambertMaterial();
    const instancedMesh = new THREE.InstancedMesh(factoryGeo, factoryMat, MAX_FACTORIES);
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    factoryGroup.add(instancedMesh);

    const ringGeo = new THREE.RingGeometry(FACTORY_SIZE * 0.7, FACTORY_SIZE * 0.85, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const selectionRing = new THREE.Mesh(ringGeo, ringMat);
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.y = 1;
    selectionRing.visible = false;
    scene.add(selectionRing);

    const state: ParkSceneState = {
      factoryGroup,
      instancedMesh,
      billboardGroup,
      selectionRing,
      camera,
      controls,
      layout: new Map(),
      idByIndex: [],
      dummy: new THREE.Object3D(),
    };
    parkRef.current = state;

    // === Raycast selection (InstancedMesh + instanceId) ===
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const projVec = new THREE.Vector3();
    let downX = 0;
    let downY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // pointer capture may fail on some browsers; non-fatal
      }
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      try {
        if (renderer.domElement.hasPointerCapture(e.pointerId)) {
          renderer.domElement.releasePointerCapture(e.pointerId);
        }
      } catch {
        // release may fail if capture was never set; non-fatal
      }
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 4;
      if (moved) return; // drag pan, do not select
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(instancedMesh);
      if (hits.length > 0 && hits[0]!.instanceId != null) {
        const idx = hits[0]!.instanceId;
        const id = state.idByIndex[idx];
        if (id) setSelId(id);
      } else {
        setSelId(null);
      }
    };

    const onPointerCancel = () => {};
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);

    // === rAF loop: read dataRef every frame for colors, ring and popover anchor ===
    let rafId = 0;
    const tmpColor = new THREE.Color();
    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const st = parkRef.current;
      if (!st) return;

      const facts = dataRef.current;
      // per-instance color update (status + running breathing)
      for (let i = 0; i < facts.length; i++) {
        const f = facts[i]!;
        let color = STATUS_COLORS[f.status];
        if (f.status === "running") {
          const t = 0.5 + 0.4 * Math.sin(now * BREATH_SPEED);
          tmpColor.setHex(color).multiplyScalar(0.6 + t * 0.6);
          color = tmpColor.getHex();
        }
        st.instancedMesh.setColorAt(i, new THREE.Color(color));
      }
      if (st.instancedMesh.instanceColor) {
        st.instancedMesh.instanceColor.needsUpdate = true;
      }

      // selection ring + HTML popover screen anchor (B7)
      const sel = selRef.current;
      const overlay = overlayRef.current;
      if (sel && st.layout.has(sel)) {
        const pos = st.layout.get(sel)!;
        st.selectionRing.position.set(pos.x, 1, pos.z);
        st.selectionRing.visible = true;
        if (overlay) {
          projVec.set(pos.x, FACTORY_H + 140, pos.z).project(st.camera);
          const w = renderer.domElement.clientWidth;
          const hgt = renderer.domElement.clientHeight;
          const sx = (projVec.x * 0.5 + 0.5) * w;
          const sy = (-projVec.y * 0.5 + 0.5) * hgt;
          if (projVec.z < 1) {
            overlay.style.display = "block";
            overlay.style.transform = `translate(-50%, -100%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
          } else {
            overlay.style.display = "none";
          }
        }
      } else {
        st.selectionRing.visible = false;
        if (overlay) overlay.style.display = "none";
      }

      st.controls.update();
      renderer.render(scene, camera);
    };
    rafId = requestAnimationFrame(loop);

    // === Cleanup ===
    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      // B8: remember the L0 camera pose so returning from a drill restores it.
      useViewMode.getState().setParkCamera({
        posX: camera.position.x,
        posY: camera.position.y,
        posZ: camera.position.z,
        targetX: controls.target.x,
        targetY: controls.target.y,
        targetZ: controls.target.z,
        zoom: camera.zoom,
      });
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) obj.geometry.dispose();
        const m = (obj as THREE.Mesh | THREE.Line).material;
        if (!m) return;
        const mats = Array.isArray(m) ? m : [m];
        for (const mat of mats) {
          if (mat instanceof THREE.Material) mat.dispose();
        }
      });
      factoryGeo.dispose();
      factoryMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      parkRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === Data-sync effect: factories change -> update layout + instanceMatrix + billboards ===
  useEffect(() => {
    const st = parkRef.current;
    if (!st) return;

    // 1. compute layout
    const layout = parkLayout(factories);
    st.layout = layout;
    st.idByIndex = factories.map((f) => f.id);

    // 2. update InstancedMesh matrices
    const dummy = st.dummy;
    for (let i = 0; i < factories.length; i++) {
      const f = factories[i]!;
      const pos = layout.get(f.id) ?? { x: 0, z: 0 };
      dummy.position.set(pos.x, FACTORY_H / 2, pos.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      st.instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    // hide unused instances (scale to 0)
    for (let i = factories.length; i < MAX_FACTORIES; i++) {
      dummy.position.set(0, -10000, 0);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      st.instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    st.instancedMesh.instanceMatrix.needsUpdate = true;
    st.instancedMesh.count = Math.max(factories.length, 1);

    // 3. rebuild billboards (category label + pending review badge)
    for (const child of [...st.billboardGroup.children]) {
      const sprite = child as THREE.Sprite;
      if (sprite.isSprite) {
        (sprite.material as THREE.SpriteMaterial).map?.dispose();
        (sprite.material as THREE.Material).dispose();
      }
      st.billboardGroup.remove(child);
    }

    for (const f of factories) {
      const pos = layout.get(f.id) ?? { x: 0, z: 0 };

      const catColor = categoryColor(f.category);
      const labelTex = makeTextTexture(f.name, `#${catColor.toString(16).padStart(6, "0")}`, 42);
      const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
      const labelSprite = new THREE.Sprite(labelMat);
      labelSprite.position.set(pos.x, FACTORY_H + 60, pos.z);
      labelSprite.scale.set(300, 80, 1);
      st.billboardGroup.add(labelSprite);

      if (f.pendingReview > 0) {
        const badgeTex = makeBadgeTexture(f.pendingReview);
        const badgeMat = new THREE.SpriteMaterial({ map: badgeTex, transparent: true, depthTest: false });
        const badgeSprite = new THREE.Sprite(badgeMat);
        badgeSprite.position.set(pos.x + FACTORY_SIZE * 0.6, FACTORY_H + 50, pos.z);
        badgeSprite.scale.set(70, 70, 1);
        st.billboardGroup.add(badgeSprite);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories]);

  // Drop the selection if its factory disappeared.
  useEffect(() => {
    if (selId && !factories.some((f) => f.id === selId)) setSelId(null);
  }, [factories, selId]);

  return (
    <div className="canvas-park" style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={mountRef} className="canvas-park__mount" style={{ width: "100%", height: "100%" }} />
      {factories.length === 0 && <div className="canvas-park__empty">{t("park:empty")}</div>}
      <div ref={overlayRef} className="park-popover" style={{ display: "none", position: "absolute", top: 0, left: 0 }}>
        {selected && (
          <>
            <div className="park-popover__name">{selected.name}</div>
            <div className="park-popover__actions">
              <button type="button" className="park-popover__btn" onClick={() => onEnter?.(selected.id)}>
                {t("park:enter")}
              </button>
              {selected.status === "failed" && (
                <button
                  type="button"
                  className="park-popover__btn"
                  onClick={() => onRetry?.(selected.id, selected.lastRunId)}
                >
                  {t("park:retry")}
                </button>
              )}
              {selected.hasCron && (
                <button
                  type="button"
                  className="park-popover__btn"
                  onClick={() => onToggleCron?.(selected.id)}
                >
                  {t("park:pauseCron")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
