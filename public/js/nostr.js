// ncraft — Nostr helpers: NIP-07 signer detection, event signing, and relay publish.

const NIP98_KIND = 27235;   // HTTP auth (NIP-98)
const WORLD_KIND = 30078;   // application data (NIP-78)
const NSITE_KIND = 15128;   // nsite root manifest (NIP-5A)

export function getNostr() {
  const n = window.nostr;
  return n && (n.getPublicKey && n.signEvent) ? n : null;
}

export async function getPubkey(nostr) {
  try { return await nostr.getPublicKey(); } catch { return null; }
}

// Build an unsigned event. `window.nostr.signEvent` fills id+sig.
export function makeUnsignedEvent(kind, content, tags = [], createdAt = Math.floor(Date.now() / 1000)) {
  return { kind, content, tags, created_at: createdAt };
}

export async function signEvent(nostr, event) {
  const signed = await nostr.signEvent({ ...event });
  return { ...event, id: signed.id, sig: signed.sig };
}

// Sign a NIP-98 HTTP-auth event for the given URL + method (+ optional body hash).
export async function signHttpAuth(nostr, url, method, payloadHex) {
  const tags = [["u", url], ["method", method]];
  if (payloadHex) tags.push(["payload", payloadHex]);
  const unsigned = makeUnsignedEvent(NIP98_KIND, "", tags);
  return signEvent(nostr, unsigned);
}

// Base64-encode a signed event for an `Authorization: Nostr <b64>` header.
export function authHeader(signedEvent) {
  return `Nostr ${btoa(JSON.stringify(signedEvent))}`;
}

// Publish a signed event to a set of relays; resolves when at least one relay
// accepts it (or rejects silently).
export async function publishToRelays(signedEvent, relays) {
  const results = await Promise.allSettled(
    relays.map((r) => publishOne(r, signedEvent))
  );
  const ok = results.some((r) => r.status === "fulfilled" && r.value);
  return ok;
}

function publishOne(relayUrl, signedEvent) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    let ws;
    try {
      ws = new WebSocket(relayUrl);
    } catch {
      finish(false);
      return;
    }
    const to = setTimeout(() => { try { ws.close(); } catch {} finish(false); }, 6000);
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify(["EVENT", signedEvent]));
        finish(true); // optimistic; receipt would need a longer window
        clearTimeout(to);
        try { ws.close(); } catch {}
      } catch { finish(false); }
    };
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
}

export { NIP98_KIND, WORLD_KIND, NSITE_KIND };
