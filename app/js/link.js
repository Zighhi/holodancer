// The link between the show windows (same site, same browser): the hologram window (hologram.html) is the master - it
// runs the audio, the analysis and the director - and sends the music state every frame plus every event to the
// other windows (projector.html) over a BroadcastChannel. Nothing leaves the laptop.
const CHANNEL = "holodancer";

export class ShowLink {
  constructor(role) {
    this.role = role;
    this.ch = new BroadcastChannel(CHANNEL);
    this.handlers = {};
    this.state = null;
    this.lastSeen = -1e9;
    this.ch.onmessage = ({ data: m }) => {
      if (m.type === "state") { this.state = m.state; this.lastSeen = performance.now(); }
      else if (m.type === "event") for (const f of this.handlers[m.name] || []) f(m.data);
    };
  }

  // master: the state of this frame (a plain object, cloned by the browser)
  send(state) { this.ch.postMessage({ type: "state", state }); }

  // master: an event; payloads are made plain data (no typed arrays, no functions)
  emit(name, data = {}) {
    let plain = {};
    try { plain = JSON.parse(JSON.stringify(data ?? {})); } catch { /* not serialisable: send the name only */ }
    this.ch.postMessage({ type: "event", name, data: plain });
  }

  // other windows
  on(name, f) { (this.handlers[name] ||= []).push(f); }
  get connected() { return performance.now() - this.lastSeen < 1500; }
}

// ---------------------------------------------------------------- the dashboard (dashboard.html, on the laptop screen)
// a message as it is (the browser clones it: an ImageData thumbnail is fine), not made plain like emit()
ShowLink.prototype.postRaw = function (name, data) { this.ch.postMessage({ type: "event", name, data }); };

// each show window reports to the dashboard twice a second: a small picture of what it shows + its info line
export class StatusReporter {
  constructor(link, role, canvas) {
    Object.assign(this, { link, role, canvas, last: 0 });
    this.c = document.createElement("canvas");
    this.c.width = 256; this.c.height = 144;
    this.g = this.c.getContext("2d", { willReadFrequently: true });
  }
  // call right after the frame is drawn (the canvas still holds it then)
  tick(text, extra = {}) {
    const now = performance.now();
    if (now - this.last < 500) return;
    this.last = now;
    try {
      this.g.drawImage(this.canvas, 0, 0, this.c.width, this.c.height);
      this.link.postRaw("status", { from: this.role, text, img: this.g.getImageData(0, 0, this.c.width, this.c.height), ...extra });
    } catch { /* no picture this time */ }
  }
}

// keys from the dashboard: they act as if pressed in this window ({ to: role, key, shift })
export function listenRemote(link, role) {
  link.on("key", ({ to, key, shift }) => {
    if (to === role) dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey: !!shift }));
  });
}
