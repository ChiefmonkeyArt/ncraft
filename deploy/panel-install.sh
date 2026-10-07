#!/usr/bin/env bash
# ncraft — install as a panel on an existing nginx host (chiefmonkey.art/ncraft).
# Idempotent: re-running updates the source (git pull) and restarts the service.
#
#   sudo bash deploy/panel-install.sh
#
# Configurable via env: NCRAFT_PORT (default 8888), NCRAFT_BASE_PATH (/ncraft),
# NGINX_FRAG (fragment destination), NGINX_RELOAD (reload command).

set -euo pipefail

REPO="https://github.com/ChiefmonkeyArt/ncraft.git"
INSTALL_DIR="/opt/ncraft"
PORT="${NCRAFT_PORT:-8888}"
NGINX_FRAG="${NGINX_FRAG:-/etc/nginx/conf.d/ncraft.conf}"

info() { printf '\033[1;32m[ncraft]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[ncraft]\033[0m %s\n' "$*"; exit 1; }

# 0. Node 18+
command -v node >/dev/null 2>&1 || err "Node.js 18+ required — install it first."

# 1. Dedicated unprivileged user
id -u ncraft >/dev/null 2>&1 || useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin ncraft

# 2. Clone or update source
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating source…"
  git -C "$INSTALL_DIR" pull --ff-only origin main
else
  info "Cloning source…"
  git clone "$REPO" "$INSTALL_DIR"
fi

# 3. Install runtime dependencies
info "Installing dependencies…"
( cd "$INSTALL_DIR" && npm install --omit=dev )

# 4. Ownership of runtime state
chown -R ncraft:ncraft "$INSTALL_DIR"

# 5. systemd unit
info "Installing systemd service on 127.0.0.1:$PORT…"
sed -e "s|Environment=PORT=.*|Environment=PORT=$PORT|" \
    -e "s|Environment=HOST=.*|Environment=HOST=127.0.0.1|" \
    "$INSTALL_DIR/deploy/ncraft.service" > /etc/systemd/system/ncraft.service
systemctl daemon-reload
systemctl enable --now ncraft
systemctl --no-pager status ncraft --lines=3 || true

# 6. nginx fragment
info "Dropping nginx fragment at $NGINX_FRAG…"
cp "$INSTALL_DIR/deploy/ncraft.nginx.conf" "$NGINX_FRAG"

# NOTE: This fragment is a `location` block that must live INSIDE your
# chiefmonkey.art `server {}`. If your host uses a fragments-include dir that
# nginx already globs, nothing else is needed. Otherwise, manually add:
#   include <path>/ncraft.conf;     # inside the chiefmonkey.art server block

if nginx -t 2>/dev/null; then
  nginx -s reload
  info "nginx reloaded."
else
  err "nginx -t failed — check your fragment placement and reload manually."
fi

info "Done. Panel live at:  https://chiefmonkey.art/ncraft/"
