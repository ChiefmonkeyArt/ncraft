// ncraft — main client: engine, controls, multiplayer, Nostr identity, publishing.

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

import { AIR, GRASS, PLACEABLE, isSolid } from "./blocks.js";
import { buildAtlas } from "./textures.js";
import { World, CHUNK, WORLD_CHUNKS, buildChunkGeometry, HEIGHT } from "./terrain.js";
import { Net } from "./net.js";
import { getNostr, getPubkey } from "./nostr.js";
import { DEFAULT_SERVERS } from "./blossom.js";
import { publishWorld, publishSite, publishServerList } from "./publish.js";

// ---- Configuration ---------------------------------------------------------
const RELAYS = ["wss://relay.damus.io", "wss://relay.primal.net", "wss://nos.lol"];
const SERVERS = [...DEFAULT_SERVERS];
const REACH = 6;              // raycast reach in blocks
const EYE = 1.62;             // camera height above the player's feet
const GRAVITY = -24;
const JUMP = 8.5;
const SPEED = 6;
const FLY_SPEED = 12;

// ---- State -----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 40, 120);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(80, 40, 80);

const controls = new PointerLockControls(camera, renderer.domElement);

const hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(80, 140, 40);
scene.add(sun);
sun.target.position.set(80, 0, 80);
scene.add(sun.target);

const world = new World(1337);
const chunks = new Map(); // "cx,cz" -> mesh
const mat = new THREE.MeshLambertMaterial({ map: buildAtlas(), side: THREE.DoubleSide });

const remotePlayers = new Map(); // id -> {mesh,label,name,tx,ty,tz,rx,ry}
const highlightBox = buildHighlight();
scene.add(highlightBox);

// Player physics state.
const player = {
  x: 80, y: 40, z: 80,   // feet position
  vy: 0, onGround: false, flying: true,
};
const half = 0.3, height = 1.8;

let selected = 0; // index into PLACEABLE
let nostr = null, pubkey = null, npubShort = null;

const net = new Net(null, {
  onWelcome: (msg) => {
    log(`Joined as player #${msg.id}`);
    if (msg.seed != null) applyWorld(msg);
    for (const p of msg.players || []) addRemote(p);
  },
  onWorld: (msg) => applyWorld(msg),
  onPlayers: (msg) => { /* handled on welcome/join/leave */ },
  onJoin: (msg) => addRemote(msg),
  onLeave: (msg) => removeRemote(msg.id),
  onMove: (msg) => updateRemoteTarget(msg),
  onBlock: (msg) => applyBlock(msg.x, msg.y, msg.z, msg.block ?? AIR, false),
  onChat: (msg) => addChat(msg),
  onSystem: (msg) => log(String(msg.text || msg.message || "")),
  onClose: () => log("Disconnected from server"),
});

// ---- World construction ----------------------------------------------------
for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
  for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
    buildChunkMesh(cx, cz);
  }
}

function buildChunkMesh(cx, cz) {
  const key = `${cx},${cz}`;
  const existing = chunks.get(key);
  if (existing) { scene.remove(existing); existing.geometry.dispose(); }
  const geometry = buildChunkGeometry(world, cx, cz);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.matrixAutoUpdate = false;
  chunks.set(key, mesh);
  scene.add(mesh);
}

function chunkOf(v) { return Math.floor(v / CHUNK); }

function applyBlock(x, y, z, id, local) {
  world.set(x, y, z, id);
  // Rebuild the containing chunk plus any neighbor on a chunk boundary.
  const cx = chunkOf(x), cz = chunkOf(z);
  buildChunkMesh(cx, cz);
  if (x % CHUNK === 0) buildChunkMesh(cx - 1, cz);
  if (x % CHUNK === CHUNK - 1) buildChunkMesh(cx + 1, cz);
  if (z % CHUNK === 0) buildChunkMesh(cx, cz - 1);
  if (z % CHUNK === CHUNK - 1) buildChunkMesh(cx, cz + 1);
}

function applyWorld(msg) {
  world.seed = msg.seed;
  world._noise = null; // regenerate on next access
  // Recreate world with the authoritative seed, then apply edits.
  const next = new World(msg.seed);
  Object.assign(world, next);
  for (const [k, id] of msg.edits || []) {
    const [x, y, z] = k.split(",").map(Number);
    world.set(x, y, z, id);
  }
  rebuildAll();
}

function rebuildAll() {
  for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
    for (let cz = 0; cz < WORLD_CHUNKS; cz++) buildChunkMesh(cx, cz);
  }
}

// ---- Physics / collision ---------------------------------------------------
function collides(x, y, z) {
  const minX = Math.floor(x - half), maxX = Math.floor(x + half);
  const minY = Math.floor(y), maxY = Math.floor(y + height);
  const minZ = Math.floor(z - half), maxZ = Math.floor(z + half);
  for (let bx = minX; bx <= maxX; bx++)
    for (let by = minY; by <= maxY; by++)
      for (let bz = minZ; bz <= maxZ; bz++)
        if (isSolid(world.effective(bx, by, bz))) return true;
  return false;
}

function tryMove(dx, dy, dz) {
  player.x += dx;
  if (collides(player.x, player.y, player.z)) player.x -= dx;
  player.y += dy;
  if (collides(player.x, player.y, player.z)) {
    player.y -= dy;
    if (dy > 0) player.vy = 0; // hit ceiling
  }
  player.z += dz;
  if (collides(player.x, player.y, player.z)) player.z -= dz;
}

// ---- Input -----------------------------------------------------------------
const keys = {};
window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "Space" && controls.isLocked) e.preventDefault();
  if (e.code.startsWith("Digit") && controls.isLocked) selectHotbar(e.code);
  if (e.code === "KeyF") player.flying = !player.flying;
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

function selectHotbar(code) {
  const n = Number(code.slice(5));
  if (n >= 1 && n <= PLACEABLE.length) { selected = n - 1; renderHotbar(); }
}
window.addEventListener("wheel", (e) => {
  if (!controls.isLocked) return;
  selected = (selected + (e.deltaY > 0 ? 1 : -1) + PLACEABLE.length) % PLACEABLE.length;
  renderHotbar();
});

let lastSent = 0;
function updatePlayer(dt) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  forward.y = 0; forward.normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  right.y = 0; right.normalize();

  const speed = player.flying ? FLY_SPEED : SPEED;
  let mx = 0, my = 0, mz = 0;
  if (keys["KeyW"]) { mx += forward.x; mz += forward.z; }
  if (keys["KeyS"]) { mx -= forward.x; mz -= forward.z; }
  if (keys["KeyA"]) { mx -= right.x; mz -= right.z; }
  if (keys["KeyD"]) { mx += right.x; mz += right.z; }

  if (player.flying) {
    if (keys["Space"]) my += 1;
    if (keys["ShiftLeft"] || keys["ShiftRight"]) my -= 1;
  } else {
    // gravity + jump
    player.vy += GRAVITY * dt;
    if (player.onGround && keys["Space"]) player.vy = JUMP;
    my = player.vy * dt;
  }

  const len = Math.hypot(mx, my, mz) || 1;
  const step = speed * dt;
  tryMove((mx / len) * step, player.flying ? (my / len) * step : my, (mz / len) * step);

  // ground detection
  player.onGround = collides(player.x, player.y - 0.01, player.z);
  if (!player.flying && player.onGround && player.vy < 0) player.vy = 0;

  camera.position.set(player.x, player.y + EYE, player.z);

  // throttle movement sends to ~20 Hz
  const now = performance.now();
  if (now - lastSent > 50) {
    lastSent = now;
    net.move(
      [round1(player.x), round1(player.y), round1(player.z)],
      [round2(camera.rotation.x), round2(camera.rotation.y)]
    );
  }
}

// ---- Voxel raycast (DDA) --------------------------------------------------
function raycast() {
  const origin = camera.position.clone();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / (dir.x || 1e-9));
  const tDeltaY = Math.abs(1 / (dir.y || 1e-9));
  const tDeltaZ = Math.abs(1 / (dir.z || 1e-9));
  let tMaxX = dir.x === 0 ? Infinity : ((stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX);
  let tMaxY = dir.y === 0 ? Infinity : ((stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY);
  let tMaxZ = dir.z === 0 ? Infinity : ((stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ);

  let nx = 0, ny = 0, nz = 0; // face normal of the hit block
  for (let i = 0; i < 256; i++) {
    const id = world.get(x, y, z);
    if (id !== AIR && id !== 7 /* WATER */) {
      return { x, y, z, nx, ny, nz };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
    else if (tMaxY < tMaxZ) { y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
    else { z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    if (tMaxX > REACH && tMaxY > REACH && tMaxZ > REACH) return null;
  }
  return null;
}

function editBlock(place) {
  const hit = raycast();
  if (!hit) return;
  if (place) {
    const bx = hit.x + hit.nx, by = hit.y + hit.ny, bz = hit.z + hit.nz;
    applyBlock(bx, by, bz, PLACEABLE[selected], true);
    net.place(bx, by, bz, PLACEABLE[selected]);
  } else {
    applyBlock(hit.x, hit.y, hit.z, AIR, true);
    net.break_(hit.x, hit.y, hit.z);
  }
}

renderer.domElement.addEventListener("mousedown", (e) => {
  if (!controls.isLocked) return;
  if (e.button === 0) editBlock(false);
  if (e.button === 2) editBlock(true);
});
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

controls.addEventListener("lock", () => document.body.classList.add("locked"));
controls.addEventListener("unlock", () => document.body.classList.remove("locked"));
renderer.domElement.addEventListener("click", () => { if (!controls.isLocked) controls.lock(); });

// ---- Multiplayer rendering -------------------------------------------------
function buildHighlight() {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
  const box = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
  box.visible = false;
  return box;
}

function addRemote(p) {
  if (remotePlayers.has(p.id) || p.id === net.id) return;
  const geo = new THREE.BoxGeometry(0.6, 1.8, 0.6);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colorFor(p.id) }));
  const label = makeLabel(p.name || "anon");
  const group = new THREE.Group();
  group.add(m);
  group.add(label);
  scene.add(group);
  remotePlayers.set(p.id, {
    mesh: group, name: p.name, tx: p.x || 0, ty: p.y || 0, tz: p.z || 0,
  });
}

function removeRemote(id) {
  const r = remotePlayers.get(id);
  if (r) { scene.remove(r.mesh); remotePlayers.delete(id); }
  renderPlayers();
}

function updateRemoteTarget(msg) {
  const r = remotePlayers.get(msg.id);
  if (!r) return;
  r.tx = msg.pos[0]; r.ty = msg.pos[1]; r.tz = msg.pos[2];
}

function colorFor(id) {
  let h = 0;
  for (const c of String(id || "0")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360},70%,55%)`;
}

function makeLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "28px sans-serif";
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(text.length > 16 ? text.slice(0, 15) + "…" : text, 128, 42);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = 2.2;
  return sprite;
}

let lerp = 12; // px per second interp factor
function renderRemote(dt) {
  for (const r of remotePlayers.values()) {
    const k = Math.min(1, dt * lerp);
    r.mesh.position.x += (r.tx - r.mesh.position.x) * k;
    r.mesh.position.y += (r.ty - r.mesh.position.y) * k;
    r.mesh.position.z += (r.tz - r.mesh.position.z) * k;
  }
}

function renderPlayers() {
  const list = document.getElementById("players");
  const me = pubkey ? `${npubShort} (you)` : "guest (you)";
  const names = [me, ...[...remotePlayers.values()].map((r) => r.name + (r.mesh.position.y < -100 ? "" : ""))];
  list.textContent = names.join(", ");
}

// ---- UI helpers ------------------------------------------------------------
function log(msg) {
  const el = document.getElementById("status");
  const line = document.createElement("div");
  line.textContent = msg;
  el.prepend(line);
  while (el.children.length > 4) el.removeChild(el.lastChild);
}

function addChat(msg) {
  const el = document.getElementById("chat");
  const line = document.createElement("div");
  const from = remotePlayers.get(msg.id)?.name || `#${msg.id}`;
  line.textContent = `${from}: ${msg.text}`;
  el.appendChild(line);
  while (el.children.length > 8) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

// ---- Hotbar ----------------------------------------------------------------
function renderHotbar() {
  const bar = document.getElementById("hotbar");
  bar.innerHTML = "";
  PLACEABLE.forEach((id, i) => {
    const b = document.createElement("button");
    b.className = "slot" + (i === selected ? " active" : "");
    b.textContent = blockShort(id);
    b.onclick = () => { selected = i; renderHotbar(); };
    bar.appendChild(b);
  });
}
function blockShort(id) {
  return ({ 1: "☘", 2: "Dirt", 3: "Stone", 4: "Sand", 5: "Log", 6: "Leaf", 9: "Plank", 10: "Cob" })[id] || id;
}

// ---- Nostr identity --------------------------------------------------------
async function connectIdentity() {
  nostr = getNostr();
  const btn = document.getElementById("login");
  if (!nostr) {
    btn.textContent = "No NIP-07 extension (guest)";
    btn.disabled = true;
    log("Install a NIP-07 extension (e.g. nos2x, Alby, noStrudel) to publish.");
    net.join("guest-" + Math.floor(Math.random() * 10000), "");
    return;
  }
  try {
    pubkey = await getPubkey(nostr);
    npubShort = pubkey ? pubkey.slice(0, 8) + "…" : null;
    btn.textContent = pubkey ? `Signed in (${npubShort})` : "Sign in with Nostr";
    net.join(pubkey ? nameFor(pubkey) : "guest", pubkey || "");
    renderPlayers();
  } catch {
    log("Nostr sign-in failed.");
    net.join("guest-" + Math.floor(Math.random() * 10000), "");
  }
}

function nameFor(pk) { return "n" + pk.slice(0, 6); }

// ---- Publishing hooks ------------------------------------------------------
async function publishWorldNow() {
  if (!nostr || !pubkey) { log("Sign in with Nostr first."); return; }
  setBusy("publishWorld", true);
  try {
    const res = await publishWorld({ nostr, pubkey, relays: RELAYS, servers: SERVERS, world, title: "ncraft world" });
    log(res.ok ? `World published: ${res.blob.url}` : "World event sent (no relay ack).");
  } catch (e) { log("Publish failed: " + e.message); }
  setBusy("publishWorld", false);
}

async function publishSiteNow() {
  if (!nostr || !pubkey) { log("Sign in with Nostr first."); return; }
  setBusy("publishSite", true);
  try {
    await publishServerList({ nostr, pubkey, relays: RELAYS, servers: SERVERS });
    const res = await publishSite({ nostr, pubkey, relays: RELAYS, servers: SERVERS, title: "ncraft" });
    log(res.ok ? `Game published as nsite (${res.aggregate.slice(0, 10)}…) — view at <npub>.nsite.lol` : "nsite event sent.");
  } catch (e) { log("nsite publish failed: " + e.message); }
  setBusy("publishSite", false);
}

function setBusy(id, on) {
  const el = document.getElementById(id);
  el.disabled = on;
  el.textContent = on ? "Working…" : (id === "publishWorld" ? "Publish world" : "Publish site");
}

// ---- Main loop -------------------------------------------------------------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (controls.isLocked) {
    updatePlayer(dt);
    const hit = raycast();
    if (hit) {
      highlightBox.visible = true;
      highlightBox.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      highlightBox.visible = false;
    }
  } else {
    highlightBox.visible = false;
  }

  renderRemote(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

// ---- Boot ------------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById("login").addEventListener("click", connectIdentity);
document.getElementById("play").addEventListener("click", () => controls.lock());
document.getElementById("publishWorld").addEventListener("click", publishWorldNow);
document.getElementById("publishSite").addEventListener("click", publishSiteNow);
document.getElementById("chatSend").addEventListener("click", () => {
  const inp = document.getElementById("chatInput");
  if (inp.value.trim()) { net.chat(inp.value.trim()); inp.value = ""; }
});
document.getElementById("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("chatSend").click();
});

net.connect();
renderHotbar();
connectIdentity();
log("Welcome to ncraft — a self-hosted block world on Nostr.");
