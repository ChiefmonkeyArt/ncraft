// ncraft — WebSocket client for the multiplayer server.

import { BASE } from "./base.js";

export class Net {
  constructor(url, handlers) {
    this.url = url;
    this.handlers = handlers;
    this.ws = null;
    this.connected = false;
    this.id = null;
  }

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = this.url || `${proto}://${location.host}${BASE}mp`;
    this.ws = new WebSocket(url);
    this.ws.addEventListener("open", () => {
      this.connected = true;
      this.handlers.onOpen && this.handlers.onOpen();
    });
    this.ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._route(msg);
    });
    this.ws.addEventListener("close", () => {
      this.connected = false;
      this.handlers.onClose && this.handlers.onClose();
    });
    this.ws.addEventListener("error", () => {
      this.handlers.onError && this.handlers.onError();
    });
  }

  _route(msg) {
    const h = this.handlers;
    switch (msg.type) {
      case "welcome": this.id = msg.id; h.onWelcome && h.onWelcome(msg); break;
      case "world": h.onWorld && h.onWorld(msg); break;
      case "players": h.onPlayers && h.onPlayers(msg); break;
      case "join": h.onJoin && h.onJoin(msg); break;
      case "leave": h.onLeave && h.onLeave(msg); break;
      case "move": h.onMove && h.onMove(msg); break;
      case "block": h.onBlock && h.onBlock(msg); break;
      case "chat": h.onChat && h.onChat(msg); break;
      case "system": h.onSystem && h.onSystem(msg); break;
    }
  }

  send(obj) {
    if (this.connected) this.ws.send(JSON.stringify(obj));
  }

  join(name, pubkey) {
    this.send({ type: "join", name, pubkey });
  }

  move(pos, rot) {
    this.send({ type: "move", pos, rot });
  }

  place(x, y, z, block) {
    this.send({ type: "place", x, y, z, block });
  }

  break_(x, y, z) {
    this.send({ type: "break", x, y, z });
  }

  chat(text) {
    this.send({ type: "chat", text });
  }
}
