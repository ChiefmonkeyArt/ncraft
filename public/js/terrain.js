// ncraft — world data, terrain generation, and chunk mesh building.

import * as THREE from "three";
import { GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, BEDROCK, PLANK, COBBLE, AIR, isSolid, FACES } from "./blocks.js";
import { makeNoise2D, mulberry32 } from "./util.js";
import { tileUV } from "./textures.js";

export const CHUNK = 16;         // blocks per chunk edge
export const WORLD_CHUNKS = 10;  // 10x10 chunks => 160x160 blocks
export const WORLD_SIZE = CHUNK * WORLD_CHUNKS;
export const SEA_LEVEL = 16;
export const HEIGHT = 48;

// Tile lookup per block (matches tiles laid out in textures.js).
const TILES = {
  [GRASS]: { top: 0, side: 2, bottom: 1 },
  [DIRT]: { all: 1 },
  [STONE]: { all: 3 },
  [SAND]: { all: 4 },
  [LOG]: { side: 5, top: 6, bottom: 6 },
  [LEAVES]: { all: 7 },
  [WATER]: { all: 8 },
  [BEDROCK]: { all: 9 },
  [PLANK]: { all: 10 },
  [COBBLE]: { all: 11 },
};

// Opaque for face culling purposes. Water/leaves treated as opaque for simplicity.
function isOpaque(id) {
  return id !== AIR;
}

function blockTile(id, face) {
  const t = TILES[id];
  if (!t) return 0;
  if (t.all !== undefined) return t.all;
  if (face === 2) return t.bottom;
  if (face === 3) return t.top;
  return t.side;
}

export class World {
  constructor(seed = 1337) {
    this.seed = seed;
    this.edits = new Map();       // player-visible edits keyed "x,y,z"
    this._trees = new Map();      // "x,z" -> trunk height
    const noise = makeNoise2D(seed);
    this._noise = noise;
    this._genTrees();
  }

  _height(x, z) {
    const n = this._noise(x * 0.018, z * 0.018);
    return Math.floor(SEA_LEVEL + n * 9 + Math.sin(x * 0.05) * 2);
  }

  _genTrees() {
    const rnd = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);
    for (let x = 0; x < WORLD_SIZE; x += 4) {
      for (let z = 0; z < WORLD_SIZE; z += 4) {
        if (rnd() < 0.02) this._trees.set(`${x},${z}`, this._height(x, z));
      }
    }
  }

  inBounds(x, y, z) {
    return x >= 0 && x < WORLD_SIZE && y >= 0 && y < HEIGHT && z >= 0 && z < WORLD_SIZE;
  }

  key(x, y, z) { return `${x},${y},${z}`; }

  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return AIR;
    const k = this.key(x, y, z);
    if (this.edits.has(k)) return this.edits.get(k);
    return this._terrain(x, y, z);
  }

  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    this.edits.set(this.key(x, y, z), id);
  }

  _terrain(x, y, z) {
    const h = this._height(x, z);
    if (y === 0) return BEDROCK;
    if (y > h) return y <= SEA_LEVEL ? WATER : AIR;
    if (y === h) return h <= SEA_LEVEL - 1 ? SAND : GRASS;
    if (y >= h - 3) return DIRT;
    return STONE;
  }

  // Effective block including generated trees (trunk + canopy).
  effective(x, y, z) {
    let id = this.get(x, y, z);
    if (id !== AIR) return id;
    // Scan the 3x3 neighbourhood for a trunk column this block belongs to.
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const tx = x + ox, tz = z + oz;
        if (tx % 4 !== 0 || tz % 4 !== 0) continue;
        const h = this._trees.get(`${tx},${tz}`);
        if (h === undefined || h <= SEA_LEVEL) continue;
        if (x === tx && z === tz && y >= h + 1 && y <= h + 5) return LOG;
        if (y >= h + 5 && y <= h + 6) {
          if (Math.abs(x - tx) <= 1 && Math.abs(z - tz) <= 1) {
            // Trim the four corners of the top layer for a rounded crown.
            if (y === h + 6 && Math.abs(x - tx) === 1 && Math.abs(z - tz) === 1) continue;
            return LEAVES;
          }
        }
      }
    }
    return id;
  }

  // Number of edits (used for a compact serialised snapshot).
  get editCount() { return this.edits.size; }

  // Serialise all edits + seed for a shareable world snapshot.
  snapshot() {
    const edits = [];
    for (const [k, v] of this.edits) edits.push([k, v]);
    return { seed: this.seed, edits };
  }
}

// Build geometry for one chunk (16x16 columns, full height).
export function buildChunkGeometry(world, cx, cz) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const x0 = cx * CHUNK, z0 = cz * CHUNK;

  for (let lx = 0; lx < CHUNK; lx++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      const x = x0 + lx, z = z0 + lz;
      for (let y = 0; y < HEIGHT; y++) {
        const id = world.effective(x, y, z);
        if (id === AIR) continue;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nid = world.effective(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
          if (isOpaque(id) && isOpaque(nid)) continue; // hidden interior face

          const tile = blockTile(id, f);
          const uv = tileUV(tile);

          const base = positions.length / 3;
          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c];
            positions.push(x + corner[0], y + corner[1], z + corner[2]);
            normals.push(face.dir[0], face.dir[1], face.dir[2]);
          }
          const u0 = uv.u, v0 = uv.v, u1 = uv.u + uv.w, v1 = uv.v + uv.h;
          uvs.push(u0, v0, u0, v1, u1, v0, u1, v1);
          indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}
