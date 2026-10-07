// ncraft — block type definitions and shared constants.

export const AIR = 0;
export const GRASS = 1;
export const DIRT = 2;
export const STONE = 3;
export const SAND = 4;
export const LOG = 5;
export const LEAVES = 6;
export const WATER = 7;
export const BEDROCK = 8;
export const PLANK = 9;
export const COBBLE = 10;

// Tile indices into the generated atlas (see textures.js).
// -1 tile means transparent / air face (never emitted).
export const BLOCKS = {
  [GRASS]: { name: "Grass", solid: true, top: 0, side: 2, bottom: 1 },
  [DIRT]: { name: "Dirt", solid: true, all: 1 },
  [STONE]: { name: "Stone", solid: true, all: 3 },
  [SAND]: { name: "Sand", solid: true, all: 4 },
  [LOG]: { name: "Log", solid: true, side: 5, top: 6, bottom: 6 },
  [LEAVES]: { name: "Leaves", solid: true, all: 7 },
  [WATER]: { name: "Water", solid: false, all: 8, translucent: true },
  [BEDROCK]: { name: "Bedrock", solid: true, all: 9 },
  [PLANK]: { name: "Plank", solid: true, all: 10 },
  [COBBLE]: { name: "Cobble", solid: true, all: 11 },
};

export function isSolid(id) {
  const b = BLOCKS[id];
  return !!b && b.solid;
}

// Blocks a player can place from the hotbar.
export const PLACEABLE = [GRASS, DIRT, STONE, SAND, LOG, LEAVES, PLANK, COBBLE];

// Face definitions shared by the mesh builder and raycasting.
export const FACES = [
  // x, y, z offsets in the order: -X, +X, -Y, +Y, -Z, +Z
  { dir: [-1, 0, 0], corners: [ [0,1,0], [0,0,0], [0,1,1], [0,0,1] ] },
  { dir: [ 1, 0, 0], corners: [ [1,0,0], [1,1,0], [1,0,1], [1,1,1] ] },
  { dir: [0,-1, 0], corners: [ [0,0,1], [0,0,0], [1,0,1], [1,0,0] ] },
  { dir: [0, 1, 0], corners: [ [0,1,0], [0,1,1], [1,1,0], [1,1,1] ] },
  { dir: [0, 0,-1], corners: [ [1,0,0], [0,0,0], [1,1,0], [0,1,0] ] },
  { dir: [0, 0, 1], corners: [ [0,0,1], [1,0,1], [0,1,1], [1,1,1] ] },
];
