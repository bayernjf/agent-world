import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ARTIFACT_COLORS } from "@agent-world/core";
import { useGraph } from "../store/graph";
import { PLANT_H, PLANT_W } from "../store/graph";
import { useCanvas } from "../store/canvas";
import { useViewMode } from "../store/view-mode";
import { useVisibleRuntime } from "../store/run";
import { boardToWorld, viewportCenterToWorld, xzPolyline, xzPolylinePointAt, zoomToFrustum, type XZPolyline } from "./iso3d";
import {
  buildNodeShape,
  NODE_HEIGHT,
  PIPE_Y,
  SELECT_COLOR,
  setGroupEmissive,
  statusLedColor,
  type NodeShape,
} from "./iso3d-shapes";
import { edgeAnchors, orthogonalRoute, ROUTE_PAD, type Point } from "./geometry";

/** Fixed camera pitch (angle from vertical): locks the isometric tilt. */
const PITCH = Math.PI / 4;
/** Freight speed along a pipe, in board/world units per second (matches 2D). */
const SPEED = 340;

interface EdgePath {
  polyline: XZPolyline;
  color: number;
  rework: boolean;
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
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14181d);

    const f = zoomToFrustum(viewport.zoom);
    const camera = new THREE.OrthographicCamera(f.left, f.right, f.top, f.bottom, 0.1, 4000);

    const controls = new OrbitControls(camera, renderer.domElement);
    if (camera3d) {
      camera.position.set(camera3d.posX, camera3d.posY, camera3d.posZ);
      controls.target.set(camera3d.targetX, 0, camera3d.targetZ);
    } else {
      camera.position.set(0, 900, 900);
      const center = viewportCenterToWorld(viewport);
      controls.target.set(center.x, 0, center.z);
    }
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = false;
    controls.minPolarAngle = PITCH;
    controls.maxPolarAngle = PITCH;
    controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(200, 400, 200);
    scene.add(ambient, dir);

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
        if ((obj as THREE.Mesh).isMesh) obj.userData.nodeId = n.id;
      });
      nodeGroup.add(shape.group);
      nodeShapes.set(n.id, shape);
    }
    scene.add(nodeGroup);

    // --- Edges: orthogonal routes (same geometry the 2D canvas draws). ---
    const anchors = edgeAnchors(graph);
    const obstacles = graph.nodes.map((n) => ({
      id: n.id,
      x0: n.x - PLANT_W / 2 - ROUTE_PAD,
      y0: n.y - PLANT_H / 2 - ROUTE_PAD,
      x1: n.x + PLANT_W / 2 + ROUTE_PAD,
      y1: n.y + PLANT_H / 2 + ROUTE_PAD,
    }));
    const edgePaths = new Map<string, EdgePath>();
    const edgeGroup = new THREE.Group();
    for (const e of graph.edges) {
      const a = anchors.get(e.id);
      if (!a) continue;
      let route: Point[];
      if (e.kind === "rework") {
        route = [a.from, a.to];
      } else {
        route = orthogonalRoute(a.from, a.to, obstacles.filter((o) => o.id !== e.from && o.id !== e.to));
      }
      const points = route.map((p) => {
        const w = boardToWorld(p.x, p.y);
        return { x: w.x, z: w.z };
      });
      const color =
        e.kind === "error" ? 0xff5252 : e.kind === "rework" ? 0xff9d2e : 0x8aa6c0;
      edgePaths.set(e.id, { polyline: xzPolyline(points), color, rework: e.kind === "rework" });
      const geo = new THREE.BufferGeometry().setFromPoints(
        points.map((p) => new THREE.Vector3(p.x, PIPE_Y, p.z)),
      );
      edgeGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
    }
    scene.add(edgeGroup);

    // --- Trucks: one shared box geometry, materials cached per artifact color. ---
    const truckGroup = new THREE.Group();
    scene.add(truckGroup);
    const truckGeo = new THREE.BoxGeometry(16, 7, 10);
    const truckMats = new Map<string, THREE.MeshLambertMaterial>();
    const trucks: Truck[] = [];
    const seen = new Set<string>();

    // --- Raycast selection: click a block to select + open the Inspector. ---
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let downHitId: string | null = null;
    const onPointerDown = (e: PointerEvent) => {
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
      } else {
        downHitId = null;
        selectNone();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 4;
      if (downHitId && !moved) {
        useGraph.getState().setInspectorOpen(true);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

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
        t.mesh.position.set(at.x, PIPE_Y + 4, at.z);
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

      controls.update();
      renderer.render(scene, camera);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
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
