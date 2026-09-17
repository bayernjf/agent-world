import * as THREE from "three";

/**
 * Procedural industrial textures drawn to a canvas at runtime — no external
 * image assets, so the "realistic factory" look stays fully self-contained.
 * Textures are module-level singletons (shared by every node's materials) and
 * never disposed; materials are per-node and disposed by the graph-sync teardown.
 */

function finalize(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let concreteTex: THREE.CanvasTexture | null = null;
/** Weathered grey concrete with speckle noise and hairline cracks. */
export function concreteTexture(): THREE.CanvasTexture {
  if (concreteTex) return concreteTex;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Headless (jsdom) has no 2D context; hand back a blank texture.
    concreteTex = finalize(canvas);
    return concreteTex;
  }
  ctx.fillStyle = "#7e848c";
  ctx.fillRect(0, 0, size, size);
  // Speckle.
  for (let i = 0; i < 5000; i++) {
    const g = 105 + Math.random() * 55;
    ctx.fillStyle = `rgba(${g | 0},${g | 0},${(g + 5) | 0},${(Math.random() * 0.14).toFixed(2)})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  // Hairline cracks.
  ctx.strokeStyle = "rgba(50,52,56,0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < 7; j++) {
      x += (Math.random() - 0.5) * 42;
      y += (Math.random() - 0.5) * 42;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  concreteTex = finalize(canvas);
  return concreteTex;
}

let corrugatedTex: THREE.CanvasTexture | null = null;
/** Vertical corrugated sheet metal with horizontal seams. */
export function corrugatedMetalTexture(): THREE.CanvasTexture {
  if (corrugatedTex) return corrugatedTex;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Headless (jsdom) has no 2D context; hand back a blank texture.
    corrugatedTex = finalize(canvas);
    return corrugatedTex;
  }
  ctx.fillStyle = "#565d66";
  ctx.fillRect(0, 0, size, size);
  const period = 16;
  for (let x = 0; x < size; x++) {
    const shade = Math.sin((x / period) * Math.PI * 2);
    const g = 82 + shade * 26;
    ctx.fillStyle = `rgb(${g | 0},${g | 0},${(g + 4) | 0})`;
    ctx.fillRect(x, 0, 1, size);
  }
  // Horizontal seams.
  ctx.fillStyle = "rgba(36,39,44,0.55)";
  for (let y = 64; y < size; y += 64) ctx.fillRect(0, y, size, 2);
  // Rust streaks near the seams.
  ctx.fillStyle = "rgba(122,74,50,0.18)";
  for (let y = 0; y < size; y += 64) {
    ctx.fillRect(0, y - 1, size, 1);
  }
  corrugatedTex = finalize(canvas);
  return corrugatedTex;
}

let hazardTex: THREE.CanvasTexture | null = null;
/** Diagonal yellow/black hazard stripes. */
export function hazardStripesTexture(): THREE.CanvasTexture {
  if (hazardTex) return hazardTex;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Headless (jsdom) has no 2D context; hand back a blank texture.
    hazardTex = finalize(canvas);
    return hazardTex;
  }
  ctx.fillStyle = "#e0b400";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#141518";
  const stripeW = 30;
  for (let d = -size; d < size * 2; d += stripeW * 2) {
    ctx.beginPath();
    ctx.moveTo(d, size);
    ctx.lineTo(d + stripeW, size);
    ctx.lineTo(d + stripeW + size, 0);
    ctx.lineTo(d + size, 0);
    ctx.closePath();
    ctx.fill();
  }
  hazardTex = finalize(canvas);
  return hazardTex;
}
