#!/usr/bin/env bash
# ncraft — publish this source code over ngit (NIP-34 / GRASP) so the repository
# is hosted on Nostr, not just GitHub. Run once per operator, from the repo root.
#
# Requirements: `ngit` and `git-remote-nostr` on PATH. See docs/NGIT.md.

set -euo pipefail

if ! command -v ngit >/dev/null 2>&1; then
  echo "ngit CLI not found. Install it (and git-remote-nostr) from https://ngit.dev." >&2
  exit 1
fi

NAME="${NGIT_NAME:-ncraft}"
DESC="${NGIT_DESC:-A self-hosted Minecraft-style block world on Nostr}"
ACCT="${NGIT_ACCOUNT:-chiefmonkey}"

echo "==> 1/4  Nostr identity"
# Secrets go into the OS credential store, never into git config or this repo.
if ! ngit account login; then
  echo "==> No existing identity — creating one."
  ngit account create --name "$ACCT"
fi

echo "==> 2/4  Publishing repository announcement (creates the GRASP upstream)"
ngit init --name "$NAME" --description "$DESC" --defaults

echo "==> 3/4  Pushing current branch + signed state"
git push

echo "==> 4/4  Share URL"
ngit repo

echo
echo "Done. Clone it anywhere with:"
echo "  git clone nostr://<host>/$NAME"
