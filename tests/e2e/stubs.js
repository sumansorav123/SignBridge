// Test-only stand-ins, split into three parts by the marker comments (read by e2e.py).
// Nothing here is loaded by the real app.

//=== PEER ===
// Fake PeerJS: tabs of the same browser talk through a BroadcastChannel. Video is a coloured canvas.
(() => {
  const bc = new BroadcastChannel("sb-peer-stub");
  const peers = new Map(), conns = new Map(), calls = new Map(), waiting = new Map();
  const rid = () => Math.random().toString(36).slice(2);
  class Em {
    on(e, f) { (this.h ||= {})[e] = [...(this.h[e] || []), f]; return this; }
    emit(e, ...a) { (this.h?.[e] || []).forEach((f) => f(...a)); }
  }
  function fakeStream() {
    const c = document.createElement("canvas");
    c.width = 320; c.height = 240;
    const x = c.getContext("2d");
    let n = 0;
    setInterval(() => { x.fillStyle = `hsl(${(n++ * 7) % 360} 70% 50%)`; x.fillRect(0, 0, 320, 240); }, 100);
    return c.captureStream(10);
  }
  class DataConn extends Em {
    constructor(cid, peer, remote) { super(); this.connectionId = cid; this.peer = remote; this._p = peer; this.open = false; conns.set(cid, this); }
    send(d) { bc.postMessage({ k: "data", cid: this.connectionId, from: this._p.id, payload: d }); }
    close() { if (!this.open) return; this.open = false; bc.postMessage({ k: "close", cid: this.connectionId, from: this._p.id }); this.emit("close"); }
    _open() { if (this.open) return; this.open = true; this.emit("open"); }
  }
  class MediaConn extends Em {
    constructor(cid, peer, remote) { super(); this.connectionId = cid; this._p = peer; this.peer = remote; calls.set(cid, this); }
    answer(stream) { bc.postMessage({ k: "answer", cid: this.connectionId }); setTimeout(() => this.emit("stream", fakeStream()), 50); }
  }
  class Peer extends Em {
    constructor(id, opts) {
      super();
      if (id && typeof id === "object") id = undefined;
      this.id = id || "stub-" + rid();
      this.destroyed = false;
      setTimeout(() => {
        const nonce = rid();
        waiting.set(nonce, () => { waiting.delete(nonce); this.emit("error", { type: "unavailable-id", message: "ID is taken" }); });
        bc.postMessage({ k: "whois", id: this.id, nonce });
        setTimeout(() => {
          if (!waiting.has(nonce)) return;
          waiting.delete(nonce);
          peers.set(this.id, this);
          this.emit("open", this.id);
        }, 150);
      }, 0);
    }
    connect(id) {
      const cid = rid();
      const c = new DataConn(cid, this, id);
      c._timer = setTimeout(() => { if (!c.open) this.emit("error", { type: "peer-unavailable", message: "Could not connect to peer " + id }); }, 500);
      bc.postMessage({ k: "conn", cid, to: id, from: this.id });
      return c;
    }
    call(id, stream) {
      const cid = rid();
      const m = new MediaConn(cid, this, id);
      bc.postMessage({ k: "call", cid, to: id, from: this.id });
      return m;
    }
    reconnect() {}
    destroy() {
      this.destroyed = true;
      peers.delete(this.id);
      for (const c of conns.values()) if (c._p === this) c.close();
    }
  }
  bc.onmessage = ({ data: m }) => {
    if (m.k === "whois" && peers.has(m.id)) bc.postMessage({ k: "taken", nonce: m.nonce });
    else if (m.k === "taken") waiting.get(m.nonce)?.();
    else if (m.k === "conn" && peers.has(m.to)) {
      const peer = peers.get(m.to);
      const c = new DataConn(m.cid, peer, m.from);
      peer.emit("connection", c);
      c._open(); // real PeerJS: the receiver is open before any data can arrive
      bc.postMessage({ k: "ack", cid: m.cid });
    } else if (m.k === "ack") {
      const c = conns.get(m.cid);
      if (c) { clearTimeout(c._timer); c._open(); }
    } else if (m.k === "data") {
      const c = conns.get(m.cid);
      if (c && c._p.id !== m.from) c.emit("data", m.payload);
    } else if (m.k === "close") {
      const c = conns.get(m.cid);
      if (c && c._p.id !== m.from && c.open) { c.open = false; c.emit("close"); }
    } else if (m.k === "call" && peers.has(m.to)) {
      const peer = peers.get(m.to);
      peer.emit("call", new MediaConn(m.cid, peer, m.from));
    } else if (m.k === "answer") {
      const mc = calls.get(m.cid);
      if (mc) setTimeout(() => mc.emit("stream", fakeStream()), 50);
    }
  };
  window.Peer = Peer;
})();

//=== MEDIAPIPE ===
// Fake MediaPipe: "detected" hands are whatever the test put in window.__fakeHands.
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const HandLandmarker = {
  createFromOptions: async () => ({ detectForVideo: () => ({ landmarks: window.__fakeHands || [] }) }),
};

//=== INIT ===
// Runs before every page: speech stubs (defined with Object.defineProperty so they take effect)
// and a synthetic-hand builder (same geometry as tests/ai.test.mjs).
(() => {
  class FakeRec {
    start() { if (this._r) throw new DOMException("already started", "InvalidStateError"); this._r = true; window.__rec = this; }
    stop() { this._r = false; setTimeout(() => this.onend && this.onend(), 0); }
    abort() { this.stop(); }
  }
  for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
    Object.defineProperty(window, name, { value: FakeRec, configurable: true, writable: true });
  }
  window.__say = (text, isFinal = true) => {
    const r = window.__rec;
    if (!r || !r._r) throw new Error("not listening");
    r.onresult({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal, length: 1 }] });
  };
  window.__spoken = [];
  Object.defineProperty(window, "speechSynthesis", {
    value: { speak: (u) => window.__spoken.push(u.text), cancel() {}, getVoices: () => [] },
    configurable: true,
  });
  window.__fakeHands = [];
  window.__hand = (fingers, ox = 0, oy = 0, scale = 1) => {
    const pts = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9, z: 0 }));
    const set = (i, x, y) => (pts[i] = { x, y, z: 0 });
    set(0, 0.5, 0.9); set(9, 0.5, 0.65); set(17, 0.6, 0.8);
    [[6, 8, 0.45], [10, 12, 0.5], [14, 16, 0.55], [18, 20, 0.58]].forEach(([pip, tip, x], k) => {
      set(pip, x, 0.7);
      set(tip, x, fingers[k + 1] ? 0.5 : 0.8);
    });
    set(3, 0.4, 0.8);
    set(4, fingers[0] ? 0.28 : 0.5, 0.8);
    return pts.map((p) => ({ x: p.x * scale + ox, y: p.y * scale + oy, z: 0 }));
  };
})();
