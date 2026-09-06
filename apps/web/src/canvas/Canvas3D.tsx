import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useGraph } from "../store/graph";
import { PLANT_H, PLANT_W } from "../store/graph";
import { boardToWorld } from "./iso3d";

/** Height of the placeholder node block in 3D world units. */
const NODE_HEIGHT = 60;
/** Fixed camera pitch (angle from vertical): locks the isometric tilt. */
const PITCH = Math.PI / 4;

/**
 * Read-only 3D display view: renders the same graph the 2D editor shows, as
 * placeholder blocks and pipes on the XZ ground plane. Camera is constrained to
 * a fixed pitch with horizontal rotate and pan only (no zoom, no tilt).
 */
export default function Canvas3D() {
  const graph = useGraph((s) => s.graph);
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

    const camera = new THREE.OrthographicCamera(-720, 720, 320, -320, 0.1, 4000);
    camera.position.set(0, 900, 900);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
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

    const nodeMat = new THREE.MeshLambertMaterial({ color: 0x4a90d9 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x8aa6c0 });

    const nodeGroup = new THREE.Group();
    for (const n of graph.nodes) {
      const w = boardToWorld(n.x, n.y);
      const geo = new THREE.BoxGeometry(PLANT_W, NODE_HEIGHT, PLANT_H);
      const mesh = new THREE.Mesh(geo, nodeMat);
      mesh.position.set(w.x, NODE_HEIGHT / 2, w.z);
      nodeGroup.add(mesh);
    }
    scene.add(nodeGroup);

    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const edgeGroup = new THREE.Group();
    for (const e of graph.edges) {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) continue;
      const wa = boardToWorld(a.x, a.y);
      const wb = boardToWorld(b.x, b.y);
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(wa.x, NODE_HEIGHT / 2, wa.z),
        new THREE.Vector3(wb.x, NODE_HEIGHT / 2, wb.z),
      ]);
      edgeGroup.add(new THREE.Line(geo, edgeMat));
    }
    scene.add(edgeGroup);

    let rafId = 0;
    const loop = () => {
      rafId = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(rafId);
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) obj.geometry.dispose();
      });
      nodeMat.dispose();
      edgeMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [graph]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}
