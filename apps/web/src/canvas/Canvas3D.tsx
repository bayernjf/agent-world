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
import { edgeAnchors, orthogonalRoute, ROUTE_PAD, type Point } from "./geometry";

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

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
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

    // --- Nodes: programmatic shapes, colored by category, silhouette by kind. ---
    const nodeGroup = new THREE.Group();
    const nodeShapes = new Map<string, NodeShape>();
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
      nodeGroup.add(shape.group);
      nodeShapes.set(n.id, shape);
    }
    scene.add(nodeGroup);

    // --- Edges: orthogonal routes (same geometry the 2D canvas draws). ---
    const anchors = edgeAnchors(graph);
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    // Rotate an anchor around its node's center so it lands on the rotated
    // node's face (3D blocks are rotated NODE_ROTATION on the ground plane).
    const rotateAnchor = (center: { x: number; y: number } | undefined, p: Point): Point => {
      if (!center) return p;
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const c = Math.cos(NODE_ROTATION);
      const s = Math.sin(NODE_ROTATION);
      return { x: center.x + dx * c + dy * s, y: center.y - dx * s + dy * c };
    };
    // Compute obstacle rects from the CURRENT node positions. Dragging mutates
    // nodeById live, so re-running this keeps routing around the moved node.
    const buildObstacles = () =>
      [...nodeById.values()].map((n) => ({
        id: n.id,
        x0: n.x - PLANT_W / 2 - ROUTE_PAD,
        y0: n.y - PLANT_H / 2 - ROUTE_PAD,
        x1: n.x + PLANT_W / 2 + ROUTE_PAD,
        y1: n.y + PLANT_H / 2 + ROUTE_PAD,
      }));
    // Route + tube geometry for one edge, from its board-space anchors.
    const buildTube = (route: Point[]) => {
      const points = route.map((p) => {
        const w = boardToWorld(p.x, p.y);
        return { x: w.x, z: w.z };
      });
      const curve = new THREE.CatmullRomCurve3(
        points.map((p) => new THREE.Vector3(p.x, PIPE_Y, p.z)),
      );
      return { points, geometry: new THREE.TubeGeometry(curve, 64, PIPE_RADIUS, 10, false) };
    };
    const edgePaths = new Map<string, EdgePath>();
    const edgeGroup = new THREE.Group();
    for (const e of graph.edges) {
      const a = anchors.get(e.id);
      if (!a) continue;
      const af = rotateAnchor(nodeById.get(e.from), a.from);
      const at = rotateAnchor(nodeById.get(e.to), a.to);
      let route: Point[];
      if (e.kind === "rework") {
        route = [af, at];
      } else {
        route = orthogonalRoute(af, at, buildObstacles().filter((o) => o.id !== e.from && o.id !== e.to));
      }
      const { points, geometry } = buildTube(route);
      const color =
        e.kind === "error" ? 0xff5252 : e.kind === "rework" ? 0xff9d2e : 0x8aa6c0;
      const tube = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
      tube.castShadow = true;
      tube.receiveShadow = true;
      edgeGroup.add(tube);
      edgePaths.set(e.id, { polyline: xzPolyline(points), color, rework: e.kind === "rework", mesh: tube });
    }
    scene.add(edgeGroup);
    // Re-route every edge touching a dragged node and rebuild its tube geometry,
    // so pipes stay attached to the node faces while dragging.
    const rebuildEdgesForNode = (nodeId: string, bx: number, by: number) => {
      const orig = nodeById.get(nodeId);
      if (!orig) return;
      nodeById.set(nodeId, { ...orig, x: bx, y: by });
      const obstacles = buildObstacles();
      for (const e of graph.edges) {
        if (e.from !== nodeId && e.to !== nodeId) continue;
        const a = anchors.get(e.id);
        const ep = edgePaths.get(e.id);
        if (!a || !ep) continue;
        const af = rotateAnchor(nodeById.get(e.from), a.from);
        const at = rotateAnchor(nodeById.get(e.to), a.to);
        let route: Point[];
        if (e.kind === "rework") {
          route = [af, at];
        } else {
          route = orthogonalRoute(af, at, obstacles.filter((o) => o.id !== e.from && o.id !== e.to));
        }
        const { points, geometry } = buildTube(route);
        ep.polyline = xzPolyline(points);
        ep.mesh.geometry.dispose();
        ep.mesh.geometry = geometry;
      }
    };

    // --- Trucks: one shared box geometry, materials cached per artifact color. ---
    const truckGroup = new THREE.Group();
    scene.add(truckGroup);
    const truckGeo = new THREE.BoxGeometry(16, 7, 10);
    const truckMats = new Map<string, THREE.MeshLambertMaterial>();
    const trucks: Truck[] = [];
    const seen = new Set<string>();

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
        const node = nodeById.get(hitId);
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
      const shape = nodeShapes.get(draggingNodeId);
      if (shape) shape.group.position.set(w.x, 0, w.z);
      rebuildEdgesForNode(draggingNodeId, bx, by);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 2) {
        rightDown = false;
        return;
      }
      if (e.button !== 0) return;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 4;
      if (draggingNodeId) {
        const shape = nodeShapes.get(draggingNodeId);
        if (shape) {
          const b = worldToBoard(shape.group.position.x, shape.group.position.z);
          moveNode(draggingNodeId, b.x, b.y);
        }
        draggingNodeId = null;
        controls.enabled = true;
      } else if (downHitId && !moved) {
        useGraph.getState().setInspectorOpen(true);
      }
      renderer.domElement.style.cursor = "grab";
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

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
      }
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false, capture: true });
    renderer.domElement.addEventListener("contextmenu", preventContextMenu);
    window.addEventListener("keydown", onKeyDown);

    // Fit/reset: center on the graph, restore the default yaw/pitch and zoom, and
    // re-derive the frustum from the 2D viewport zoom (canvas aspect, so plants
    // keep their shape instead of stretching).
    const resetCamera = () => {
      const xs = graph.nodes.map((n) => n.x);
      const ys = graph.nodes.map((n) => n.y);
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

    let lastRunId = runtimeRef.current.runId;
    let rafId = 0;
    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const rt = runtimeRef.current;

      // Reset freight bookkeeping when a new run takes over.
      if (rt.runId !== lastRunId) {
        lastRunId = rt.runId;
        seen.clear();
        for (const t of trucks) truckGroup.remove(t.mesh);
        trucks.length = 0;
      }

      // Spawn a truck for each newly-seen packet.
      for (const p of rt.packets) {
        const key = `${p.edgeId}:${p.seq}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const path = edgePaths.get(p.edgeId);
        if (!path) continue;
        const color = path.rework ? "#ff9d2e" : p.artifactKind ? ARTIFACT_COLORS[p.artifactKind] : "#ffb020";
        let mat = truckMats.get(color);
        if (!mat) {
          mat = new THREE.MeshLambertMaterial({ color });
          truckMats.set(color, mat);
        }
        const mesh = new THREE.Mesh(truckGeo, mat);
        truckGroup.add(mesh);
        trucks.push({ mesh, polyline: path.polyline, startedAt: now });
      }

      // Advance/retire trucks along their pipes.
      for (let i = trucks.length - 1; i >= 0; i--) {
        const t = trucks[i]!;
        const travelled = ((now - t.startedAt) / 1000) * SPEED;
        if (travelled > t.polyline.total) {
          truckGroup.remove(t.mesh);
          trucks.splice(i, 1);
          continue;
        }
        const at = xzPolylinePointAt(t.polyline, travelled);
        t.mesh.position.set(at.x, PIPE_Y + PIPE_RADIUS + 4, at.z);
        t.mesh.rotation.y = at.angle;
      }

      // Highlight selection and drive status LEDs.
      const sel = useGraph.getState().selectedId;
      const haltedId = rt.status === "halted" ? rt.haltedNodeId : undefined;
      for (const [id, shape] of nodeShapes) {
        setGroupEmissive(shape.group, id === sel ? SELECT_COLOR : 0x000000);
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
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
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
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.Material) obj.material.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  return <div ref={mountRef} className="canvas3d" style={{ width: "100%", height: "100%" }} />;
}
