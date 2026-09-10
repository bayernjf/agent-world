import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ARTIFACT_COLORS } from "@agent-world/core";
import { useGraph } from "../store/graph";
import { PLANT_H, PLANT_W } from "../store/graph";
import { MAX_ZOOM, MIN_ZOOM, useCanvas } from "../store/canvas";
import { useViewMode } from "../store/view-mode";
import { useVisibleRuntime } from "../store/run";
import { boardToWorld, worldToBoard, viewportCenterToWorld, xzPolyline, xzPolylinePointAt, zoomToFrustum, type XZPolyline } from "./iso3d";
import { VIEW_H, VIEW_W } from "./board";
import {
  buildNodeShape,
  NODE_HEIGHT,
  NODE_ROTATION,
  PIPE_RADIUS,
  PIPE_Y,
  SELECT_COLOR,
  setGroupEmissive,
  statusLedColor,
  type NodeShape,
} from "./iso3d-shapes";
import { edgeAnchors, orthoCrossings, orthogonalRoute, ROUTE_PAD, type Point } from "./geometry";
import type { GraphNode } from "@agent-world/core";

/** Fixed camera pitch (angle from vertical): locks the isometric tilt.
 *  π/3 ≈ 60° from vertical (30° above the horizon) — a low, side-on RTS angle
 *  so walls and side faces read clearly as 3D volume. */
const PITCH = Math.PI / 3;
/** Horizontal yaw around the target: 225° places the camera in the left-rear
 *  quadrant, looking down toward the right/front — the classic RTS angle. */
const YAW = (5 * Math.PI) / 4;
/** Eye-to-target distance. Controls how much of the scene fills the viewport. */
const CAMERA_DIST = 1200;
/** Freight speed along a pipe, in board/world units per second (matches 2D). */
const SPEED = 340;
/** Height a pipe lifts to arc over another pipe at a crossing. */
const BRIDGE_HEIGHT = 18;

interface EdgePath {
  polyline: XZPolyline;
  color: number;
  rework: boolean;
  mesh: THREE.Mesh;
}

interface Truck {
  mesh: THREE.Mesh;
  polyline: XZPolyline;
  startedAt: number;
}

/**
 * Mutable scene state shared between the mount-once effect (renderer, camera,
 * loop, event listeners) and the graph-sync effect (nodes/edges geometry).
 * Splitting the effects this way means editing the graph rebuilds only the
 * node/edge geometry — never the WebGL renderer, lights, camera or the
 * requestAnimationFrame loop (audit M30, L29).
 */
interface SceneState {
  nodeGroup: THREE.Group;
  edgeGroup: THREE.Group;
  truckGroup: THREE.Group;
  nodeShapes: Map<string, NodeShape>;
  edgePaths: Map<string, EdgePath>;
  nodeById: Map<string, GraphNode>;
  trucks: Truck[];
  truckMats: Map<string, THREE.MeshLambertMaterial>;
  truckGeo: THREE.BoxGeometry;
  seen: Set<string>;
  lastRunId: string | null;
  prevSel: string | null;
}

/** Remove every child mesh of a group, disposing its geometry and materials.
 *  Used when the graph-sync effect rebuilds nodes/edges. */
function disposeGroupChildren(group: THREE.Group) {
  for (const child of [...group.children]) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) continue;
    mesh.geometry.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) {
      for (const mat of m) mat.dispose();
    } else if (m instanceof THREE.Material) {
      m.dispose();
    }
    group.remove(child);
  }
}

// --- Pure geometry helpers (module scope: shared by mount and graph-sync). ---

/** Rotate an anchor around its node's center so it lands on the rotated
 *  node's face (3D blocks are rotated NODE_ROTATION on the ground plane). */
function rotateAnchor(center: { x: number; y: number } | undefined, p: Point): Point {
  if (!center) return p;
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const c = Math.cos(NODE_ROTATION);
  const s = Math.sin(NODE_ROTATION);
  return { x: center.x + dx * c + dy * s, y: center.y - dx * s + dy * c };
}

/** Obstacle rects from the CURRENT node positions (dragging mutates nodeById). */
function buildObstacles(nodeById: Map<string, GraphNode>) {
  return [...nodeById.values()].map((n) => ({
    id: n.id,
    x0: n.x - PLANT_W / 2 - ROUTE_PAD,
    y0: n.y - PLANT_H / 2 - ROUTE_PAD,
    x1: n.x + PLANT_W / 2 + ROUTE_PAD,
    y1: n.y + PLANT_H / 2 + ROUTE_PAD,
  }));
}

/** Anchors recomputed from the live node positions (dragging mutates nodeById),
 *  so pipes always attach to the current node faces. */
function computeAnchors(nodeById: Map<string, GraphNode>) {
  return edgeAnchors({ ...useGraph.getState().graph, nodes: [...nodeById.values()] });
}

function computeRoutes(graph: ReturnType<typeof useGraph.getState>["graph"], nodeById: Map<string, GraphNode>) {
  const anchors = computeAnchors(nodeById);
  const routes = new Map<string, Point[]>();
  for (const e of graph.edges) {
    const a = anchors.get(e.id);
    if (!a) continue;
    const af = rotateAnchor(nodeById.get(e.from), a.from);
    const at = rotateAnchor(nodeById.get(e.to), a.to);
    if (e.kind === "rework") {
      routes.set(e.id, [af, at]);
    } else {
      routes.set(e.id, orthogonalRoute(af, at, buildObstacles(nodeById).filter((o) => o.id !== e.from && o.id !== e.to)));
    }
  }
  return routes;
}

/** Where two forward pipes cross, the vertical one arcs OVER the horizontal
 *  one (same bridge semantics as the 2D canvas). */
function computeBridges(graph: ReturnType<typeof useGraph.getState>["graph"], anchors: Map<string, { from: Point; to: Point }>, routes: Map<string, Point[]>) {
  const bridges = new Map<string, Point[]>();
  for (const c of orthoCrossings(graph, anchors, routes)) {
    const list = bridges.get(c.over) ?? [];
    list.push({ x: c.x, y: c.y });
    bridges.set(c.over, list);
  }
  return bridges;
}

/** Route + tube geometry for one edge. `bridges` are board-space points where
 *  this edge lifts over another pipe. */
function buildTube(route: Point[], bridges: Point[]) {
  const ground = route.map((p) => {
    const w = boardToWorld(p.x, p.y);
    return { x: w.x, z: w.z };
  });
  const pts: { x: number; y: number; z: number }[] = ground.map((p) => ({ ...p, y: PIPE_Y }));
  for (const b of bridges) {
    const bw = boardToWorld(b.x, b.y);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const c = pts[i + 1]!;
      if (a.x !== c.x || Math.abs(a.x - bw.x) > 0.5) continue; // vertical segment only
      const zMin = Math.min(a.z, c.z);
      const zMax = Math.max(a.z, c.z);
      if (bw.z > zMin && bw.z < zMax) {
        pts.splice(i + 1, 0, { x: bw.x, y: PIPE_Y + BRIDGE_HEIGHT, z: bw.z });
        break;
      }
    }
  }
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
  return { points: ground, geometry: new THREE.TubeGeometry(curve, 64, PIPE_RADIUS, 10, false) };
}

/**
 * Read-only 3D display view: renders the same graph the 2D editor shows as
 * programmatic machine blocks (colored by category, silhouetted by kind) and
 * orthogonal pipes on the XZ ground plane. Camera is constrained to a fixed
 * pitch with horizontal rotate and pan only. Live run state drives a status LED
 * on each block and freight trucks along the pipes; clicking a block selects the
 * node and opens the Inspector.
 */
export default function Canvas3D() {
  const graph = useGraph((s) => s.graph);
  const viewport = useCanvas((s) => s.viewport);
  const camera3d = useViewMode((s) => s.camera3d);
  const setCamera3d = useViewMode((s) => s.setCamera3d);
  const select = useGraph((s) => s.select);
  const selectNone = useGraph((s) => s.selectNone);
  const moveNode = useGraph((s) => s.moveNode);
  // Runtime is read per-frame via a ref so the scene isn't rebuilt on every event.
  const runtime = useVisibleRuntime();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);

  // --- Mount-once effect: renderer, camera, lights, ground, loop, events. ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    // Keep the renderer size in sync with the container div.
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      renderer.setSize(width, height);
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);
    // Grab cursor over the canvas: left-drag pans (empty space) or moves a node.
    renderer.domElement.style.cursor = "grab";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14181d);

    const f = zoomToFrustum(viewport.zoom);
    const camera = new THREE.OrthographicCamera(f.left, f.right, f.top, f.bottom, 0.1, 4000);

    const controls = new OrbitControls(camera, renderer.domElement);
    if (camera3d) {
      camera.position.set(camera3d.posX, camera3d.posY, camera3d.posZ);
      controls.target.set(camera3d.targetX, 0, camera3d.targetZ);
    } else {
      // Classic RTS camera: left-rear, low pitch, so roofs and side faces read
      // as 3D volume (Age-of-Empires-style dimetric view).
      const h = CAMERA_DIST * Math.sin(PITCH);
      const y = CAMERA_DIST * Math.cos(PITCH);
      const center = viewportCenterToWorld(viewport);
      camera.position.set(center.x + h * Math.cos(YAW), y, center.z + h * Math.sin(YAW));
      controls.target.set(center.x, 0, center.z);
    }
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    // Left-drag pans the canvas; right-drag is disabled. Rotation stays on the
    // wheel (and touchpad single-finger), pan also on arrow keys below.
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = undefined;
    controls.minPolarAngle = PITCH;
    controls.maxPolarAngle = PITCH;
    controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    // Light from left-rear-above so the top face is bright and the front/back
    // faces fall into shadow, making the block faces read as 3D even in a
    // straight-on horizontal layout.
    dir.position.set(-300, 600, -300);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -900;
    dir.shadow.camera.right = 900;
    dir.shadow.camera.top = 900;
    dir.shadow.camera.bottom = -900;
    dir.shadow.camera.near = 100;
    dir.shadow.camera.far = 2000;
    dir.shadow.bias = -0.0005;
    scene.add(ambient, dir);

    // Ground plane (receives shadows) + reference grid so blocks and pipes sit
    // in space instead of floating on the background.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshLambertMaterial({ color: 0x1c2229 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(3000, 60, 0x2a323b, 0x20262d);
    grid.position.y = 0.5;
    scene.add(grid);

    // Empty groups the graph-sync effect fills in; they exist for the scene's
    // lifetime so graph edits never tear down the renderer (audit M30).
    const nodeGroup = new THREE.Group();
    const edgeGroup = new THREE.Group();
    const truckGroup = new THREE.Group();
    scene.add(nodeGroup);
    scene.add(edgeGroup);
    scene.add(truckGroup);

    const truckGeo = new THREE.BoxGeometry(16, 7, 10);
    const truckMats = new Map<string, THREE.MeshLambertMaterial>();
    const trucks: Truck[] = [];
    const seen = new Set<string>();
    const state: SceneState = {
      nodeGroup,
      edgeGroup,
      truckGroup,
      nodeShapes: new Map<string, NodeShape>(),
      edgePaths: new Map<string, EdgePath>(),
      nodeById: new Map<string, GraphNode>(),
      trucks,
      truckMats,
      truckGeo,
      seen,
      lastRunId: null,
      prevSel: null,
    };
    sceneRef.current = state;

    // --- Raycast selection: click to select + open Inspector, drag to move. ---
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let downX = 0;
    let downY = 0;
    let downHitId: string | null = null;
    let rightDown = false;
    // Drag state: while a node is grabbed we move it live in the scene and
    // commit the final position to the graph store on release.
    let draggingNodeId: string | null = null;
    let dragStartBoard = { x: 0, y: 0 };
    let dragStartWorld = { x: 0, z: 0 };

    const mouseToGround = (e: PointerEvent): { x: number; z: number } | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const out = new THREE.Vector3();
      return raycaster.ray.intersectPlane(groundPlane, out) ? { x: out.x, z: out.z } : null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) {
        rightDown = true;
        return;
      }
      if (e.button !== 0) return;
      // Capture the pointer so pointerup fires even when the cursor leaves the
      // canvas mid-drag; without this a release outside the canvas leaves
      // draggingNodeId + controls.enabled=false behind and freezes the camera
      // (audit M23).
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // Ignore — some environments (jsdom) don't implement pointer capture.
      }
      downX = e.clientX;
      downY = e.clientY;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeGroup.children, true);
      const hit = hits.find((h) => h.object.userData.role !== "led");
      const hitId = hit?.object.userData.nodeId as string | undefined;
      if (hitId) {
        downHitId = hitId;
        select(hitId);
        const node = state.nodeById.get(hitId);
        if (node) {
          draggingNodeId = hitId;
          dragStartBoard = { x: node.x, y: node.y };
          const g = mouseToGround(e);
          if (g) dragStartWorld = g;
          // Left-drag moves the node instead of panning the camera.
          controls.enabled = false;
        }
      } else {
        downHitId = null;
        selectNone();
      }
      renderer.domElement.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingNodeId) return;
      const g = mouseToGround(e);
      if (!g) return;
      const dx = g.x - dragStartWorld.x;
      const dz = g.z - dragStartWorld.z;
      const bx = dragStartBoard.x + dx;
      const by = dragStartBoard.y + dz;
      const w = boardToWorld(bx, by);
      const shape = state.nodeShapes.get(draggingNodeId);
      if (shape) shape.group.position.set(w.x, 0, w.z);
      rebuildEdgesForNode(draggingNodeId, bx, by);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 2) {
        rightDown = false;
        return;
      }
      if (e.button !== 0) return;
      try {
        if (renderer.domElement.hasPointerCapture(e.pointerId)) {
          renderer.domElement.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore — see onPointerDown.
      }
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 4;
      if (draggingNodeId) {
        const shape = state.nodeShapes.get(draggingNodeId);
        if (shape) {
          const b = worldToBoard(shape.group.position.x, shape.group.position.z);
          moveNode(draggingNodeId, b.x, b.y);
        }
        draggingNodeId = null;
        controls.enabled = true;
        // A click (no movement) opens the Inspector panel; a drag must not —
        // same contract as the 2D canvas (Canvas.tsx onPointerUp).
        if (!moved) useGraph.getState().setInspectorOpen(true);
      } else if (downHitId && !moved) {
        useGraph.getState().setInspectorOpen(true);
      }
      renderer.domElement.style.cursor = "grab";
    };
    // If the browser steals the pointer (gesture, blur) mid-drag, reset the
    // drag state instead of leaving the camera disabled (audit M23).
    const onPointerCancel = () => {
      draggingNodeId = null;
      controls.enabled = true;
      renderer.domElement.style.cursor = "grab";
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);

    // Wheel and arrow keys also rotate the view horizontally (zoom stays locked).
    // Touchpad two-finger scroll emits wheel events, so it rotates too.
    const onWheel = (e: WheelEvent) => {
      // Right button held + wheel = horizontal rotate; plain wheel = zoom
      // (OrbitControls handles the dolly now that enableZoom is on).
      if (rightDown) {
        e.preventDefault();
        e.stopImmediatePropagation();
        controls.rotateLeft(e.deltaY * 0.0025);
      }
    };
    const preventContextMenu = (e: Event) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const step = 24;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        controls.pan(0, step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        controls.pan(0, -step);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        controls.pan(step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        controls.pan(-step, 0);
      } else if (e.key === "v" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        useViewMode.getState().toggle();
      }
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false, capture: true });
    renderer.domElement.addEventListener("contextmenu", preventContextMenu);
    window.addEventListener("keydown", onKeyDown);

    // Re-route every edge touching a dragged node and rebuild its tube geometry,
    // so pipes stay attached to the node faces while dragging.
    const rebuildEdgesForNode = (nodeId: string, bx: number, by: number) => {
      const orig = state.nodeById.get(nodeId);
      if (!orig) return;
      state.nodeById.set(nodeId, { ...orig, x: bx, y: by });
      const g = useGraph.getState().graph;
      const liveAnchors = computeAnchors(state.nodeById);
      const liveRoutes = computeRoutes(g, state.nodeById);
      const liveBridges = computeBridges(g, liveAnchors, liveRoutes);
      for (const e of g.edges) {
        if (e.from !== nodeId && e.to !== nodeId) continue;
        const route = liveRoutes.get(e.id);
        const ep = state.edgePaths.get(e.id);
        if (!route || !ep) continue;
        const { points, geometry } = buildTube(route, liveBridges.get(e.id) ?? []);
        ep.polyline = xzPolyline(points);
        ep.mesh.geometry.dispose();
        ep.mesh.geometry = geometry;
      }
    };

    // Fit/reset: center on the graph, restore the default yaw/pitch and zoom, and
    // re-derive the frustum from the 2D viewport zoom (canvas aspect, so plants
    // keep their shape instead of stretching).
    const resetCamera = () => {
      const g = useGraph.getState().graph;
      const xs = g.nodes.map((n) => n.x);
      const ys = g.nodes.map((n) => n.y);
      if (xs.length === 0) return;
      // Extra padding because each node is rotated 22.5°, slightly enlarging its
      // footprint bounding box on the ground plane.
      const PAD = 40;
      const minX = Math.min(...xs) - PLANT_W / 2 - PAD;
      const maxX = Math.max(...xs) + PLANT_W / 2 + PAD;
      const minY = Math.min(...ys) - PLANT_H / 2 - PAD;
      const maxY = Math.max(...ys) + PLANT_H / 2 + PAD;
      const bw = Math.max(maxX - minX, 1);
      const bh = Math.max(maxY - minY, 1);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const wc = boardToWorld(cx, cy);
      controls.target.set(wc.x, 0, wc.z);
      // "Fit" aligns the graph with the 2D layout: choose a yaw that puts the
      // longer edge horizontally, so rows/columns read the same way as on the
      // 2D canvas instead of running diagonally.
      const fitYaw = bw >= bh ? Math.PI / 2 : 0;
      const h = CAMERA_DIST * Math.sin(PITCH);
      const y = CAMERA_DIST * Math.cos(PITCH);
      camera.position.set(wc.x + h * Math.cos(fitYaw), y, wc.z + h * Math.sin(fitYaw));
      // Fit the whole graph (plus padding) into the visible frustum. The frustum
      // stays tied to the 2D viewport.zoom; camera.zoom supplies the rest, so the
      // total scale (viewport.zoom * camera.zoom) equals min(VIEW_W/bw, VIEW_H/bh).
      const f = zoomToFrustum(viewport.zoom);
      camera.left = f.left;
      camera.right = f.right;
      camera.top = f.top;
      camera.bottom = f.bottom;
      const fitZoom = Math.min(VIEW_W / bw, VIEW_H / bh);
      camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitZoom / viewport.zoom));
      camera.updateProjectionMatrix();
      controls.update();
    };

    let rafId = 0;
    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const rt = runtimeRef.current;
      const st = sceneRef.current;
      if (!st) return;

      // Reset freight bookkeeping when a new run takes over.
      if (rt.runId !== st.lastRunId) {
        st.lastRunId = rt.runId;
        st.seen.clear();
        for (const t of st.trucks) st.truckGroup.remove(t.mesh);
        st.trucks.length = 0;
      }

      // Spawn a truck for each newly-seen packet.
      for (const p of rt.packets) {
        const key = `${p.edgeId}:${p.seq}`;
        if (st.seen.has(key)) continue;
        st.seen.add(key);
        const path = st.edgePaths.get(p.edgeId);
        if (!path) continue;
        const color = path.rework ? "#ff9d2e" : p.artifactKind ? ARTIFACT_COLORS[p.artifactKind] : "#ffb020";
        let mat = st.truckMats.get(color);
        if (!mat) {
          mat = new THREE.MeshLambertMaterial({ color });
          st.truckMats.set(color, mat);
        }
        const mesh = new THREE.Mesh(st.truckGeo, mat);
        st.truckGroup.add(mesh);
        st.trucks.push({ mesh, polyline: path.polyline, startedAt: now });
      }

      // Advance/retire trucks along their pipes.
      for (let i = st.trucks.length - 1; i >= 0; i--) {
        const t = st.trucks[i]!;
        const travelled = ((now - t.startedAt) / 1000) * SPEED;
        if (travelled > t.polyline.total) {
          st.truckGroup.remove(t.mesh);
          st.trucks.splice(i, 1);
          continue;
        }
        const at = xzPolylinePointAt(t.polyline, travelled);
        t.mesh.position.set(at.x, PIPE_Y + PIPE_RADIUS + 4, at.z);
        t.mesh.rotation.y = at.angle;
      }

      // Highlight selection — only when it changes (emissive traversals are
      // expensive; audit L30). The graph-sync effect resets prevSel and
      // re-applies the highlight whenever node groups are rebuilt.
      const sel = useGraph.getState().selectedId;
      if (sel !== st.prevSel) {
        if (st.prevSel) {
          const prev = st.nodeShapes.get(st.prevSel);
          if (prev) setGroupEmissive(prev.group, 0x000000);
        }
        if (sel) {
          const next = st.nodeShapes.get(sel);
          if (next) setGroupEmissive(next.group, SELECT_COLOR);
        }
        st.prevSel = sel;
      }

      // Drive status LEDs (cheap per-node color set, needs to run every frame
      // for the breathing animation).
      const haltedId = rt.status === "halted" ? rt.haltedNodeId : undefined;
      for (const [id, shape] of st.nodeShapes) {
        const nodeRt = rt.nodes[id];
        const running = nodeRt?.status === "running";
        const ledColor = statusLedColor(nodeRt?.status, haltedId === id);
        const ledMat = shape.led.material as THREE.MeshLambertMaterial;
        ledMat.color.setHex(ledColor);
        ledMat.emissive.setHex(ledColor);
        ledMat.emissiveIntensity = running ? 0.5 + 0.4 * Math.sin(now * 0.006) : 0.25;
      }

      // Apply minimap-originated move/zoom/reset requests, then publish live state.
      const mr = useViewMode.getState().consumeCamera3dMoveRequest();
      if (mr) {
        // Move target AND position together so the camera offset stays fixed:
        // moving only the target re-aims the camera (rotation), not a pan.
        const dx = mr.x - controls.target.x;
        const dz = mr.z - controls.target.z;
        controls.target.x = mr.x;
        controls.target.z = mr.z;
        camera.position.x += dx;
        camera.position.z += dz;
      }
      const zr = useViewMode.getState().consumeCamera3dZoomRequest();
      if (zr != null) {
        camera.zoom = zr;
        camera.updateProjectionMatrix();
      }
      if (useViewMode.getState().consumeCamera3dResetRequest()) {
        resetCamera();
      }
      useViewMode.getState().setCamera3dZoom(camera.zoom);
      useViewMode.getState().setCamera3dTarget({ x: controls.target.x, z: controls.target.z });

      controls.update();
      renderer.render(scene, camera);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      renderer.domElement.removeEventListener("wheel", onWheel, true);
      renderer.domElement.removeEventListener("contextmenu", preventContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      setCamera3d({
        posX: camera.position.x,
        posY: camera.position.y,
        posZ: camera.position.z,
        targetX: controls.target.x,
        targetZ: controls.target.z,
      });
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) obj.geometry.dispose();
        // Materials on both meshes (incl. multi-material arrays) and lines
        // (e.g. the GridHelper's line materials) — audit L28/L31.
        const m = (obj as THREE.Mesh | THREE.Line).material;
        if (!m) return;
        const mats = Array.isArray(m) ? m : [m];
        for (const mat of mats) {
          if (mat instanceof THREE.Material) mat.dispose();
        }
      });
      // Dispose shared resources created outside the scene graph.
      truckGeo.dispose();
      for (const mat of truckMats.values()) mat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
    // camera3d / viewport are read once at mount; the graph-sync effect below
    // owns everything that follows the graph. Reading them here on every graph
    // edit would restore a stale camera (audit L29).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Graph-sync effect: rebuild node/edge geometry when the graph changes. ---
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;

    // Nodes: dispose old blocks, rebuild shapes from the current graph.
    disposeGroupChildren(st.nodeGroup);
    st.nodeShapes.clear();
    st.nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const n of graph.nodes) {
      const shape = buildNodeShape(n.kind);
      const w = boardToWorld(n.x, n.y);
      shape.group.position.set(w.x, 0, w.z);
      shape.group.userData.nodeId = n.id;
      // Tag every mesh (topper parts included) so raycasts resolve to the node.
      shape.group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.userData.nodeId = n.id;
        if (mesh.userData.role !== "led") {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      st.nodeGroup.add(shape.group);
      st.nodeShapes.set(n.id, shape);
    }

    // Edges: dispose old tubes, re-route + rebuild from the current graph.
    disposeGroupChildren(st.edgeGroup);
    st.edgePaths.clear();
    const anchors = computeAnchors(st.nodeById);
    const routes = computeRoutes(graph, st.nodeById);
    const bridges = computeBridges(graph, anchors, routes);
    for (const e of graph.edges) {
      const route = routes.get(e.id);
      if (!route) continue;
      const { points, geometry } = buildTube(route, bridges.get(e.id) ?? []);
      const color =
        e.kind === "error" ? 0xff5252 : e.kind === "rework" ? 0xff9d2e : 0x8aa6c0;
      const tube = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
      tube.castShadow = true;
      tube.receiveShadow = true;
      st.edgeGroup.add(tube);
      st.edgePaths.set(e.id, { polyline: xzPolyline(points), color, rework: e.kind === "rework", mesh: tube });
    }

    // Routes changed — retire freight and reset bookkeeping.
    for (const t of st.trucks) st.truckGroup.remove(t.mesh);
    st.trucks.length = 0;
    st.seen.clear();
    st.lastRunId = null;

    // The node groups are fresh (default emissive), so re-apply the current
    // selection highlight and let the loop detect future changes.
    st.prevSel = null;
    const sel = useGraph.getState().selectedId;
    if (sel) {
      const shape = st.nodeShapes.get(sel);
      if (shape) setGroupEmissive(shape.group, SELECT_COLOR);
    }
  }, [graph]);

  return <div ref={mountRef} className="canvas3d" style={{ width: "100%", height: "100%" }} />;
}
