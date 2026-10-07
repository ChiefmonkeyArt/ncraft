#!/usr/bin/env bash
# ncraft — one-line VPS installer (systemd, no Docker required).
#
#   curl -fsSL https://raw.githubusercontent.com/ChiefmonkeyArt/ncraft/main/install.sh | bash
#
# Installs Node (if missing), fetches deps, and registers a systemd service
# that serves the game on port 8080. Put a reverse proxy (Caddy/nginx) in front
# to add TLS on port 443.

set -euo pipefail

APP_PORT="${PORT:-8080}"
APP_NAME="ncraft"
INSTALL_DIR="$(pwd)"
if [ -z "${NCRAFT_SKIP_DIR:-}" ] && [ "$(basename "$INSTALL_DIR")" != "$APP_NAME" ]; then
  # run from a clean checkout folder
  :
fi

info() { printf '\033[1;32m[ncraft]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[ncraft]\033[0m %s\n' "$*"; exit 1; }

# 1. Node 18+
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
else
  NODE_MAJOR=0
fi

if [ "$NODE_MAJOR" -lt 18 ]; then
  info "Installing Node.js 20…"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
  else
    err "Unsupported package manager. Install Node.js 18+ manually."
  fi
fi

# 2. Dependencies (runtime only)
info "Installing runtime dependencies…"
npm install --omit=dev

# 3. systemd unit
if command -v systemctl >/dev/null 2>&1; then
  UNIT="[Unit]
Description=ncraft block world
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
Environment=PORT=$APP_PORT
Environment=WNCRAFT_SEED=${WNCRAFT_SEED:-1337}
Environment=WNCRAFT_DATA=$INSTALL_DIR/data
ExecStart=$(command -v node) server/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
"
  sudo tee "/etc/systemd/system/$APP_NAME.service" >/dev/null <<<"$UNIT"
  sudo systemctl daemon-reload
  sudo systemctl enable --now "$APP_NAME"
  info "Service started. Status:"
  sudo systemctl --no-pager status "$APP_NAME" --lines=5 || true
else
  info "No systemd detected — starting in foreground instead:"
  PORT="$APP_PORT" node server/index.js
fi

info "Done. Game is live on http://<your-vps-ip>:$APP_PORT"
info "Put Caddy/nginx in front of port 80/443 to add TLS."
