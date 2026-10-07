# ncraft

A self-hosted, Minecraft-style block world you run on your own VPS — with
identity, storage, and distribution built on Nostr, Blossom, nGit, and nsite.
No accounts, no app store, no external host: your node is the world.

## What it does

- **Voxel sandbox** — procedurally generated terrain, trees, water, and a
  place/break build system (three.js, rendered entirely in the browser).
- **Multiplayer** — a Node server keeps block state authoritative and syncs
  players over WebSocket, with persistent world saves on disk.
- **Nostr identity** — sign in with any NIP-07 extension; your npub is your
  player identity.
- **Blossom storage** — save/load and share worlds as content-addressed blobs.
- **nsite hosting** — publish the game itself as a static site served from
  Blossom via NIP-5A.
- **nGit source** — host and distribute the code itself over Nostr (NIP-34).

## Quick start (local)

```bash
git clone https://github.com/ChiefmonkeyArt/ncraft.git && cd ncraft
npm install --omit=dev
npm start
```

Then open <http://localhost:8080>. Install a NIP-07 extension (nos2x, Alby,
noStrudel) to sign in and use publishing.

## Run on your VPS

One line (systemd, no Docker required):

```bash
curl -fsSL https://raw.githubusercontent.com/ChiefmonkeyArt/ncraft/main/install.sh | bash
```

Or with Docker:

```bash
docker compose up -d --build
```

The game listens on port 8080. Put Caddy in front for TLS:

```caddyfile
your.domain {
    reverse_proxy 127.0.0.1:8080
}
```

The WebSocket endpoint lives at `/mp` on the same origin, so a plain
reverse proxy is all you need.

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `WNCRAFT_SEED` | `1337` | World-generation seed |
| `WNCRAFT_DATA` | `./data` | World persistence directory |

## Controls

| Action | Key |
|---|---|
| Move | `W` `A` `S` `D` |
| Up / down (fly) | `Space` / `Shift` |
| Jump | `Space` |
| Toggle fly | `F` |
| Break block | Left-click |
| Place block | Right-click |
| Select block | `1–8` or mouse wheel |

## Integrations

### Nostr (NIP-07)
Sign in from the browser. Your npub is shown in the player list and used to
sign every event below — no private key ever leaves your device.

### Blossom — share a world
Click **Publish world**. It serialises the seed + edits, uploads the snapshot
to Blossom, and publishes a `kind:30078` event under `d = "ncraft.world"`.
Anyone can rebuild your world from that event.

### nsite — publish the game itself
Click **Publish game**, or run:

```bash
NOSTR_NSEC=<hex> npm run publish:nsite
```

This uploads every asset to Blossom and publishes a NIP-5A `kind:15128`
manifest, so a gateway can serve the game at `<your-npub>.nsite.lol`.

### nGit — host the source over Nostr
Publish the repository itself over Nostr (NIP-34 / GRASP) alongside GitHub:

```bash
./scripts/publish-ngit.sh
```

This runs `ngit account login` → `ngit init --defaults` → `git push` →
`ngit repo`. Full dual-remote workflow in [docs/NGIT.md](docs/NGIT.md).

## Project layout

```
server/index.js        HTTP + WebSocket server, authoritative world state
public/                browser client (no build step)
  js/terrain.js        deterministic world gen + chunk meshing
  js/main.js           engine, controls, physics, multiplayer glue
  js/nostr.js          NIP-07 signer, NIP-98 auth, relay publish
  js/blossom.js        Blossom upload/download (BUD-01/BUD-02)
  js/publish.js        world (kind 30078) + nsite (kind 15128) publishing
scripts/publish-nsite.mjs   operator CLI for nsite publishing
docs/ARCHITECTURE.md   full design doc
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the protocol and trust
model.

## License

MIT — build on it, host your own, keep it sovereign.
