// ncraft — Blossom client: upload/download blobs against BUD-02/BUD-01, plus
// BUD-03 server-list handling. Signing is delegated to NIP-07 (no secrets here).

import { signHttpAuth, authHeader } from "./nostr.js";
import { sha256Hex, utf8ToBytes } from "./util.js";

// Default fallback servers (used only when the user has no BUD-03 list).
export const DEFAULT_SERVERS = [
  "https://blossom.nostr.me",
  "https://cdn.satellite.earth",
];

// Build a BUD-03 (kind 10063) user-server-list event.
export function serverListEvent(servers, createdAt) {
  const tags = servers.map((s) => ["server", s]);
  return { kind: 10063, content: "", tags, created_at: createdAt };
}

// Upload bytes to a single Blossom server. Returns the blob descriptor.
export async function uploadBlob(server, bytes, mime, nostr, pubkey) {
  const hex = await sha256Hex(bytes);
  const url = server.replace(/\/+$/, "") + "/upload";
  const auth = await signHttpAuth(nostr, url, "PUT", hex);

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHeader(auth),
      "Content-Type": mime || "application/octet-stream",
      "Content-Length": String(bytes.length),
      "X-SHA-256": hex,
    },
    body: bytes,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Blossom upload failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  return resp.json(); // { url, sha256, size, type, uploaded, ... }
}

// Upload to the first server that succeeds, in priority order.
export async function uploadToServers(servers, bytes, mime, nostr, pubkey) {
  let lastErr;
  for (const s of servers) {
    try {
      return await uploadBlob(s, bytes, mime, nostr, pubkey);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("No Blossom server accepted the upload");
}

// Download a blob by sha256, trying the servers in order.
export async function downloadBlob(servers, sha256) {
  let lastErr;
  for (const s of servers) {
    try {
      const resp = await fetch(s.replace(/\/+$/, "") + "/" + sha256, { mode: "cors" });
      if (resp.ok) return new Uint8Array(await resp.arrayBuffer());
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("Blob not found on any configured server");
}

// Convert Uint8Array -> { content, hex } for hashing + signing flows.
export function bytesToBlobParts(bytes, mime) {
  const content = new Blob([bytes], { type: mime || "application/octet-stream" });
  return content;
}

export { utf8ToBytes };
