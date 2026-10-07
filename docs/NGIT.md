# Source distribution: GitHub → nGit

ncraft treats GitHub as its current source of truth, with [ngit](https://ngit.dev)
(NIP-34 / GRASP) as the Nostr-native distribution path. Both can coexist as
remotes on the same checkout.

## Why both

- **GitHub** is the familiar collaboration surface (issues, PRs, CI) and today's
  canonical mirror.
- **ngit** hosts the repository itself on Nostr — the announcement (`ngit init`)
  is a signed event on relays, refs are signed state, and clones resolve over
  `nostr://` URLs. Any operator can mirror the source without a central account.

Publishing source over ngit is a **signed, identity-owning action**: it
promotes your source under whatever Nostr key you log in with. Choose the
identity you actually want to be the repository's publisher before you run it
(see `scripts/publish-ngit.sh`).

## One-line setup

```bash
./scripts/publish-ngit.sh
```

This runs, in order:

```bash
ngit account login    # or: ngit account create --name "chiefmonkey"
ngit init --name "ncraft" --description "self-hosted block world on nostr" --defaults
git push
ngit repo             # prints the nostr:// clone URL
```

After `ngit init --defaults`, the checkout has both remotes:

```bash
git remote -v
# origin  https://github.com/ChiefmonkeyArt/ncraft.git   (fetch/push)
# nostr   nostr://<host>/ncraft                           (fetch/push)
```

## Daily workflow

```bash
git commit -m "…"
git push origin main        # GitHub (source of truth)
git push nostr main         # ngit (Nostr distribution)
```

Both hosts stay in sync because ngit resolves refs from signed state and fetches
objects from whichever server is reachable.

## Cloning over Nostr

```bash
git clone nostr://<host>/ncraft
```

This is plain `git` — `git-remote-nostr` handles the `nostr://` URL. No ngit
subcommand is needed to clone.

## Notes

- Secrets stay out of the repo: `ngit account` stores the key in the OS
  credential store, never in `.git` config.
- Publishing world data and the game site uses a *separate* publishing path —
  Blossom + `kind:30078` for worlds and `kind:15128` for the nsite (see
  `docs/ARCHITECTURE.md`). The code repository (ngit) and the deployed game
  (nsite) are intentionally distinct publishing identities and flows.
