// ncraft — resolve the mount base (with a trailing slash) from this module's
// URL. Works whether the game is served at the domain root ("/") or under a
// subpath such as "/ncraft/" — so assets and the multiplayer socket stay
// same-origin and base-aware like the other hosted panels.

export const BASE = new URL("..", import.meta.url).pathname;
