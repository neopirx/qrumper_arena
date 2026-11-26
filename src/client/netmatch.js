// Client side of a network match, independent of rendering (so tools/nettest.mjs can run it).
//
// The client keeps a mirror `Game` (same map, collision, items) that is never ticked; snapshots
// write into it, so the HUD and renderer read it exactly like an offline game.
//  - local player: predicted. Every 8 ms command runs pmove + jump pads / teleporters + weapon
//    timing locally right away. When a snapshot says which command the server applied last, the
//    authoritative state replaces ours and the commands still in flight are run again on top.
//    The visible difference is bled off over ~100 ms instead of popping.
//  - everyone else: interpolated INTERP seconds in the past between snapshots.
//  - rockets: extrapolated along their straight path to the present; grenades interpolated.
import { pmove } from '../sim/pmove.js';
import { weaponStep, touchMovers, TICK } from '../sim/game.js';
import { WEAPONS, WEAPON_ORDER, ITEMS } from '../sim/defs.js';
import { angleVectors, angleDiff } from '../sim/vec.js';

const INTERP = 0.075;
// events the client already produced itself for the local player
const PREDICTED = new Set(['jump', 'land', 'fall', 'step', 'walljump', 'jumppad', 'teleport', 'fire', 'switch', 'noammo']);
const clone = (o) => JSON.parse(JSON.stringify(o));

export class NetMatch {
  constructor(conn, game, myId) {
    this.conn = conn;
    this.game = game;
    this.myId = myId;
    this.me = null;
    this.seq = 0;
    this.pending = [];      // sent, not yet acknowledged
    this.outbox = [];       // not yet sent
    this.snaps = [];        // received, not yet applied
    this.history = [];      // applied snapshots for interpolation: { tm, pl: Map, pr: Map }
    this.offset = null;     // server time - local time (s)
    this.err = [0, 0, 0];   // prediction error being smoothed out
    this.lastSnapAt = 0;
    this.latestTm = 0;
    this.tl = 0;
    this.unsub = [conn.on('s', (m) => this.snaps.push({ ...m, at: now() }))];
  }

  dispose() { for (const u of this.unsub) u(); }

  setMe(p) { this.me = p; }

  serverNow() { return this.offset == null ? this.latestTm : now() + this.offset; }
  renderTime() { return this.serverNow() - INTERP; }

  // ---------- prediction ----------
  // one 8 ms command: queue it for the server and run it locally; returns events to present
  predict(cmd) {
    const c = {
      forward: cmd.forward, side: cmd.side, jump: !!cmd.jump, crouch: !!cmd.crouch, attack: !!cmd.attack,
      // rounded exactly as sent, so the server runs the very same numbers
      yaw: round2(cmd.yaw), pitch: round2(cmd.pitch), weapon: cmd.weapon || null, walljumpOnJump: cmd.walljumpOnJump !== false,
      seq: ++this.seq, time: (this.seq) * 8, vt: this.renderTime(),
    };
    this.pending.push(c);
    this.outbox.push(c);
    if (this.pending.length > 250) this.pending.shift();   // server unreachable: don't grow forever
    return this.step({ ...c }, true);
  }

  // the same per-command work the server does in playerThink, minus damage and pickups
  step(c, fresh) {
    const me = this.me, g = this.game, ps = me.ps;
    if (g.state === 'intermission') { c.forward = 0; c.side = 0; c.attack = false; c.jump = false; }
    if (!me.alive) {
      ps.dead = true;
      pmove(ps, { ...c, forward: 0, side: 0, jump: false }, TICK, g.col);
      ps.events.length = 0;
      return [];
    }
    me.prev = [...ps.origin];
    pmove(ps, c, TICK, g.col);
    const evs = fresh ? ps.events.map((e) => ({ ...e, player: me.id })) : [];
    ps.events.length = 0;
    const m = touchMovers(ps, c, g.pads, g.teles);
    if (fresh && m.pad) evs.push({ type: 'jumppad', player: me.id, pos: [...m.pad.at] });
    if (fresh && m.tele) evs.push({ type: 'teleport', player: me.id, from: m.from, to: [...ps.origin], yaw: m.tele.yaw });
    const w = weaponStep(me, c, TICK, g.state === 'playing');
    if (fresh) {
      if (w.switched) evs.push({ type: 'switch', player: me.id, weapon: me.weapon });
      if (w.result === 'noammo') evs.push({ type: 'noammo', player: me.id });
      if (w.result === 'fire') {
        const f = [0, 0, 0];
        angleVectors(ps.pitch, ps.yaw, f);
        const o = ps.origin, eye = [o[0], o[1] + ps.viewheight, o[2]];
        evs.push({ type: 'fire', player: me.id, weapon: me.weapon, pos: [eye[0] + f[0] * 14, eye[1] + f[1] * 14, eye[2] + f[2] * 14], dir: f, predicted: true });
      }
    }
    return evs;
  }

  // send queued commands (plus a couple of already-sent ones, in case a packet is lost)
  flush() {
    if (!this.outbox.length) return;
    const first = Math.max(0, this.pending.length - this.outbox.length - 2);
    const list = this.pending.slice(first).map((c) => [c.seq, c.forward, c.side, (c.jump ? 1 : 0) | (c.crouch ? 2 : 0) | (c.attack ? 4 : 0) | (c.walljumpOnJump ? 8 : 0), round2(c.yaw), round2(c.pitch), c.weapon ? WEAPON_ORDER.indexOf(c.weapon) + 1 : 0, round3(c.vt)]);
    this.conn.send({ t: 'c', c: list });
    this.outbox.length = 0;
  }

  // ---------- snapshots ----------
  // apply everything received since last frame; returns the server events to present, in order
  receive(callbacks = {}) {
    const out = [];
    if (!this.snaps.length) return out;
    const snaps = this.snaps;
    this.snaps = [];
    for (const s of snaps) {
      const c = s.c;
      // clock: track the fastest arrivals (least delayed), drift slowly otherwise
      const sample = c.tm - s.at;
      if (this.offset == null || sample > this.offset || Math.abs(sample - this.offset) > 1) this.offset = sample;
      else this.offset += (sample - this.offset) * 0.03;
      this.latestTm = c.tm;
      this.applyCommon(c, callbacks);
      this.reconcile(s.me);
      for (const e of c.ev) if (!(e.player === this.myId && PREDICTED.has(e.type))) out.push(e);
    }
    return out;
  }

  applyCommon(c, cb) {
    const g = this.game;
    g.state = c.st;
    this.tl = c.tl; this.tlAt = now();
    g.winner = c.win != null ? g.players.find((p) => p.id === c.win) || null : null;
    const pl = new Map();
    for (const a of c.pl) {
      pl.set(a[0], a);
      const p = g.players.find((x) => x.id === a[0]);
      if (!p) continue;
      p.frags = a[11]; p.deaths = a[12]; p.kills = a[13]; p.ping = a[14];
      if (p === this.me) continue;
      p.alive = !!(a[9] & 1);
      p.firing = !!(a[9] & 8);
      p.weapon = WEAPON_ORDER[a[10]] || 'mg';
    }
    const pr = new Map();
    for (const a of c.pr) pr.set(a[0], a);
    this.history.push({ tm: c.tm, pl, pr });
    while (this.history.length > 40) this.history.shift();
    // projectiles: create / drop mirror objects (positions are set per frame)
    const keep = [];
    for (const a of c.pr) {
      let o = g.projectiles.find((x) => x.id === a[0]);
      if (!o) o = { id: a[0], type: a[1] === 0 ? 'rocket' : 'grenade', pos: [a[2], a[3], a[4]], vel: [a[5], a[6], a[7]] };
      o.snap = a; o.snapTm = c.tm;
      o.vel = [a[5], a[6], a[7]];
      o.resting = !!a[8];
      keep.push(o);
    }
    g.projectiles = keep;
    // items: static ones by index, dropped weapons listed in full
    let i = 0;
    for (const it of g.items) if (!it.dropped) { it.active = c.it[i++] === '1'; }
    const dropIds = new Set(c.dr.map((d) => d[0]));
    g.items = g.items.filter((it) => !it.dropped || dropIds.has(it.id));
    for (const d of c.dr) {
      if (g.items.some((it) => it.id === d[0])) continue;
      g.items.push({ id: d[0], type: d[1], def: ITEMS[d[1]], pos: [d[2], d[3], d[4]], active: true, dropped: true });
    }
  }

  reconcile(m) {
    const me = this.me;
    if (!m || !me) return;
    const before = [...me.ps.origin], prevBefore = me.prev ? [...me.prev] : null;
    me.ps = { ...clone(m.ps), events: [] };
    for (const k of ['alive', 'health', 'armor', 'respawnAt', 'weapon', 'lastWeapon', 'weaponTime', 'switchTo', 'xp']) me[k] = m[k];
    me.weapons = { ...m.weapons }; me.ammo = { ...m.ammo };
    this.pending = this.pending.filter((c) => c.seq > m.seq);
    for (const c of this.pending) this.step({ ...c }, false);
    // hide small corrections: the view keeps where it was and slides to the truth
    const d = [before[0] - me.ps.origin[0], before[1] - me.ps.origin[1], before[2] - me.ps.origin[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    // (the replay leaves me.prev in the corrected frame; with nothing to replay, rebuild it)
    if (!this.pending.length || !me.alive) me.prev = prevBefore ? prevBefore.map((v, k) => v - d[k]) : [...me.ps.origin];
    if (len > 0.01 && len < 80) for (let k = 0; k < 3; k++) this.err[k] += d[k];
    else if (len >= 80) { this.err = [0, 0, 0]; me.prev = [...me.ps.origin]; }
    this.correction = len;
  }

  // decay of the smoothed prediction error; returns the offset to add to the view this frame
  errorOffset(dt) {
    const k = Math.exp(-dt * 12);
    for (let i = 0; i < 3; i++) this.err[i] *= k;
    return this.err;
  }

  timeLeft() { return Math.max(0, this.tl - (this.tlAt ? now() - this.tlAt : 0)); }

  // ---------- per frame: place everyone else ----------
  interpolate() {
    const g = this.game, H = this.history;
    if (!H.length) return;
    const rt = this.renderTime();
    let i = H.length - 1;
    while (i > 0 && H[i - 1].tm > rt) i--;
    const s0 = H[Math.max(0, i - 1)], s1 = H[i];
    const span = s1.tm - s0.tm;
    // past the newest snapshot: extrapolate a little, then hold
    const k = span > 0 ? Math.max(0, Math.min(1.5, (rt - s0.tm) / span)) : 1;
    for (const p of g.players) {
      if (p === this.me) continue;
      const b = s1.pl.get(p.id), a = s0.pl.get(p.id) || b;
      if (!b) continue;
      let t = k;
      const jump = Math.hypot(b[1] - a[1], b[2] - a[2], b[3] - a[3]);
      if (jump > 150) t = 1;   // respawn / teleport: don't slide across the map
      if (t > 1 && !(b[9] & 1)) t = 1;
      const pos = [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
      p.ps.origin = pos; p.prev = pos;
      p.ps.velocity = [b[4], b[5], b[6]];
      p.ps.yaw = a[7] + angleDiff(b[7], a[7]) * Math.min(1, t);
      p.ps.pitch = a[8] + (b[8] - a[8]) * Math.min(1, t);
      p.ps.onGround = !!(b[9] & 2);
      p.ps.ducked = !!(b[9] & 4);
    }
    // projectiles
    const sn = this.serverNow();
    for (const pr of g.projectiles) {
      const a = pr.snap;
      let pos;
      if (pr.type === 'rocket') {
        const dt = Math.max(0, Math.min(0.25, sn - pr.snapTm));
        pos = [a[2] + a[5] * dt, a[3] + a[6] * dt, a[4] + a[7] * dt];
      } else {
        const pa = s0.pr.get(pr.id), pb = s1.pr.get(pr.id);
        if (pa && pb) { const t = Math.min(1, k); pos = [pa[2] + (pb[2] - pa[2]) * t, pa[3] + (pb[3] - pa[3]) * t, pa[4] + (pb[4] - pa[4]) * t]; }
        else pos = [a[2], a[3], a[4]];
      }
      pr.pos = pos; pr.prev = pos;
    }
  }
}

const now = () => performance.now() / 1000;
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
// weapons the HUD might ask for
export const WEAPON_IDS = Object.keys(WEAPONS);
