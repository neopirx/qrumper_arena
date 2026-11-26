// WebSocket connection to the game server (/ws on the same host that served the page).
// Messages are small JSON objects { t: type, ... }; listeners subscribe per type.
export class Connection {
  constructor(url) {
    this.url = url || defaultUrl();
    this.handlers = new Map();
    this.ws = null;
    this.open = false;
    this.queue = [];
  }

  connect() {
    if (this.ws) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => { this.open = true; for (const m of this.queue) ws.send(m); this.queue = []; resolve(); };
      ws.onerror = () => { if (!this.open) reject(new Error('Could not reach the game server')); };
      ws.onclose = () => {
        const was = this.open;
        this.open = false; this.ws = null;
        if (!was) reject(new Error('Could not reach the game server'));
        this.emit('close', {});
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m && m.t) this.emit(m.t, m);
      };
    });
    return this.ready;
  }

  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); return () => this.handlers.get(type).delete(fn); }
  emit(type, m) { const hs = this.handlers.get(type); if (hs) for (const fn of [...hs]) fn(m); }

  send(obj) {
    const s = JSON.stringify(obj);
    if (this.open) this.ws.send(s);
    else this.queue.push(s);
  }

  close() { if (this.ws) this.ws.close(); }
}

function defaultUrl() {
  const l = globalThis.location;
  return (l.protocol === 'https:' ? 'wss://' : 'ws://') + l.host + '/ws';
}
