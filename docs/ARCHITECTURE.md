# ncraft architecture

A self-hosted, browser-based block world with Nostr-native identity, storage, and
distribution. The design mirrors the "world-as-data" principle: a world is a
deterministic seed plus a set of signed, content-addressed edits.

## Layers

```
┌───────────────────────────────────────────────────────────────┐
│  Browser client (three.js)                                     │
│   terrain.js   → deterministic world + chunk meshes            │
│   main.js      → controls, physics, raycast, multiplayer glue   │
│   net.js       → WebSocket protocol                             │
│   nostr.js     → NIP-07 signer, NIP-98, event publishing        │
│   blossom.js   → BUD-01/BUD-02 blob upload + download           │
│   publish.js   → world (kind 30078) + nsite (kind 15128)        │
└───────────────────────────────┬───────────────────────────────┘
                                │ WebSocket (/mp) + HTTP (static)
┌───────────────────────────────▼───────────────────────────────┐
│  Node server (server/index.js)                                 │
│   - serves public/                                             │
│   - authoritative block state (edits map) + player presence    │
│   - persists edits to disk (data/world.json)                    │
└───────────────────────────────────────────────────────────────┘
        │ publish / read / host
┌───────┴────────────────────────────────────────────────────────┐
│  Nostr relays (events)  +  Blossom servers (blobs)             │
│   world snapshot   → blob (BUD-02) + kind 30078 (NIP-78)        │
│   game site        → blobs + kind 15128 manifest (NIP-5A/nsite) │
│   source code      → GRASP / ngit (NIP-34)                      │
└────────────────────────────────────────────────────────────────┘
```

## World model

- **Seed** (default `1337`) deterministically generates terrain, trees, and
  water via a seeded 2D value noise. Every node with the same seed sees the
  same base world.
- **Edits** are the only mutable state — a `Map` keyed `"x,y,z"` to a block id.
  The server is authoritative: it validates bounds, applies edits, broadcasts
  them to other clients, and persists them to `data/world.json`.
- Optimistic local edits: the editing client applies its own change immediately
  and sends it to the server; the server rebroadcasts to everyone *else* (no
  echo), so each edit is applied exactly once per client.

## Multiplayer protocol (JSON over WebSocket at `/mp`)

| Direction | Message |
|---|---|
| S→C | `{type:"welcome", id, seed, edits, players}` |
| C→S | `{type:"join", name, pubkey}` |
| C→S | `{type:"move", pos:[x,y,z], rot:[x,y]}` (throttled ~20 Hz) |
| S→C | `{type:"move", id, pos, rot}` · `{type:"join"/"leave", id, …}` |
| C→S | `{type:"place", x,y,z, block}` · `{type:"break", x,y,z}` |
| S→C | `{type:"block", x,y,z, block}` |
| C→S | `{type:"chat", text}` → `{type:"chat", id, text, name}` |

## Nostr integrations

### Identity (NIP-07)
The client signs in via `window.nostr` (an extension such as nos2x, Alby, or
noStrudel). The npub is used as the player's public identity and to sign every
Blossom/Nostr event. No secret key ever touches the server or the shipped code.

### Blossom (content-addressable storage)
- Upload: `PUT /upload` with `Authorization: Nostr <base64 NIP-98>` (event kind
  `27235`, `u`/`method`/`payload` tags) and an `X-SHA-256` header. Returns a
  blob descriptor `{url, sha256, size, type, uploaded}`.
- Download: `GET /<sha256>`.
- Discovery: the author's server list is kind `10063` (BUD-03), tags
  `[["server","<url>"]]`.

### World sharing (NIP-78)
"Publish world" serialises the seed + edits to a JSON blob, uploads it to
Blossom, and publishes a kind `30078` event under `d = "ncraft.world"` carrying
the seed and the content hash. Anyone can reconstruct the exact world from the
event + blob by seeding a new node.

### nsite (NIP-5A)
"Publish game" uploads every static file to Blossom and publishes a kind
`15128` root-site manifest whose `path` tags map each path to its SHA-256. An
`x` aggregate tag (hash of the sorted `path` lines) makes manifests comparable.
A NIP-5A gateway (e.g. nsite.lol / nsite.run) then serves the game from
`<npub>.nsite-host`. The `scripts/publish-nsite.mjs` CLI does the same for
operators comfortable with a dedicated Nostr key.

### nGit (NIP-34 / GRASP)
The source repository is hosted over Nostr. See the README for the exact
`ngit` workflow (`ngit account login` → `ngit init --defaults` → `git push`).

## Publishing trust boundaries

- Publishing is always a **signed, user-initiated action** — via NIP-07 in the
  browser, or an explicit `NOSTR_NSEC` for the optional CLI.
- The server never publishes on the player's behalf and never holds a signing
  key.
- Operators run their own node and publish with their own identity; nothing is
  deployed or pushed without the operator's own action.
