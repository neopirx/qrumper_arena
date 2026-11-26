// The player's profile (name, model, colour, XP, career stats). Stored on the game server in
// data/profiles.json; the browser keeps only the profile id (and a cached copy, used when the
// server's API is unreachable, e.g. a plain static build).
import { applyResult, levelInfo } from '../sim/xp.js';

const KEY = 'qrumper.profile.v1';

export class ProfileStore {
  constructor() {
    try { this.data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { this.data = null; }
    this.online = false;
    this.listeners = new Set();
  }

  get exists() { return !!(this.data && this.data.name); }
  get id() { return this.data && this.data.id; }
  get level() { return levelInfo(this.data ? this.data.xp : 0); }
  onChange(fn) { this.listeners.add(fn); }
  changed() { this.cache(); for (const fn of this.listeners) fn(this.data); }
  cache() { if (this.data) localStorage.setItem(KEY, JSON.stringify({ ...this.data, levelInfo: undefined })); }

  // load from the server; a stale id (server data wiped) is re-registered with the cached details
  async init() {
    try {
      if (this.id) {
        const r = await fetch(`/api/profile/${this.id}`);
        if (r.ok) { this.data = await r.json(); this.online = true; this.changed(); return; }
        if (r.status === 404 && this.exists) { await this.save({ ...this.data, id: undefined }, true); return; }
      } else {
        const r = await fetch('/api/health');
        this.online = r.ok;
      }
    } catch { this.online = false; }
  }

  async save({ name, character, color }, keepStats = false) {
    const body = { id: this.id, name, character, color };
    const local = { ...(this.data || {}), name, character, color };
    try {
      const r = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(r.status);
      const fresh = await r.json();
      // a re-registered profile keeps the stats we had cached
      if (keepStats && this.data) for (const k of ['xp', 'kills', 'deaths', 'matches', 'wins', 'badges']) if (this.data[k] != null && !fresh[k]) fresh[k] = this.data[k];
      this.data = fresh;
      this.online = true;
    } catch {
      this.data = local;
      this.online = false;
    }
    this.changed();
    return this.data;
  }

  // offline (bot) match finished: the server folds it in; without a server we do it locally
  async reportMatch(result) {
    if (!result) return null;
    if (this.id && this.online) {
      try {
        const r = await fetch(`/api/profile/${this.id}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
        if (r.ok) { const d = await r.json(); this.data = d.profile; this.changed(); return { profile: this.data, levelUp: d.levelUp }; }
      } catch { /* fall through */ }
    }
    if (!this.data) return null;
    const r = applyResult(this.data, result);
    this.data.levelInfo = levelInfo(this.data.xp);
    this.changed();
    return { profile: this.data, levelUp: r.levelUp };
  }

  // the multiplayer server sends the updated profile after a match
  setFromServer(p) { if (p && (!this.id || p.id === this.id)) { this.data = p; this.changed(); } }
}
