/**
 * CanvasPark — RTS Stage B technical research prototype (L0 macro sandbox)
 *
 * Status: technical research spike, validates key technical risks with mock data, no business logic.
 * See docs/design-rts-stage-b.md for production implementation (B1-B9 step-by-step).
 *
 * Validated:
 * 1. InstancedMesh low-poly factories (N factories one draw call)
 * 2. InstancedMesh raycast + instanceId mapping
 * 3. per-instance color update every frame (status breathing animation)
 * 4. Sprite billboard (category label + pending review badge, always faces camera)
 * 5. mount-once + data-sync dual effect (parks change does not rebuild renderer)
 * 6. parkLayout pure function auto-layout (category clustering + no overlap)
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { parkLayout } from "@agent-world/core";

// --- Constants (aligned with L1 Canvas3D, larger park scale) ---
const PITCH = Math.PI / 3; // lock pitch 60deg from vertical
const YAW = (5 * Math.PI) / 4; // classic RTS left-rear view
const CAMERA_DIST = 3000; // park scale, L1 is 1200
const FACTORY_SIZE = 200; // three geometry size (layout constants live in core/parkLayout.ts)
const FACTORY_H = 140;
const MAX_FACTORIES = 100;
const GROUND_SIZE = 6000;

// --- Types ---
export type FactoryStatus = "running" | "done" | "failed" | "halted" | "idle";

export interface ParkFactory {
  id: string;
  name: string;
  category: string;
  status: FactoryStatus;
  pendingReview: number;
  manual?: { x: number; z: number }; // manual coordinates take priority
}

interface ParkSceneState {
  factoryGroup: THREE.Group;
  instancedMesh: THREE.InstancedMesh;
  billboardGroup: THREE.Group;
  selectionRing: THREE.Mesh;
  layout: Map<string, { x: number; z: number }>;
  idByIndex: string[]; // instanceId to graphId mapping
  selectedId: string | null;
  prevSel: string | null;
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

// Category colors (6 factory categories, low-poly palette)
const CATEGORY_COLORS: Record<string, number> = {
  text: 0x818cf8,
  image: 0xf472b6,
  video: 0xfb923c,
  document: 0x34d399,
  ecommerce: 0x22d3ee,
  research: 0xa78bfa,
  uncategorized: 0x94a3b8,
};

function categoryColor(cat: string): number {
  return CATEGORY_COLORS[cat] ?? 0x94a3b8;
}

// --- parkLayout pure function moved to packages/core/src/parkLayout.ts (B2 formalization) ---
// CanvasPark imports from @agent-world/core to avoid duplicate logic drift.

// --- Sprite text texture generation (cached per category) ---
const textureCache = new Map<string, THREE.CanvasTexture>();

function makeTextTexture(text: string, color: string, fontSize = 48): THREE.CanvasTexture {
  const cacheKey = `${text}|${color}|${fontSize}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
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
  const ctx = canvas.getContext("2d")!;
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
  onSelect,
  selectedId,
}: {
  factories: ParkFactory[];
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const parkRef = useRef<ParkSceneState | null>(null);
  // live data ref: rAF reads every frame, does not trigger React re-render
  const dataRef = useRef(factories);
  dataRef.current = factories;
  const selectedRef = useRef(selectedId ?? null);
  selectedRef.current = selectedId ?? null;

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
      camera.updateProjectionMatrix();
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
      layout: new Map(),
      idByIndex: [],
      selectedId: null,
      prevSel: null,
      dummy: new THREE.Object3D(),
    };
    parkRef.current = state;

    // === Raycast selection (InstancedMesh + instanceId) ===
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
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
        if (id) onSelect?.(id);
      } else {
        onSelect?.(null);
      }
    };

    const onPointerCancel = () => {};
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);

    // === rAF loop: read dataRef every frame to update colors + badges + selection ring ===
    let rafId = 0;
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
          const t = 0.5 + 0.4 * Math.sin(now * 0.004);
          const c = new THREE.Color(color);
          c.multiplyScalar(0.6 + t * 0.6);
          color = c.getHex();
        }
        st.instancedMesh.setColorAt(i, new THREE.Color(color));
      }
      if (st.instancedMesh.instanceColor) {
        st.instancedMesh.instanceColor.needsUpdate = true;
      }

      const sel = selectedRef.current;
      if (sel && st.layout.has(sel)) {
        const pos = st.layout.get(sel)!;
        st.selectionRing.position.set(pos.x, 1, pos.z);
        st.selectionRing.visible = true;
      } else {
        st.selectionRing.visible = false;
      }

      controls.update();
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
    // clear old billboards
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

    // 4. reset selection highlight
    st.prevSel = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories]);

  return <div ref={mountRef} className="canvas-park" style={{ width: "100%", height: "100%" }} />;
}
