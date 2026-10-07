// ncraft — operator CLI: publish this game as an nsite (NIP-5A) using a Nostr
// secret key. Reads NOSTR_NSEC (hex) or NOSTR_NSEC_FILE from the environment.
// This is the only place a secret key is used, and it is optional — the in-game
// "Publish game" button does the same job via NIP-07 with no secret on disk.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

const ROOT = path.resolve(process.cwd());
const PUBLIC = path.join(ROOT, "public");

const RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
];

const SERVERS = (process.env.BLOSSOM_SERVERS || "https://blossom.nostr.me,https://cdn.satellite.earth")
  .split(",").map((s) => s.trim()).filter(Boolean);

const SITE_FILES = [
  "/index.html", "/style.css",
  "/js/blocks.js", "/js/util.js", "/js/textures.js", "/js/terrain.js",
  "/js/net.js", "/js/nostr.js", "/js/blossom.js", "/js/publish.js", "/js/main.js",
];

const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");

async function loadSecret() {
  const hex = process.env.NOSTR_NSEC || process.env.NOSTR_SECRET_KEY || process.env.NSEC;
  if (hex) return hex;
  const file = process.env.NOSTR_NSEC_FILE || process.env.NSEC_FILE;
  if (file) return (await readFile(file, "utf8")).trim();
  if (process.env.NOSTR_KEY) return process.env.NOSTR_KEY; // hex secret
  console.error("Set NOSTR_NSEC (hex) or NOSTR_NSEC_FILE to publish. Prefer a dedicated key, not your personal one.");
  process.exit(1);
}

function nip98(secret, url, method, payloadHex) {
  const tags = [["u", url], ["method", method]];
  if (payloadHex) tags.push(["payload", payloadHex]);
  return finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: "" }, secret);
}

async function upload(secret, filePath, mime) {
  const bytes = await readFile(filePath);
  const hex = sha256hex(bytes);
  const url = SERVERS[0].replace(/\/+$/, "") + "/upload";
  const auth = nip98(secret, url, "PUT", hex);
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Nostr ${Buffer.from(JSON.stringify(auth)).toString("base64")}`,
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "X-SHA-256": hex,
    },
    body: bytes,
  });
  if (!resp.ok) throw new Error(`upload ${path.basename(filePath)} failed: ${resp.status}`);
  return resp.json();
}

function mimeFor(rel) {
  if (rel.endsWith(".html")) return "text/html";
  if (rel.endsWith(".css")) return "text/css";
  if (rel.endsWith(".js")) return "application/javascript";
  return "application/octet-stream";
}

async function aggregateHash(pathTags) {
  const lines = pathTags.map(([, p, h]) => `${h} ${p}\n`).sort();
  return sha256hex(Buffer.from(lines.join(""), "utf8"));
}

async function main() {
  const secret = await loadSecret();
  const pubkey = getPublicKey(secret);
  const npub = nip19.npubEncode(pubkey);
  console.log(`Publishing as ${npub}`);

  const pathTags = [];
  for (const rel of SITE_FILES) {
    const blob = await upload(secret, path.join(PUBLIC, rel.slice(1)), mimeFor(rel));
    pathTags.push(["path", rel, blob.sha256]);
    console.log(`  ${rel}  ${blob.sha256.slice(0, 12)}… (${blob.size} B)`);
  }

  const x = await aggregateHash(pathTags);
  const title = process.env.NSITE_TITLE || "ncraft";
  const desc = process.env.NSITE_DESCRIPTION || "A self-hosted block world on Nostr";
  const source = process.env.NSITE_SOURCE;

  const tags = [...pathTags, ["x", x, "aggregate"], ["title", title], ["description", desc]];
  if (source) tags.push(["source", source]);
  for (const s of SERVERS) tags.push(["server", s]);

  const event = finalizeEvent({ kind: 15128, created_at: Math.floor(Date.now() / 1000), tags, content: "" }, secret);

  const pool = new SimplePool();
  await Promise.any(
    RELAYS.map((r) => pool.publish([r], event))
  );
  pool.close();

  console.log(`\nPublished root nsite manifest (kind 15128): ${event.id}`);
  console.log(`Aggregate hash: ${x}`);
  console.log(`View at: ${npub.slice(0, 16)}….nsite.lol  (or any NIP-5A gateway)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
