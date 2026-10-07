// ncraft — procedural texture atlas. Draws 16x16 tiles onto one canvas so the
// whole game ships with zero external image assets.

import * as THREE from "three";

const TILE = 16;
const COLS = 4;
const ROWS = 3;

// Tile order (index -> name). Must match the indices used in blocks.js.
const TILES = [
  "grass_top",
  "dirt",
  "grass_side",
  "stone",
  "sand",
  "log_side",
  "log_top",
  "leaves",
  "water",
  "bedrock",
  "plank",
  "cobble",
];

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fill a 16x16 tile with a base color plus per-pixel noise speckle.
function paint(ctx, idx, base, variation, rnd) {
  const x = (idx % COLS) * TILE;
  const y = Math.floor(idx / COLS) * TILE;
  for (let py = 0; py < TILE; py++) {
    for (let px = 0; px < TILE; px++) {
      const n = (rnd() - 0.5) * variation;
      const r = clamp(Math.round(base[0] + n));
      const g = clamp(Math.round(base[1] + n));
      const b = clamp(Math.round(base[2] + n));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function clamp(v) { return Math.max(0, Math.min(255, v)); }

function drawGrassSide(ctx, idx, rnd) {
  // Top strip = grass, rest = dirt.
  const x = (idx % COLS) * TILE;
  const y = Math.floor(idx / COLS) * TILE;
  const grass = [106, 170, 64], dirt = [134, 96, 67];
  for (let py = 0; py < TILE; py++) {
    const base = py < 4 ? grass : dirt;
    const bump = py > 0 && py < 5 ? rnd() * 10 : 0;
    for (let px = 0; px < TILE; px++) {
      const n = (rnd() - 0.5) * 18;
      const r = clamp(Math.round(base[0] + n + bump));
      const g = clamp(Math.round(base[1] + n + bump));
      const b = clamp(Math.round(base[2] + n));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function drawLogSide(ctx, idx, rnd) {
  const x = (idx % COLS) * TILE;
  const y = Math.floor(idx / COLS) * TILE;
  const bark = [104, 78, 47], inner = [138, 106, 65];
  for (let py = 0; py < TILE; py++) {
    for (let px = 0; px < TILE; px++) {
      const n = (rnd() - 0.5) * 24;
      const base = px % 4 === 0 ? inner : bark;
      const r = clamp(Math.round(base[0] + n));
      const g = clamp(Math.round(base[1] + n));
      const b = clamp(Math.round(base[2] + n));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

function drawLeaves(ctx, idx, rnd) {
  const x = (idx % COLS) * TILE;
  const y = Math.floor(idx / COLS) * TILE;
  for (let py = 0; py < TILE; py++) {
    for (let px = 0; px < TILE; px++) {
      // Some pixels are darker "gaps" to suggest foliage.
      const shade = rnd();
      const base = shade < 0.18 ? [34, 74, 30] : shade < 0.75 ? [58, 112, 40] : [44, 96, 34];
      const n = (rnd() - 0.5) * 14;
      ctx.fillStyle = `rgb(${clamp(Math.round(base[0] + n))},${clamp(Math.round(base[1] + n))},${clamp(Math.round(base[2] + n))})`;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

export function buildAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const ctx = canvas.getContext("2d");

  paint(ctx, 0, [106, 170, 64], 16, rand(10));  // grass top
  drawGrassSide(ctx, 2, rand(10));               // grass side
  paint(ctx, 1, [134, 96, 67], 20, rand(12));    // dirt
  paint(ctx, 3, [125, 125, 125], 18, rand(7));   // stone
  paint(ctx, 4, [218, 206, 148], 22, rand(9));   // sand
  drawLogSide(ctx, 5, rand(8));                  // log side
  paint(ctx, 6, [166, 132, 90], 18, rand(8));    // log top
  drawLeaves(ctx, 7, rand(6));                   // leaves
  paint(ctx, 8, [48, 94, 180], 10, rand(4));     // water
  paint(ctx, 9, [70, 70, 70], 24, rand(5));      // bedrock
  paint(ctx, 10, [182, 150, 98], 16, rand(11));  // plank
  paint(ctx, 11, [110, 110, 110], 26, rand(7));  // cobble

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

export const ATLAS_COLS = COLS;
export const ATLAS_ROWS = ROWS;
export const TILE_SIZE = TILE;

// UV (u,v) of a tile's top-left corner, in atlas space.
export function tileUV(tile) {
  const x = tile % COLS;
  const y = Math.floor(tile / COLS);
  return { u: x / COLS, v: 1 - (y + 1) / ROWS, w: 1 / COLS, h: 1 / ROWS };
}
