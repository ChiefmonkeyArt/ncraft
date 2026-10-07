// ncraft — publishing: turn the world and the game itself into sharable,
// content-addressed Nostr objects (Blossom blobs + signed events).

import { uploadToServers, downloadBlob } from "./blossom.js";
import { WORLD_KIND, NSITE_KIND, makeUnsignedEvent, signEvent, publishToRelays } from "./nostr.js";
import { sha256Hex, utf8ToBytes } from "./util.js";

// Files that make up the web client, in site-relative form. The nsite publish
// fetches them from the live origin and hashes each for the NIP-5A manifest.
export const SITE_FILES = [
  "/index.html",
  "/style.css",
  "/js/blocks.js",
  "/js/util.js",
  "/js/textures.js",
  "/js/terrain.js",
  "/js/net.js",
  "/js/nostr.js",
  "/js/blossom.js",
  "/js/publish.js",
  "/js/main.js",
];

// ---- World snapshot ---------------------------------------------------------

// Build the signed kind-30078 world event from a serialised snapshot.
export async function publishWorld({ nostr, pubkey, relays, servers, world, title, authorName }) {
  const payload = JSON.stringify({
    app: "ncraft",
    version: 1,
    name: title || "ncraft world",
    seed: world.seed,
    edits: world.edits, // array of ["x,y,z", blockId]
    servers,             // Blossom servers hosting the snapshot (may be [] until uploaded)
  });
  const blob = await uploadToServers(servers, utf8ToBytes(payload), "application/json", nostr, pubkey);

  const content = JSON.stringify({
    name: title || "ncraft world",
    seed: world.seed,
    edits: blob.sha256,      // the blob holding the edits
    blob: blob.url,
    servers,
  });

  const event = makeUnsignedEvent(WORLD_KIND, content, [["d", "ncraft.world"]]);
  // Re-encode edits inline for clients that prefer everything in the event.
  event.tags.push(["sha256", blob.sha256]);
  const signed = await signEvent(nostr, event);
  const ok = await publishToRelays(signed, relays);
  return { ok, event: signed, blob };
}

// ---- nsite (NIP-5A) --------------------------------------------------------

// Compute the NIP-5A aggregate hash over a set of `path` tags.
async function aggregateHash(pathTags) {
  const lines = pathTags.map(([, path, h]) => `${h} ${path}\n`);
  lines.sort();
  return sha256Hex(utf8ToBytes(lines.join("")));
}

// Upload every site file to Blossom and produce the signed kind-15128 manifest.
export async function publishSite({ nostr, pubkey, relays, servers, title, description, sourceUrl, origin }) {
  const pathTags = [];
  const base = (origin || location.origin).replace(/\/+$/, "");

  for (const rel of SITE_FILES) {
    const resp = await fetch(base + rel);
    if (!resp.ok) throw new Error(`Failed to read ${rel}: ${resp.status}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const mime = mimeFor(rel);
    const blob = await uploadToServers(servers, bytes, mime, nostr, pubkey);
    pathTags.push(["path", rel, blob.sha256]);
  }

  const x = await aggregateHash(pathTags);
  const tags = [
    ...pathTags,
    ["x", x, "aggregate"],
    ["title", title || "ncraft"],
  ];
  if (description) tags.push(["description", description]);
  if (sourceUrl) tags.push(["source", sourceUrl]);
  for (const s of servers) tags.push(["server", s]);

  const event = makeUnsignedEvent(NSITE_KIND, "", tags);
  const signed = await signEvent(nostr, event);
  const ok = await publishToRelays(signed, relays);
  return { ok, event: signed, aggregate: x };
}

// Publish (or refresh) the author's BUD-03 server list so gateways can resolve
// the blobs later.
export async function publishServerList({ nostr, pubkey, relays, servers }) {
  const event = makeUnsignedEvent(10063, "", servers.map((s) => ["server", s]));
  const signed = await signEvent(nostr, event);
  return publishToRelays(signed, relays);
}

function mimeFor(rel) {
  if (rel.endsWith(".html")) return "text/html";
  if (rel.endsWith(".css")) return "text/css";
  if (rel.endsWith(".js")) return "application/javascript";
  return "application/octet-stream";
}

export { downloadBlob };
