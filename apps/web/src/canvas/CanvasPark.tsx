/**
 * CanvasPark — RTS 阶段 B 技术预研原型（L0 宏观沙盘）
 *
 * 状态：技术预研 spike，用 mock 数据验证关键技术风险，不接业务逻辑。
 * 正式落地见 docs/design-rts-stage-b.md（B1-B9 逐步细化）。
 *
 * 验证项：
 * 1. InstancedMesh 低模工厂（N 厂一个 draw call）
 * 2. InstancedMesh raycast + instanceId 映射
 * 3. per-instance color 每帧更新（状态呼吸动画）
 * 4. Sprite billboard（类别标签 + 待审角标，始终面向相机）
 * 5. mount-once + data-sync 双 effect（parks 变更不重建 renderer）
 * 6. parkLayout 纯函数自动布局（类别聚簇 + 无重叠）
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// --- 常量（与 L1 Canvas3D 对齐，园区尺度更大） ---
const PITCH = Math.PI / 3; // 锁俯角 60° from vertical
const YAW = (5 * Math.PI) / 4; // 经典 RTS 左后视角
const CAMERA_DIST = 3000; // 园区尺度，L1 是 1200
const FACTORY_SIZE = 200; // 园区坐标单位
const FACTORY_H = 140;
const MAX_FACTORIES = 100;
const GROUND_SIZE = 6000;

// --- 类型 ---
export type FactoryStatus = "running" | "done" | "failed" | "halted" | "idle";

export interface ParkFactory {
  id: string;
  name: string;
  category: string;
  status: FactoryStatus;
  pendingReview: number;
  manual?: { x: number; z: number }; // 手动坐标优先
}

interface ParkSceneState {
  factoryGroup: THREE.Group;
  instancedMesh: THREE.InstancedMesh;
  billboardGroup: THREE.Group;
  selectionRing: THREE.Mesh;
  layout: Map<string, { x: number; z: number }>;
  idByIndex: string[]; // instanceId → graphId 映射
  selectedId: string | null;
  prevSel: string | null;
  dummy: THREE.Object3D; // 复用对象，避免每帧 new
}

// --- 状态色（复用 L1 语义） ---
const STATUS_COLORS: Record<FactoryStatus, number> = {
  running: 0x4ade80, // 绿
  done: 0x60a5fa, // 蓝
  failed: 0xf87171, // 红
  halted: 0xfbbf24, // 黄
  idle: 0x6b7280, // 灰
};

// 类别色（6 类工厂，低模配色）
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

// --- 纯函数：园区自动布局 v1（类别聚簇 + 无重叠） ---
export function parkLayout(
  factories: ParkFactory[],
): Map<string, { x: number; z: number }> {
  const result = new Map<string, { x: number; z: number }>();
  const occupied = new Set<string>(); // "x,z" 网格占位

  const key = (x: number, z: number) => `${Math.round(x / FACTORY_SIZE)},${Math.round(z / FACTORY_SIZE)}`;
  const isOccupied = (x: number, z: number) => occupied.has(key(x, z));
  const occupy = (x: number, z: number) => occupied.add(key(x, z));

  // 1. 手动坐标先占位
  for (const f of factories) {
    if (f.manual) {
      result.set(f.id, { x: f.manual.x, z: f.manual.z });
      occupy(f.manual.x, f.manual.z);
    }
  }

  // 2. 剩余按 category 分组
  const auto = factories.filter((f) => !f.manual);
  const byCategory = new Map<string, ParkFactory[]>();
  for (const f of auto) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  // 3. 每组排成一行，从中心向外展开
  const categories = [...byCategory.keys()].sort();
  const rowSpacing = FACTORY_SIZE * 2.2;
  const colSpacing = FACTORY_SIZE * 1.6;
  let rowIndex = 0;

  for (const cat of categories) {
    const list = byCategory.get(cat)!;
    const rowZ = (rowIndex - (categories.length - 1) / 2) * rowSpacing;
    const startX = -((list.length - 1) / 2) * colSpacing;

    for (let i = 0; i < list.length; i++) {
      let x = startX + i * colSpacing;
      const z = rowZ;
      // 碰撞检测：如果被手动坐标占了，顺延
      let attempts = 0;
      while (isOccupied(x, z) && attempts < 20) {
        x += colSpacing;
        attempts++;
      }
      result.set(list[i]!.id, { x, z });
      occupy(x, z);
    }
    rowIndex++;
  }

  return result;
}

// --- Sprite 文字纹理生成（缓存同类别的纹理） ---
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

// --- 组件 ---
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
  // 实时数据 ref：rAF 每帧读，不触发 React 重渲染
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

    // 正交相机（同 L1，距离更大）
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

    // 灯光（同 L1，阴影范围更大）
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

    // 地面 + 网格
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

    // 空组：data-sync effect 填充
    const factoryGroup = new THREE.Group();
    const billboardGroup = new THREE.Group();
    scene.add(factoryGroup, billboardGroup);

    // InstancedMesh：N 厂一个 draw call
    const factoryGeo = new THREE.BoxGeometry(FACTORY_SIZE, FACTORY_H, FACTORY_SIZE);
    const factoryMat = new THREE.MeshLambertMaterial();
    const instancedMesh = new THREE.InstancedMesh(factoryGeo, factoryMat, MAX_FACTORIES);
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    factoryGroup.add(instancedMesh);

    // 选中环
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

    // === Raycast 点选（InstancedMesh + instanceId） ===
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom */
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
        /* jsdom */
      }
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 4;
      if (moved) return; // 拖拽平移，不选中

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

    // === rAF 循环：每帧读 dataRef 更新颜色 + 角标 + 选中环 ===
    let rafId = 0;
    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const st = parkRef.current;
      if (!st) return;

      const facts = dataRef.current;
      // per-instance 颜色更新（状态 + running 呼吸）
      for (let i = 0; i < facts.length; i++) {
        const f = facts[i]!;
        let color = STATUS_COLORS[f.status];
        if (f.status === "running") {
          // 呼吸：在基础色和亮色间插值
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

      // 选中环跟随
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

  // === Data-sync effect: factories 变更 → 更新布局 + instanceMatrix + billboards ===
  useEffect(() => {
    const st = parkRef.current;
    if (!st) return;

    // 1. 计算布局
    const layout = parkLayout(factories);
    st.layout = layout;
    st.idByIndex = factories.map((f) => f.id);

    // 2. 更新 InstancedMesh 矩阵
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
    // 隐藏未使用的 instance（缩放到 0）
    for (let i = factories.length; i < MAX_FACTORIES; i++) {
      dummy.position.set(0, -10000, 0);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      st.instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    st.instancedMesh.instanceMatrix.needsUpdate = true;
    st.instancedMesh.count = Math.max(factories.length, 1);

    // 3. 重建 billboards（类别标签 + 待审角标）
    // 清空旧 billboard
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
      // 类别标签
      const catColor = categoryColor(f.category);
      const labelTex = makeTextTexture(f.name, `#${catColor.toString(16).padStart(6, "0")}`, 42);
      const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
      const labelSprite = new THREE.Sprite(labelMat);
      labelSprite.position.set(pos.x, FACTORY_H + 60, pos.z);
      labelSprite.scale.set(300, 80, 1);
      st.billboardGroup.add(labelSprite);

      // 待审角标
      if (f.pendingReview > 0) {
        const badgeTex = makeBadgeTexture(f.pendingReview);
        const badgeMat = new THREE.SpriteMaterial({ map: badgeTex, transparent: true, depthTest: false });
        const badgeSprite = new THREE.Sprite(badgeMat);
        badgeSprite.position.set(pos.x + FACTORY_SIZE * 0.6, FACTORY_H + 50, pos.z);
        badgeSprite.scale.set(70, 70, 1);
        st.billboardGroup.add(badgeSprite);
      }
    }

    // 4. 重置选中高亮
    st.prevSel = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factories]);

  return <div ref={mountRef} className="canvas-park" style={{ width: "100%", height: "100%" }} />;
}
