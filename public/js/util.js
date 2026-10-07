// ncraft — small crypto/encoding utilities (no dependencies).

export async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sha256HexSync(bytes) {
  // Synchronous fast path using a WebCrypto promise is not available; this is a
  // fallback for callers that cannot await. Prefer sha256Hex.
  throw new Error("sha256HexSync unavailable — use async sha256Hex");
}

// Base64 <-> Uint8Array helpers (btoa may not exist in all runtimes).
export function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64ToUtf8(b64) {
  const bytes = base64ToBytes(b64);
  return new TextDecoder().decode(bytes);
}

export function utf8ToBytes(str) {
  return new TextEncoder().encode(str);
}

// Deterministic PRNG so a single seed reproduces the whole world.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D value noise using a seeded grid.
export function makeNoise2D(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function grad(hash, x, y) {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  function fade(t) { return t * t * (3 - 2 * t); }

  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a00 = perm[(perm[xi & 255] + yi) & 255];
    const a10 = perm[(perm[(xi + 1) & 255] + yi) & 255];
    const a01 = perm[(perm[xi & 255] + yi + 1) & 255];
    const a11 = perm[(perm[(xi + 1) & 255] + yi + 1) & 255];
    const u = fade(xf), v = fade(yf);
    const n00 = grad(a00, xf, yf);
    const n10 = grad(a10, xf - 1, yf);
    const n01 = grad(a01, xf, yf - 1);
    const n11 = grad(a11, xf - 1, yf - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return nx0 + v * (nx1 - nx0); // ~[-1, 1]
  };
}
