// ncraft — multiplayer server: static file hosting + WebSocket world sync.
// Zero framework; only dependency is `ws`. Authoritative for block edits and
// player presence; persists the world to disk so builds survive restarts.

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const DATA_DIR = process.env.WNCRAFT_DATA || path.resolve(__dirname, "..", "data");
const SEED = Number(process.env.WNCRAFT_SEED || 1337);
const MAX_XZ = 160, MAX_Y = 48; // matches client WORLD_SIZE / HEIGHT

// ---- World state -----------------------------------------------------------
const edits = new Map(); // "x,y,z" -> blockId
let dirty = false;

const worldFile = path.join(DATA_DIR, "world.json");
function loadWorld() {
  try {
    const raw = fs.readFileSync(worldFile, "utf8");
    const data = JSON.parse(raw);
    for (const [k, v] of data.edits) edits.set(k, v);
    console.log(`[world] loaded ${edits.size} edits from disk`);
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[world] load error:", e.message);
  }
}

function saveWorld() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const data = { seed: SEED, edits: [...edits.entries()], saved_at: Date.now() };
    fs.writeFileSync(worldFile + ".tmp", JSON.stringify(data));
    fs.renameSync(worldFile + ".tmp", worldFile);
    dirty = false;
  } catch (e) {
    console.error("[world] save error:", e.message);
  }
}

function scheduleSave() {
  if (dirty) return;
  dirty = true;
  setTimeout(() => { if (dirty) saveWorld(); }, 1500);
}

function setBlock(x, y, z, id) {
  x |= 0; y |= 0; z |= 0;
  if (x < 0 || x >= MAX_XZ || y < 0 || y >= MAX_Y || z < 0 || z >= MAX_XZ) return false;
  edits.set(`${x},${y},${z}`, id);
  scheduleSave();
  return true;
}

// ---- Static file server ----------------------------------------------------
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".wasm": "application/wasm",
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  const file = path.join(PUBLIC_DIR, urlPath.normalize());
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(resolved, (err, buf) => {
    if (err) {
      res.writeHead(404); res.end("Not found"); return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") { res.writeHead(200); res.end("ok"); return; }
  serveStatic(req, res);
});

// ---- Multiplayer -----------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/mp" });
let nextId = 1;
const clients = new Map(); // ws -> {id, name, pubkey, x, y, z, rot}

function broadcast(obj, exceptWs) {
  const data = JSON.stringify(obj);
  for (const ws of clients.keys()) {
    if (ws !== exceptWs && ws.readyState === ws.OPEN) ws.send(data);
  }
}

function playersList() {
  return [...clients.values()].map((c) => ({ id: c.id, name: c.name, x: c.x, y: c.y, z: c.z }));
}

wss.on("connection", (ws) => {
  ws.id = nextId++;
  ws.send(JSON.stringify({
    type: "welcome",
    id: ws.id,
    seed: SEED,
    edits: [...edits.entries()],
    players: playersList(),
  }));

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case "join": {
        ws.name = String(msg.name || "anon").slice(0, 32);
        ws.pubkey = String(msg.pubkey || "");
        ws.x = ws.x || MAX_XZ / 2;
        ws.y = ws.y || MAX_Y;
        ws.z = ws.z || MAX_XZ / 2;
        clients.set(ws, ws);
        broadcast({ type: "join", id: ws.id, name: ws.name, x: ws.x, y: ws.y, z: ws.z }, ws);
        break;
      }
      case "move": {
        if (!clients.has(ws)) return;
        ws.x = Number(msg.pos[0]); ws.y = Number(msg.pos[1]); ws.z = Number(msg.pos[2]);
        ws.rot = msg.rot;
        broadcast({ type: "move", id: ws.id, pos: msg.pos, rot: msg.rot }, ws);
        break;
      }
      case "place":
      case "break": {
        if (!clients.has(ws)) return;
        const bid = msg.type === "break" ? 0 : Number(msg.block);
        if (setBlock(msg.x, msg.y, msg.z, bid)) {
          broadcast({ type: "block", x: msg.x, y: msg.y, z: msg.z, block: bid }, ws);
        }
        break;
      }
      case "chat": {
        if (!clients.has(ws)) return;
        const text = String(msg.text || "").slice(0, 280);
        broadcast({ type: "chat", id: ws.id, text, name: ws.name }, null);
        break;
      }
    }
  });

  ws.on("close", () => {
    if (clients.has(ws)) {
      broadcast({ type: "leave", id: ws.id });
      clients.delete(ws);
    }
  });
});

loadWorld();
server.listen(PORT, HOST, () => {
  console.log(`[ncraft] listening on ${HOST}:${PORT} (serving ${PUBLIC_DIR})`);
  console.log(`[ncraft] world seed ${SEED}, data dir ${DATA_DIR}`);
});
