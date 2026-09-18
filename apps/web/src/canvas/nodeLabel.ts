import * as THREE from "three";
import type { NodeKind } from "@agent-world/core";
import { categoryColor } from "./iso3d-shapes";

/**
 * Always-on name tags for the single-pipeline 3D canvas.
 *
 * Each node floats a camera-facing pill above its building (deferred-items 3D
 * 美化⑦: previously the name only appeared in the hover/selection popover).
 * Textures are cached by text+colour like CanvasPark's factory labels, so a
 * graph rebuild (which recreates every sprite) does not re-rasterise canvases
 * or leak GPU textures; the cache is bounded by the number of distinct names.
 */

/** Local Y (relative to a node group's origin) the pill floats at. Clears the
 *  tallest stylized topper (~76) and the textGen factory's sawtooth roof. */
export const NODE_LABEL_Y = 92;
/** World height of the pill; its width follows the rasterised text aspect. */
const LABEL_H = 36;
const FONT_SIZE = 40;
/** Long names are truncated so a single tag can't span the whole board. */
export const MAX_LABEL_CHARS = 12;

const textureCache = new Map<string, THREE.CanvasTexture>();

/** Code-point-aware truncation (safe for CJK / emoji), with an ellipsis. */
export function truncateNodeName(name: string, max = MAX_LABEL_CHARS): string {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  if (chars.length <= max) return trimmed;
  return chars.slice(0, max - 1).join("") + "…";
}

function makeLabelTexture(text: string, colorHex: number): THREE.CanvasTexture {
  const color = "#" + colorHex.toString(16).padStart(6, "0");
  const cacheKey = `node-label|${text}|${color}`;
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Headless / no-2d-context fallback: still cache so the same name reuses
    // one texture instead of leaking a fresh canvas per graph rebuild.
    const fallback = new THREE.CanvasTexture(canvas);
    textureCache.set(cacheKey, fallback);
    return fallback;
  }

  const font = `bold ${FONT_SIZE}px sans-serif`;
  ctx.font = font;
  const padX = 22;
  const padY = 10;
  canvas.width = Math.ceil(ctx.measureText(text).width) + padX * 2;
  canvas.height = FONT_SIZE + padY * 2;

  // Semi-transparent dark pill, matching the factory labels in CanvasPark.
  ctx.fillStyle = "rgba(20, 24, 29, 0.82)";
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, canvas.height / 2);
  ctx.fill();

  // Category-tinted text with a soft shadow for legibility over the scene.
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

/**
 * Build a camera-facing name pill for a node. The sprite's raycast is disabled
 * so the tag never intercepts node picking, and depthTest is off so the name
 * stays readable even when another building is in front (consistent with the
 * RTS park labels). The sprite sits on the group's vertical axis, so the
 * node's ground-plane rotation does not move it sideways.
 */
export function makeNodeLabel(name: string, kind: NodeKind): THREE.Sprite {
  const text = truncateNodeName(name);
  const tex = makeLabelTexture(text, categoryColor(kind));
  const material = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);

  const img = tex.image as HTMLCanvasElement | undefined;
  const aspect = img && img.width && img.height ? img.width / img.height : 3;
  sprite.scale.set(LABEL_H * aspect, LABEL_H, 1);
  sprite.position.set(0, NODE_LABEL_Y, 0);
  sprite.renderOrder = 10;
  sprite.raycast = () => {}; // visual only — never steal node raycasts
  sprite.userData.role = "label";
  return sprite;
}
