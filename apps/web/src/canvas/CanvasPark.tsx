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
import { xzPolyline, xzPolylinePointAt, type XZPolyline } from "./iso3d";
import { createParkCoordScheduler } from "./parkCoordScheduler";
import { useViewMode } from "../store/view-mode";
import { api } from "../lib/api";
import type { CrossGraphEdge, ParkGraphMetrics } from "../lib/api";
import FactoryReviewCard from "./FactoryReviewCard";

// --- Constants (aligned with L1 Canvas3D, larger park scale) ---
const PITCH = Math.PI / 3; // lock pitch 60deg from vertical
const YAW = (5 * Math.PI) / 4; // classic RTS left-rear view
const CAMERA_DIST = 3000; // park scale, L1 is 1200
const FACTORY_SIZE = 200; // three geometry size (layout constants live in core/parkLayout.ts)
const FACTORY_H = 140;
const MAX_FACTORIES = 100;
const GROUND_SIZE = 6000;
const BREATH_SPEED = 0.006; // B6: running factory breathing frequency
// C3 plan-B drill return (L1 → L0): ease duration and the zoomed-in seed mul.
const DRILL_EASE_MS = 420;
const DRILL_START_ZOOM_MUL = 2.6;

/** easeOutCubic: fast out of the zoomed-in seed, gentle settle at the park pose. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// --- C2: cross-factory freight (park-scale pipes + evenly-phased trucks) ---
const CROSS_PIPE_Y = 6; // raise pipes just above the ground grid to avoid z-fighting
// Pipes arch OVER the factories (FACTORY_H = 140) so a top-down isometric view is
// never occluded by a box sitting between the two endpoints.
const CROSS_PIPE_ARCH = 230; // midpoint lift above CROSS_PIPE_Y (apex ≈ 236 > factory roof)
const CROSS_PIPE_SEGMENTS = 24; // polyline samples approximating the parabolic arch
const CROSS_TRUCK_SPEED = 260; // world units travelled per second along a pipe
const CROSS_TRUCKS_PER_EDGE = 3; // trucks per edge, evenly phased → regular pulse
const CROSS_TRUCK_W = 42;
const CROSS_TRUCK_H = 28;
const CROSS_TRUCK_D = 30;
// subprocess edges are warm amber (matches L1 packet trucks); event edges cyan.
const CROSS_VIA_COLOR = { subprocess: 0xffb020, event: 0x22d3ee } as const;
// Was 0.32 — too faint against the dark park and hidden behind factory boxes;
// combined with the overhead arch, 0.55 reads clearly without overpowering.
const CROSS_PIPE_OPACITY = 0.55;

/** A truck looping along one cross-factory pipe. */
interface CrossTruck {
  line: XZPolyline;
  mesh: THREE.Mesh;
  /** 0..1 head-start along the pipe, evenly spacing the trucks of one edge. */
  phase: number;
}

// --- Color constants (mirror CSS tokens for Canvas 2D use) ---
const COLOR_ALERT = "#ff4a3d"; // pending-review badge bg (CSS: --alert)
const COLOR_INK = "#e8f0f4"; // badge text (CSS: --ink)

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
  /** RTS stage-C C7: current cron enabled flag (drives pause vs resume label). */
  cronEnabled?: boolean;
  /** RTS stage-C C5: nearest cron fire within 24h (ms epoch), null/undefined when none. */
  nextRunAt?: number | null;
  /** RTS stage-C C6: F6 effect metrics (heat sprite hidden when all zero). */
  metrics?: ParkGraphMetrics;
  /** Last run id, used by the retry action. */
  lastRunId?: string | null;
  manual?: { x: number; z: number }; // manual coordinates take priority
}

/**
 * RTS stage-C C6: one-line heat label for a factory, or null when there is no
 * effect data (staging mostly has none — the honest empty state renders nothing).
 * Exported for unit testing (no three.js dependency).
 */
export function formatHeat(m: ParkGraphMetrics | undefined): string | null {
  if (!m) return null;
  const hasSignal = m.impressions + m.clicks + m.conversions + m.gmv + m.adSpend > 0;
  if (!hasSignal) return null;
  const parts: string[] = [];
  if (m.impressions > 0 && m.clicks > 0) {
    const ctr = (m.clicks / m.impressions) * 100;
    parts.push(`CTR ${ctr >= 10 ? ctr.toFixed(0) : ctr.toFixed(1)}%`);
  }
  if (m.gmv > 0) parts.push(`$${m.gmv >= 1000 ? `${(m.gmv / 1000).toFixed(1)}k` : m.gmv.toFixed(0)}`);
  // ROI only when both numerator and denominator are real: with no ad spend
  // (staging default) the ratio is meaningless and must stay hidden, not show ∞.
  if (m.gmv > 0 && m.adSpend > 0) {
    const roi = m.gmv / m.adSpend;
    parts.push(`ROI ${roi >= 100 ? roi.toFixed(0) : roi.toFixed(1)}×`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** RTS stage-C C5: compact countdown label for the next cron fire (exported for tests). */
export function formatCountdown(target: number, now: number): string | null {
  const mins = Math.round((target - now) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${hrs >= 10 ? hrs.toFixed(0) : hrs.toFixed(1)}h`;
  return null;
}

/**
 * RTS stage-C polish: height of the cross-factory pipe arch at parameter t.
 * A parabola 4t(1−t) is 0 at both endpoints and peaks (1×archH) at t = 0.5,
 * so a pipe clears every factory between its endpoints (exported for tests).
 */
export function crossArchY(t: number, baseY: number, archH: number): number {
  const k = Math.max(0, Math.min(1, t));
  return baseY + archH * 4 * k * (1 - k);
}

/** Sample the overhead parabolic arch from one factory footprint to another. */
export function crossArchPoints(
  from: { x: number; z: number },
  to: { x: number; z: number },
  segments: number,
  baseY: number,
  archH: number,
): Array<{ x: number; y: number; z: number }> {
  const n = Math.max(2, Math.floor(segments));
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({
      x: from.x + (to.x - from.x) * t,
      y: crossArchY(t, baseY, archH),
      z: from.z + (to.z - from.z) * t,
    });
  }
  return out;
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
  // RTS stage-C: one billboard group per factory (label + badge + clock + heat),
  // so drag-to-move only repositions a single group instead of hand-counting sprites.
  billboardById: Map<string, THREE.Group>;
  dummy: THREE.Object3D; // reused object, avoids per-frame allocation
  // C2: cross-factory pipes + looping freight trucks
  crossGroup: THREE.Group;
  crossTrucks: CrossTruck[];
  crossTruckGeo: THREE.BoxGeometry;
  crossMats: Record<CrossGraphEdge["via"], THREE.MeshLambertMaterial>;
}

// --- Status colors (brighter for dark park background) ---
const STATUS_COLORS: Record<FactoryStatus, number> = {
  running: 0x4ade80, // green (breathing animation)
  done: 0x60a5fa, // blue
  failed: 0xef4444, // bright red
  halted: 0xf59e0b, // amber
  idle: 0x94a3b8, // brighter slate gray
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
  const padX = 24;
  const padY = 12;
  canvas.width = Math.ceil(metrics.width) + padX * 2;
  canvas.height = fontSize + padY * 2;

  // Semi-transparent dark background pill
  ctx.fillStyle = "rgba(20, 24, 29, 0.85)";
  ctx.beginPath();
  const radius = canvas.height / 2;
  ctx.roundRect(0, 0, canvas.width, canvas.height, radius);
  ctx.fill();

  // Text with subtle shadow for readability
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 4;
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
  ctx.fillStyle = COLOR_ALERT;
  ctx.fill();
  ctx.fillStyle = COLOR_INK;
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// RTS stage-C C5: small cyan countdown disc for the next cron fire (e.g. "3h").
function makeClockTexture(label: string): THREE.CanvasTexture {
  const cacheKey = `clock|${label}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20, 24, 29, 0.85)";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#22d3ee";
  ctx.stroke();
  ctx.fillStyle = "#a5f3fc";
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  textureCache.set(cacheKey, tex);
  return tex;
}

// RTS stage-C C6: warm pill carrying the one-line effect heat (CTR / GMV).
function makeHeatTexture(text: string): THREE.CanvasTexture {
  const cacheKey = `heat|${text}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const font = "bold 34px sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  const h = 56;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, h / 2);
  ctx.fillStyle = "rgba(60, 42, 12, 0.88)";
  ctx.fill();
  ctx.fillStyle = "#fbbf24";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  textureCache.set(cacheKey, tex);
  return tex;
}

export default function CanvasPark({
  factories,
  crossEdges,
  onEnter,
  onRetry,
  onToggleCron,
  onReviewDecided,
}: {
  factories: ParkFactory[];
  /** C2: material-flow edges between factories (subprocess / event). */
  crossEdges?: CrossGraphEdge[];
  onEnter?: (id: string) => void;
  onRetry?: (id: string, lastRunId: string | null | undefined) => void;
  onToggleCron?: (id: string) => void;
  /** C7: after an approve/reject, parent refreshes the overview (badge + status). */
  onReviewDecided?: () => void;
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

  // B1 drag-to-reposition: manual position overrides (id → {x,z}), persists across re-renders.
  const overridesRef = useRef(new Map<string, { x: number; z: number }>());
  // Bump to re-run the data-sync effect after a drag ends (overridesRef is a ref, not reactive).
  const [overrideVersion, setOverrideVersion] = useState(0);
  // Drag state: which factory is being dragged (null = not dragging).
  const dragRef = useRef<{ id: string | null }>({ id: null });

  // B5 debug overlay: FPS counter + render stats, toggle via ?debug=1 or ⌘⇧D.
  const [debugEnabled, setDebugEnabled] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1",
  );
  const debugRef = useRef({ fps: 0, frames: 0, lastTime: 0, drawCalls: 0 });
  const [debugStats, setDebugStats] = useState({ fps: 0, drawCalls: 0, factories: 0, zoom: 1 });

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
    // C3 plan-B: on a drill "out" return, seed the camera closer and ease the
    // zoom back to the saved park pose (position/target restore immediately so
    // the park stays centered; only zoom animates — reads as "pull back out").
    const saved = useViewMode.getState().parkCamera;
    let drillAnim: { startZoom: number; targetZoom: number; start: number } | null = null;
    const drillReq = useViewMode.getState().consumeDrillAnimRequest();
    if (saved) {
      camera.position.set(saved.posX, saved.posY, saved.posZ);
      controls.target.set(saved.targetX, saved.targetY, saved.targetZ);
      camera.zoom = saved.zoom;
      if (drillReq?.dir === "out") {
        const targetZoom = saved.zoom;
        camera.zoom = targetZoom * DRILL_START_ZOOM_MUL;
        drillAnim = { startZoom: camera.zoom, targetZoom, start: performance.now() };
      }
    }
    camera.updateProjectionMatrix();
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
    // C2: cross-factory pipes + trucks, rebuilt by the data-sync effect
    const crossGroup = new THREE.Group();
    scene.add(factoryGroup, billboardGroup, crossGroup);

    // Shared truck geometry / materials (reused across all cross edges).
    const crossTruckGeo = new THREE.BoxGeometry(CROSS_TRUCK_W, CROSS_TRUCK_H, CROSS_TRUCK_D);
    const crossMats: Record<CrossGraphEdge["via"], THREE.MeshLambertMaterial> = {
      subprocess: new THREE.MeshLambertMaterial({ color: CROSS_VIA_COLOR.subprocess }),
      event: new THREE.MeshLambertMaterial({ color: CROSS_VIA_COLOR.event }),
    };

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
      billboardById: new Map(),
      dummy: new THREE.Object3D(),
      crossGroup,
      crossTrucks: [],
      crossTruckGeo,
      crossMats,
    };
    parkRef.current = state;

    // === Raycast selection (InstancedMesh + instanceId) ===
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const projVec = new THREE.Vector3();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const groundHit = new THREE.Vector3();
    let downX = 0;
    let downY = 0;

    // Helper: raycast from pointer event to the instanced mesh, return factory id or null.
    const pickFactory = (e: PointerEvent): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(instancedMesh);
      if (hits.length > 0 && hits[0]!.instanceId != null) {
        return state.idByIndex[hits[0]!.instanceId] ?? null;
      }
      return null;
    };

    // Helper: raycast from pointer to the y=0 ground plane, return {x, z} or null.
    const pickGround = (e: PointerEvent): { x: number; z: number } | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(groundPlane, groundHit)) {
        return { x: groundHit.x, z: groundHit.z };
      }
      return null;
    };

    // Helper: move a single factory instance + its layout entry to (x, z).
    const moveFactory = (id: string, x: number, z: number) => {
      const idx = state.idByIndex.indexOf(id);
      if (idx < 0) return;
      state.layout.set(id, { x, z });
      state.dummy.position.set(x, FACTORY_H / 2, z);
      state.dummy.rotation.set(0, 0, 0);
      state.dummy.scale.set(1, 1, 1);
      state.dummy.updateMatrix();
      state.instancedMesh.setMatrixAt(idx, state.dummy.matrix);
      state.instancedMesh.instanceMatrix.needsUpdate = true;
      // Move the factory's whole billboard group (label + badge + clock + heat).
      state.billboardById.get(id)?.position.set(x, 0, z);
    };

    // Per-factory debounced persistence: moving one factory must not cancel
    // another factory's pending save. flush() on unmount keeps the last drag.
    const parkCoordScheduler = createParkCoordScheduler((id, x, z) =>
      api.putParkCoord(id, x, z),
    );

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // pointer capture may fail on some browsers; non-fatal
      }
      downX = e.clientX;
      downY = e.clientY;
      // Check if we hit a factory — if so, prepare for drag (actual drag starts on move).
      const hit = pickFactory(e);
      if (hit) {
        dragRef.current.id = hit;
        setSelId(hit);
      } else {
        dragRef.current.id = null;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const id = dragRef.current.id;
      if (!id) return; // not dragging a factory
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 4;
      if (!moved) return; // still a click, not a drag
      // Disable orbit controls so camera doesn't pan while dragging.
      controls.enabled = false;
      const pos = pickGround(e);
      if (pos) moveFactory(id, pos.x, pos.z);
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
      const id = dragRef.current.id;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 4;

      if (id && moved) {
        // Drag ended: save override, re-enable controls, debounce PUT.
        const pos = pickGround(e);
        if (pos) {
          moveFactory(id, pos.x, pos.z);
          overridesRef.current.set(id, pos);
          setOverrideVersion((v) => v + 1);
          // Debounced per-factory persist to backend.
          parkCoordScheduler.schedule(id, pos.x, pos.z);
        }
        controls.enabled = true;
        dragRef.current.id = null;
        return;
      }

      // Not a drag — treat as click selection (existing behavior).
      controls.enabled = true;
      dragRef.current.id = null;
      if (moved) return; // camera pan, do not select
      const hit = pickFactory(e);
      if (hit) {
        setSelId(hit);
      } else {
        setSelId(null);
      }
    };

    const onPointerCancel = () => {
      controls.enabled = true;
      dragRef.current.id = null;
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);

    // === rAF loop: read dataRef every frame for colors, ring and popover anchor ===
    let rafId = 0;
    const tmpColor = new THREE.Color();
    let fpsFrames = 0;
    let fpsLastTime = performance.now();
    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const st = parkRef.current;
      if (!st) return;

      // B5: FPS tracking (sliding 1s window)
      fpsFrames++;
      if (now - fpsLastTime >= 1000) {
        const fps = Math.round((fpsFrames * 1000) / (now - fpsLastTime));
        fpsFrames = 0;
        fpsLastTime = now;
        if (debugRef.current.fps !== fps || debugRef.current.drawCalls !== renderer.info.render.calls) {
          debugRef.current.fps = fps;
          debugRef.current.drawCalls = renderer.info.render.calls;
          setDebugStats({
            fps,
            drawCalls: renderer.info.render.calls,
            factories: dataRef.current.length,
            zoom: st.camera.zoom,
          });
        }
      }

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

      // C2: advance cross-factory trucks along their pipes (evenly phased pulse loop)
      for (const ct of st.crossTrucks) {
        const travelled =
          ((now / 1000) * CROSS_TRUCK_SPEED + ct.phase * ct.line.total) % ct.line.total;
        const at = xzPolylinePointAt(ct.line, travelled);
        // Follow the overhead parabola: a single-segment edge means travelled/total
        // is exactly the arch parameter t (xz stays a straight line below).
        const t = ct.line.total > 0 ? travelled / ct.line.total : 0;
        ct.mesh.position.set(
          at.x,
          crossArchY(t, CROSS_PIPE_Y, CROSS_PIPE_ARCH) + CROSS_TRUCK_H / 2,
          at.z,
        );
        ct.mesh.rotation.y = at.angle;
      }

      // C3 plan-B: ease the drill-return zoom from its zoomed-in seed to park pose.
      if (drillAnim) {
        const p = Math.min(1, (now - drillAnim.start) / DRILL_EASE_MS);
        const k = easeOutCubic(p);
        camera.zoom = drillAnim.startZoom + (drillAnim.targetZoom - drillAnim.startZoom) * k;
        camera.updateProjectionMatrix();
        if (p >= 1) drillAnim = null;
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
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      // Send any debounced park-coord saves instead of dropping them on unmount.
      parkCoordScheduler.flush();
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
      crossTruckGeo.dispose();
      crossMats.subprocess.dispose();
      crossMats.event.dispose();
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

    // 1. compute layout, then apply manual drag overrides (B1 persistence)
    const layout = parkLayout(factories);
    for (const [id, pos] of overridesRef.current) {
      if (factories.some((f) => f.id === id)) layout.set(id, pos);
    }
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

    // 3. rebuild billboards: one group per factory holding its label, review
    //    badge, C5 cron countdown clock and C6 effect-heat pill.
    for (const child of [...st.billboardGroup.children]) {
      child.traverse((obj) => {
        const sprite = obj as THREE.Sprite;
        if (sprite.isSprite) {
          (sprite.material as THREE.SpriteMaterial).map?.dispose();
          (sprite.material as THREE.Material).dispose();
        }
      });
      st.billboardGroup.remove(child);
    }
    st.billboardById.clear();
    const syncNow = Date.now();

    for (const f of factories) {
      const pos = layout.get(f.id) ?? { x: 0, z: 0 };
      const group = new THREE.Group();
      group.position.set(pos.x, 0, pos.z);

      const catColor = categoryColor(f.category);
      const labelTex = makeTextTexture(f.name, `#${catColor.toString(16).padStart(6, "0")}`, 52);
      const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
      const labelSprite = new THREE.Sprite(labelMat);
      labelSprite.position.set(0, FACTORY_H + 70, 0);
      labelSprite.scale.set(380, 100, 1);
      group.add(labelSprite);

      if (f.pendingReview > 0) {
        const badgeTex = makeBadgeTexture(f.pendingReview);
        const badgeMat = new THREE.SpriteMaterial({ map: badgeTex, transparent: true, depthTest: false });
        const badgeSprite = new THREE.Sprite(badgeMat);
        badgeSprite.position.set(FACTORY_SIZE * 0.6, FACTORY_H + 50, 0);
        badgeSprite.scale.set(70, 70, 1);
        group.add(badgeSprite);
      }

      // C5: cron countdown disc at the factory base (only within the next 24h).
      if (typeof f.nextRunAt === "number") {
        const countdown = formatCountdown(f.nextRunAt, syncNow);
        if (countdown) {
          const clockTex = makeClockTexture(countdown);
          const clockMat = new THREE.SpriteMaterial({ map: clockTex, transparent: true, depthTest: false });
          const clockSprite = new THREE.Sprite(clockMat);
          clockSprite.position.set(0, 26, FACTORY_SIZE * 0.62);
          clockSprite.scale.set(84, 84, 1);
          group.add(clockSprite);
        }
      }

      // C6: effect heat pill — rendered only when real effect data exists.
      const heat = formatHeat(f.metrics);
      if (heat) {
        const heatTex = makeHeatTexture(heat);
        const heatMat = new THREE.SpriteMaterial({ map: heatTex, transparent: true, depthTest: false });
        const heatSprite = new THREE.Sprite(heatMat);
        const hw = heatTex.image?.width ?? 120;
        heatSprite.position.set(0, FACTORY_H + 6, 0);
        heatSprite.scale.set(Math.max(120, hw * 1.4), 56, 1);
        group.add(heatSprite);
      }

      st.billboardGroup.add(group);
      st.billboardById.set(f.id, group);
    }

    // 4. C2: rebuild cross-factory pipes + evenly-phased freight trucks.
    //    An edge is drawn only when both endpoint factories are laid out.
    for (const child of [...st.crossGroup.children]) {
      // Trucks share crossTruckGeo/crossMats (disposed once on unmount); only the
      // per-edge pipe Line owns geometry/material that must be released on rebuild.
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      st.crossGroup.remove(child);
    }
    st.crossTrucks = [];
    for (const edge of crossEdges ?? []) {
      const from = layout.get(edge.fromGraphId);
      const to = layout.get(edge.toGraphId);
      if (!from || !to) continue;
      const line = xzPolyline([
        { x: from.x, z: from.z },
        { x: to.x, z: to.z },
      ]);
      const color = CROSS_VIA_COLOR[edge.via];
      const arch = crossArchPoints(
        { x: from.x, z: from.z },
        { x: to.x, z: to.z },
        CROSS_PIPE_SEGMENTS,
        CROSS_PIPE_Y,
        CROSS_PIPE_ARCH,
      );
      const pipeGeo = new THREE.BufferGeometry().setFromPoints(
        arch.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      );
      const pipeMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: CROSS_PIPE_OPACITY,
      });
      st.crossGroup.add(new THREE.Line(pipeGeo, pipeMat));
      for (let k = 0; k < CROSS_TRUCKS_PER_EDGE; k++) {
        const mesh = new THREE.Mesh(st.crossTruckGeo, st.crossMats[edge.via]);
        const phase = CROSS_TRUCKS_PER_EDGE > 1 ? k / CROSS_TRUCKS_PER_EDGE : 0;
        st.crossGroup.add(mesh);
        st.crossTrucks.push({ line, mesh, phase });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories, overrideVersion, crossEdges]);

  // Drop the selection if its factory disappeared.
  useEffect(() => {
    if (selId && !factories.some((f) => f.id === selId)) setSelId(null);
  }, [factories, selId]);

  // B5: toggle debug overlay with ⌘⇧D (Ctrl+Shift+D on non-Mac).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setDebugEnabled((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="canvas-park" style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={mountRef} className="canvas-park__mount" style={{ width: "100%", height: "100%" }} />
      {factories.length === 0 && <div className="canvas-park__empty">{t("park:empty")}</div>}
      {debugEnabled && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 1000,
            background: "rgba(0,0,0,0.75)",
            color: "var(--ok)",
            fontFamily: "var(--mono)",
            fontSize: 12,
            padding: "8px 12px",
            borderRadius: 6,
            lineHeight: 1.6,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          <div>{t("park:debug.fps")}: {debugStats.fps}</div>
          <div>{t("park:debug.factories")}: {debugStats.factories}</div>
          <div>{t("park:debug.drawCalls")}: {debugStats.drawCalls}</div>
          <div>{t("park:debug.zoom")}: {debugStats.zoom.toFixed(2)}</div>
          <div style={{ color: "var(--ink-faint)", marginTop: 4 }}>{t("park:debug.toggleHint")}</div>
        </div>
      )}
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
                  {selected.cronEnabled === false ? t("park:resumeCron") : t("park:pauseCron")}
                </button>
              )}
            </div>
            {selected.pendingReview > 0 && (
              <FactoryReviewCard key={selected.id} graphId={selected.id} onDecided={onReviewDecided} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
