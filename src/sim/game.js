// Authoritative game simulation (FFA). Runs at a fixed tick; independent of rendering so it can
// later run on a server. Communicates with the client through `events`.
import { pmove, makePlayerState, applyKnockback, PLAYER_MINS, PLAYER_MAXS, PM } from './pmove.js';
import { CollisionWorld, MASK_SHOT, MASK_PLAYER, rayBox, ZERO } from './collision.js';
import { WEAPONS, WEAPON_ORDER, ITEMS, PLAYER_COLORS } from './defs.js';
import { angleVectors, normalize, dot, makeRng } from './vec.js';
import { XP } from './xp.js';

export const TICK = 1 / 125;
const GRAVITY = 800;  // g_gravity, same as pmove
export const GIB_HEALTH = -40;   // Q3 GIB_HEALTH: a kill that leaves the body this far below zero blows it apart
const MULTIKILL_WINDOW = 3;      // seconds between frags that still chain a multi kill (UT style)
const MULTI_AWARDS = [null, null, 'double', 'triple', 'quad', 'monster'];
const LAG_COMP_MAX = 0.3;        // seconds a remote player's hitscan may be rewound (unlagged)
const HITSCAN = new Set(['mg', 'sg', 'rg']);

let nextId = 1;

export class Game {
  constructor(map, opts = {}) {
    this.map = map;
    this.col = new CollisionWorld(map.brushes);
    this.time = 0;            // seconds
    this.players = [];
    this.projectiles = [];
    this.events = [];
    this.rng = makeRng(opts.seed || (Math.random() * 1e9) | 0);
    this.fraglimit = opts.fraglimit ?? 20;
    this.timelimit = (opts.timelimit ?? 10) * 60;
    this.state = 'warmup';    // warmup -> playing -> intermission
    this.warmup = opts.warmup ?? 3;
    this.doubleJump = !!opts.doubleJump;   // CPM double jump (match rule)
    this.posHist = [];        // [{ t, pos: Map(id -> origin) }] for lag compensation
    this.items = map.items.map((it, i) => {
      const def = ITEMS[it.t];
      return { id: i, type: it.t, def, pos: [it.at[0], it.at[1], it.at[2]], active: true, respawnAt: 0, dropped: false };
    });
    this.pads = map.jumppads.map((j) => ({ ...j, vel: launchVelocity(j) }));
    this.teles = map.teleporters;
    this.nav = null;
    this.winner = null;
  }

  emit(e) { this.events.push(e); }

  // remote: the player's commands arrive over the network into cmdQueue (one is used per tick)
  addPlayer({ name, bot = null, color, id = null, spawn = true, remote = false, character = null, level = 1, profileId = null }) {
    const p = {
      id: id ?? nextId++,
      name, character, level, profileId,
      remote, cmdQueue: [], lastSeq: 0,
      kills: 0, xp: 0, badges: {},
      color: color ?? PLAYER_COLORS[this.players.length % PLAYER_COLORS.length],
      ps: makePlayerState(),
      alive: false,
      health: 0, armor: 0,
      weapons: {}, ammo: {}, weapon: 'mg', weaponTime: 0, switchTo: null, lastWeapon: 'mg',
      frags: 0, deaths: 0,
      respawnAt: 0,
      cmd: { forward: 0, side: 0, jump: false, crouch: false, attack: false, pitch: 0, yaw: 0, weapon: null, time: 0 },
      bot: null,
      decayTimer: 0,
      lastPadTime: -1,
      lastHurtBy: null, lastHurtTime: -10,
      firing: false,
      spawnTime: 0,
      history: [],
      // awards: multi kill chain, consecutive rail hits, who fragged us last (revenge)
      lastKillTime: -10, multi: 0, railStreak: 0, nemesis: null, deathStreak: 0,
    };
    if (p.id >= nextId) nextId = p.id + 1;
    this.players.push(p);
    if (bot) p.bot = bot(p, this);
    if (spawn) this.spawn(p);
    return p;
  }

  removePlayer(p) {
    this.players = this.players.filter((x) => x !== p);
    for (const o of this.players) { if (o.nemesis === p.id) o.nemesis = null; if (o.lastHurtBy === p) o.lastHurtBy = null; }
    this.emit({ type: 'leave', player: p.id });
  }

  // a badge / XP line for the frag feed and the end-of-match tally
  award(p, kind, extra = {}) {
    const xp = XP.awards[kind] || 0;
    p.xp += xp;
    p.badges[kind] = (p.badges[kind] || 0) + 1;
    this.emit({ type: 'award', player: p.id, award: kind, xp, ...extra });
  }

  selectSpawn(p) {
    const spawns = this.map.spawns;
    const scored = spawns.map((s) => {
      let d = 1e9;
      for (const o of this.players) if (o !== p && o.alive) d = Math.min(d, Math.hypot(o.ps.origin[0] - s.at[0], o.ps.origin[1] - s.at[1], o.ps.origin[2] - s.at[2]));
      return { s, d };
    }).sort((a, b) => b.d - a.d);
    const half = Math.max(1, Math.ceil(scored.length / 2));
    return scored[Math.floor(this.rng() * half)].s;
  }

  spawn(p) {
    const s = this.selectSpawn(p);
    const ps = makePlayerState();
    ps.origin = [s.at[0], s.at[1] + 24 + 1, s.at[2]];
    ps.yaw = s.yaw; ps.pitch = 0;
    ps.doubleJump = this.doubleJump;
    p.ps = ps;
    p.cmd.yaw = s.yaw; p.cmd.pitch = 0;
    p.alive = true;
    p.health = 125; p.armor = 0;
    p.weapons = { mg: true }; p.ammo = { mg: 100, sg: 0, gl: 0, rl: 0, rg: 0 };
    p.weapon = 'mg'; p.lastWeapon = 'mg'; p.weaponTime = 250; p.switchTo = null;
    p.decayTimer = 0;
    p.spawnTime = this.time;
    p.history.length = 0;
    this.telefrag(p);
    this.emit({ type: 'spawn', player: p.id, pos: [...ps.origin], yaw: s.yaw });
    if (p.bot) p.bot.onSpawn();
  }

  telefrag(p) {
    for (const o of this.players) {
      if (o === p || !o.alive) continue;
      if (boxesOverlap(p.ps.origin, p.ps.mins, p.ps.maxs, o.ps.origin, o.ps.mins, o.ps.maxs)) {
        this.damage(o, p, [0, 1, 0], o.ps.origin, 100000, 'telefrag', true);
      }
    }
  }

  tick() {
    const dt = TICK;
    this.time += dt;
    if (this.state === 'warmup') {
      // 3 · 2 · 1 announcer countdown over the last seconds of warmup
      const left = Math.ceil(this.warmup - this.time);
      if (left >= 1 && left <= 3 && left !== this.lastCount) { this.lastCount = left; this.emit({ type: 'countdown', n: left }); }
    }
    if (this.state === 'warmup' && this.time >= this.warmup) {
      this.state = 'playing';
      this.startTime = this.time;
      this.emit({ type: 'fight' });
    }
    for (const p of [...this.players]) {
      if (p.bot && this.state !== 'intermission') p.bot.think(dt);
      if (p.remote) this.remoteThink(p, dt);
      else this.playerThink(p, dt);
    }
    this.runProjectiles(dt);
    this.runItems();
    if (this.state === 'playing') this.checkRules();
    // where everyone stood this tick, for rewinding remote players' hitscan shots
    const pos = new Map();
    for (const p of this.players) if (p.alive) pos.set(p.id, [...p.ps.origin]);
    this.posHist.push({ t: this.time, pos });
    if (this.posHist.length > Math.ceil(LAG_COMP_MAX / TICK) + 4) this.posHist.shift();
  }

  // Network player: run exactly one queued command per tick, so the client's prediction (which runs
  // the same pmove once per command) matches. A backlog (packet bunching) is drained a little faster;
  // with no command queued the player simply doesn't move this tick (Q3 ClientThink behaviour).
  remoteThink(p, dt) {
    const q = p.cmdQueue;
    let n = q.length > 6 ? 2 : 1;
    if (q.length > 40) q.splice(0, q.length - 8);   // hopelessly behind (tab was hidden): skip ahead
    while (n-- > 0 && q.length) {
      const c = q.shift();
      Object.assign(p.cmd, c);
      p.lastSeq = c.seq;
      this.playerThink(p, dt);
    }
  }

  playerThink(p, dt) {
    let cmd = p.cmd;
    if (!p.remote) cmd.time = this.time * 1000;
    if (this.state === 'intermission') cmd = intermissionCmd(cmd);
    if (!p.alive) {
      p.ps.dead = true;
      pmove(p.ps, { ...cmd, forward: 0, side: 0, jump: false }, dt, this.col);
      p.ps.events.length = 0;
      const canRespawn = this.time >= p.respawnAt && this.state !== 'intermission';
      if (canRespawn && (p.bot || cmd.attack || cmd.jump || this.time >= p.respawnAt + 3)) this.spawn(p);
      return;
    }
    pmove(p.ps, cmd, dt, this.col);
    // pmove events
    for (const e of p.ps.events) {
      if (e.type === 'fall') { this.damage(p, null, [0, 1, 0], p.ps.origin, e.damage, 'falling', false); this.emit({ type: 'fall', player: p.id, damage: e.damage }); }
      else this.emit({ ...e, player: p.id });
    }
    p.ps.events.length = 0;
    if (!p.alive) return;

    // record history (bots use it for reaction delay)
    p.history.push({ t: this.time, o: [...p.ps.origin], v: [...p.ps.velocity] });
    if (p.history.length > 90) p.history.shift();

    this.touchTriggers(p);
    this.weaponThink(p, dt);

    // Q3: health / armor above 100 counts down once per second
    p.decayTimer += dt;
    if (p.decayTimer >= 1) {
      p.decayTimer -= 1;
      if (p.health > 100) p.health--;
      if (p.armor > 100) p.armor--;
    }
    // out of the world
    if (p.ps.origin[1] < this.map.bounds.min[1] - 200) this.damage(p, null, [0, 1, 0], p.ps.origin, 100000, 'void', false);
    // slime / lava: Q3 style, damage in pulses while the feet are in the volume
    if (p.alive && this.map.hazards && this.map.hazards.length) {
      const o = p.ps.origin, fy = o[1] + p.ps.mins[1] + 2;
      let hz = null;
      for (const h of this.map.hazards) if (o[0] > h.min[0] && o[0] < h.max[0] && o[2] > h.min[2] && o[2] < h.max[2] && fy > h.min[1] && fy < h.max[1]) hz = h;
      if (hz) {
        p.hazardT = (p.hazardT ?? 0) - dt;
        if (p.hazardT <= 0) { p.hazardT = 0.5; this.damage(p, null, [0, 1, 0], o, Math.round(hz.dmg * 0.5), hz.mod, false); }
      } else p.hazardT = 0;
    }
  }

  touchTriggers(p) {
    const ps = p.ps;
    const m = touchMovers(ps, p.cmd, this.pads, this.teles);
    if (m.pad) this.emit({ type: 'jumppad', player: p.id, pos: [...m.pad.at] });
    if (m.tele) {
      this.emit({ type: 'teleport', player: p.id, from: m.from, to: [...ps.origin], yaw: m.tele.yaw });
      this.telefrag(p);
      if (p.bot) p.bot.onTeleport();
    }
    const amin = [ps.origin[0] + ps.mins[0], ps.origin[1] + ps.mins[1], ps.origin[2] + ps.mins[2]];
    const amax = [ps.origin[0] + ps.maxs[0], ps.origin[1] + ps.maxs[1], ps.origin[2] + ps.maxs[2]];
    for (const it of this.items) {
      if (!it.active) continue;
      const imin = [it.pos[0] - 15, it.pos[1], it.pos[2] - 15], imax = [it.pos[0] + 15, it.pos[1] + 30, it.pos[2] + 15];
      if (!aabb(amin, amax, imin, imax)) continue;
      if (this.pickup(p, it)) {
        if (it.dropped) { this.items = this.items.filter((x) => x !== it); }
        else { it.active = false; it.respawnAt = this.time + it.def.respawn; }
        this.emit({ type: 'pickup', player: p.id, item: it.type, itemId: it.id, pos: [...it.pos] });
      }
    }
  }

  pickup(p, it) {
    const d = it.def;
    if (d.kind === 'health') {
      if (d.max === 100 && p.health >= 100) return false;
      if (p.health >= 200) return false;
      p.health = Math.min(d.max, p.health + d.amount);
      if (it.type === 'mh') p.health = Math.min(200, p.health);
      return true;
    }
    if (d.kind === 'armor') {
      if (p.armor >= d.max) return false;
      p.armor = Math.min(d.max, p.armor + d.amount);
      return true;
    }
    if (d.kind === 'weapon') {
      const w = WEAPONS[d.weapon];
      const had = p.weapons[d.weapon];
      p.weapons[d.weapon] = true;
      const amount = it.dropped ? it.ammo : w.pickupAmmo;
      p.ammo[d.weapon] = Math.min(w.maxAmmo, Math.max(p.ammo[d.weapon], 0) + amount);
      // Q3: auto switch to a newly picked up weapon if it's "better"
      if (!had && p.autoSwitch !== false && WEAPON_ORDER.indexOf(d.weapon) > WEAPON_ORDER.indexOf(p.weapon) && !p.firing) p.switchTo = d.weapon;
      return true;
    }
    if (d.kind === 'ammo') {
      const w = WEAPONS[d.weapon];
      if (p.ammo[d.weapon] >= w.maxAmmo) return false;
      p.ammo[d.weapon] = Math.min(w.maxAmmo, p.ammo[d.weapon] + d.amount);
      return true;
    }
    return false;
  }

  runItems() {
    for (const it of this.items) {
      if (it.dropped && this.time > it.expire) { this.items = this.items.filter((x) => x !== it); this.emit({ type: 'itemgone', itemId: it.id }); break; }
      if (!it.active && this.time >= it.respawnAt) {
        it.active = true;
        this.emit({ type: 'respawnitem', item: it.type, itemId: it.id, pos: [...it.pos] });
      }
    }
  }

  // ---------------- weapons ----------------
  weaponThink(p, dt) {
    const r = weaponStep(p, p.cmd, dt, this.state === 'playing');
    if (r.switched) this.emit({ type: 'switch', player: p.id, weapon: p.weapon });
    if (r.result === 'noammo') this.emit({ type: 'noammo', player: p.id });
    else if (r.result === 'fire') {
      const w = WEAPONS[p.weapon];
      const rw = HITSCAN.has(w.id) ? this.rewind(p) : null;
      this.fire(p, w);
      if (rw) this.unrewind(rw);
    }
  }

  // Unlagged: move everyone else back to where this remote player saw them when they fired
  // (cmd.vt = the server time their client was rendering). Returns what to restore.
  rewind(p) {
    if (!p.remote || p.cmd.vt == null || !this.posHist.length) return null;
    const t = Math.max(this.time - LAG_COMP_MAX, Math.min(this.time, p.cmd.vt));
    if (this.time - t < TICK * 0.5) return null;
    const H = this.posHist;
    let i = H.length - 1;
    while (i > 0 && H[i - 1].t > t) i--;
    const a = H[Math.max(0, i - 1)], b = H[i];
    const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
    const saved = [];
    for (const o of this.players) {
      if (o === p || !o.alive) continue;
      const pa = a.pos.get(o.id), pb = b.pos.get(o.id);
      if (!pa || !pb) continue;
      // don't drag someone back across a teleport / respawn
      if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]) > 120) continue;
      saved.push([o, o.ps.origin]);
      o.ps.origin = [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k];
    }
    return saved;
  }
  unrewind(saved) { for (const [o, org] of saved) o.ps.origin = org; }

  eye(p) { return [p.ps.origin[0], p.ps.origin[1] + p.ps.viewheight, p.ps.origin[2]]; }

  fire(p, w) {
    const f = [0, 0, 0], r = [0, 0, 0], u = [0, 0, 0];
    angleVectors(p.ps.pitch, p.ps.yaw, f, r, u);
    const eye = this.eye(p);
    const muzzle = [eye[0] + f[0] * 14, eye[1] + f[1] * 14, eye[2] + f[2] * 14];
    this.emit({ type: 'fire', player: p.id, weapon: w.id, pos: muzzle, dir: [...f] });
    if (w.id === 'mg') {
      const ang = this.rng() * Math.PI * 2;
      const sr = Math.cos(ang) * this.rng.crandom() * w.spread * 16, su = Math.sin(ang) * this.rng.crandom() * w.spread * 16;
      const end = [eye[0] + f[0] * 131072 + r[0] * sr + u[0] * su, eye[1] + f[1] * 131072 + r[1] * sr + u[1] * su, eye[2] + f[2] * 131072 + r[2] * sr + u[2] * su];
      this.bullet(p, eye, end, w.damage, 'mg');
    } else if (w.id === 'sg') {
      const hits = new Map();
      for (let i = 0; i < w.pellets; i++) {
        const sr = this.rng.crandom() * w.spread * 16, su = this.rng.crandom() * w.spread * 16;
        const end = [eye[0] + f[0] * 131072 + r[0] * sr + u[0] * su, eye[1] + f[1] * 131072 + r[1] * sr + u[1] * su, eye[2] + f[2] * 131072 + r[2] * sr + u[2] * su];
        this.bullet(p, eye, end, w.damage, 'sg', hits);
      }
      for (const [t, dmg] of hits) this.damage(t, p, f, t.ps.origin, dmg, 'sg', true);
    } else if (w.id === 'rg') {
      this.rail(p, eye, f, w);
    } else if (w.projectile) {
      // grenades are lobbed: Q3 tilts the launch direction up (forward[2] += 0.2) before normalizing
      const d = w.projectile === 'grenade' ? [f[0], f[1] + 0.2, f[2]] : f;
      if (d !== f) normalize(d, d);
      const vel = [d[0] * w.speed, d[1] * w.speed, d[2] * w.speed];
      this.projectiles.push({
        id: nextId++, type: w.projectile, owner: p, pos: muzzle, vel,
        born: this.time, w, prestep: 0.05, dead: false, gravity: w.projectile === 'grenade', resting: false,
      });
      this.emit({ type: 'projectile', id: nextId - 1, kind: w.projectile, pos: [...muzzle], vel: [...vel], owner: p.id });
    }
  }

  // Trace a line against world and players. Returns { frac, point, normal, player }.
  traceShot(start, end, ignore, ignoreSet) {
    const tr = this.col.trace(start, end, ZERO, ZERO, MASK_SHOT);
    let frac = tr.fraction, hitP = null;
    const dir = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    for (const o of this.players) {
      if (o === ignore || !o.alive || (ignoreSet && ignoreSet.has(o))) continue;
      const bmin = [o.ps.origin[0] + o.ps.mins[0], o.ps.origin[1] + o.ps.mins[1], o.ps.origin[2] + o.ps.mins[2]];
      const bmax = [o.ps.origin[0] + o.ps.maxs[0], o.ps.origin[1] + o.ps.maxs[1], o.ps.origin[2] + o.ps.maxs[2]];
      const t = rayBox(start, dir, 1, bmin, bmax);
      if (t >= 0 && t < frac) { frac = t; hitP = o; }
    }
    return {
      frac, player: hitP,
      point: [start[0] + dir[0] * frac, start[1] + dir[1] * frac, start[2] + dir[2] * frac],
      normal: hitP ? null : [...tr.normal],
      sky: !hitP && tr.fraction >= 1,
    };
  }

  bullet(p, start, end, dmg, mod, accum) {
    const h = this.traceShot(start, end, p);
    if (h.player) {
      if (accum) accum.set(h.player, (accum.get(h.player) || 0) + dmg);
      else {
        const d = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]; normalize(d, d);
        this.damage(h.player, p, d, h.point, dmg, mod, true);
      }
      this.emit({ type: 'blood', pos: h.point, player: p.id, from: [...start], kind: mod });
    } else if (!h.sky) {
      this.emit({ type: 'impact', kind: mod, pos: h.point, normal: h.normal, player: p.id, from: [...start] });
    }
  }

  rail(p, eye, f, w) {
    const end = [eye[0] + f[0] * 8192, eye[1] + f[1] * 8192, eye[2] + f[2] * 8192];
    const hitSet = new Set();
    let last;
    for (let i = 0; i < 5; i++) {
      const h = this.traceShot(eye, end, p, hitSet);
      last = h;
      if (!h.player) break;
      hitSet.add(h.player);
    }
    // precision: two rail shots in a row that both connect (Q3 "impressive")
    if (hitSet.size) { if (++p.railStreak >= 2) { p.railStreak = 0; this.award(p, 'precision'); } }
    else p.railStreak = 0;
    for (const t of hitSet) {
      // where the slug entered this body (for headshots)
      const o = t.ps.origin;
      const k = rayBox(eye, [end[0] - eye[0], end[1] - eye[1], end[2] - eye[2]], 1, [o[0] + t.ps.mins[0], o[1] + t.ps.mins[1], o[2] + t.ps.mins[2]], [o[0] + t.ps.maxs[0], o[1] + t.ps.maxs[1], o[2] + t.ps.maxs[2]]);
      const at = k >= 0 ? [eye[0] + (end[0] - eye[0]) * k, eye[1] + (end[1] - eye[1]) * k, eye[2] + (end[2] - eye[2]) * k] : [...o];
      this.damage(t, p, f, at, w.damage, 'rg', true);
    }
    const muzzle = [eye[0] + f[0] * 14 + 0, eye[1] + f[1] * 14 - 4, eye[2] + f[2] * 14];
    this.emit({ type: 'rail', player: p.id, start: muzzle, end: last.point, normal: last.normal, color: p.color, hitWall: !last.sky });
  }

  runProjectiles(dt) {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      const step = dt + pr.prestep;
      pr.prestep = 0;
      if (pr.gravity && this.time - pr.born >= pr.w.fuse) { this.explode(pr, [...pr.pos], null, [0, 1, 0]); continue; }
      if (pr.resting) continue;
      if (pr.gravity) pr.vel[1] -= GRAVITY * step;
      const end = [pr.pos[0] + pr.vel[0] * step, pr.pos[1] + pr.vel[1] * step, pr.pos[2] + pr.vel[2] * step];
      // the owner can be hit by their own grenade once it has bounced around for a moment
      const h = this.traceShot(pr.pos, end, pr.gravity && this.time - pr.born > 0.25 ? null : pr.owner);
      if (h.frac < 1 && pr.gravity && !h.player && !h.sky) { this.bounce(pr, h); continue; }
      if (h.frac < 1) {
        // back off a little from the surface
        const v = [...pr.vel]; normalize(v, v);
        const pos = [h.point[0] - v[0] * 1, h.point[1] - v[1] * 1, h.point[2] - v[2] * 1];
        if (h.sky) { pr.dead = true; this.emit({ type: 'projgone', id: pr.id }); continue; }
        this.explode(pr, pos, h.player, h.normal);
        continue;
      }
      pr.pos = end;
      if (this.time - pr.born > 10) { pr.dead = true; this.emit({ type: 'projgone', id: pr.id }); }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  // Q3 G_BounceMissile with EF_BOUNCE_HALF: reflect, keep 65%, come to rest on floors when slow
  bounce(pr, h) {
    pr.bounces = (pr.bounces || 0) + 1;
    const n = h.normal, v = pr.vel;
    const vn = dot(v, n);
    for (let i = 0; i < 3; i++) v[i] = (v[i] - 2 * vn * n[i]) * 0.65;
    pr.pos = [h.point[0] + n[0] * 1.5, h.point[1] + n[1] * 1.5, h.point[2] + n[2] * 1.5];
    const speed = Math.hypot(v[0], v[1], v[2]);
    if (n[1] > 0.2 && speed < 40) { pr.resting = true; pr.vel = [0, 0, 0]; }
    if (Math.abs(vn) > 60) this.emit({ type: 'bounce', id: pr.id, pos: [...pr.pos], speed: Math.abs(vn) });
  }

  explode(pr, pos, direct, normal) {
    pr.dead = true;
    const w = pr.w;
    this.hitCtx = { bounced: pr.type === 'grenade' && pr.bounces > 0 };
    if (direct) {
      const d = [...pr.vel]; normalize(d, d);
      this.damage(direct, pr.owner, d, pos, w.damage, pr.type === 'rocket' ? 'rl' : 'gl', true);
    }
    this.radiusDamage(pos, pr.owner, w.splash, w.radius, direct, pr.type === 'rocket' ? 'rl_splash' : 'gl_splash');
    this.hitCtx = null;
    this.emit({ type: 'explode', id: pr.id, kind: pr.type, pos, normal: normal || null, hitPlayer: !!direct });
  }

  radiusDamage(origin, attacker, dmg, radius, ignore, mod) {
    for (const t of this.players) {
      if (!t.alive || t === ignore) continue;
      const o = t.ps.origin;
      let d2 = 0;
      for (let i = 0; i < 3; i++) {
        const mn = o[i] + t.ps.mins[i], mx = o[i] + t.ps.maxs[i];
        const v = origin[i] < mn ? mn - origin[i] : origin[i] > mx ? origin[i] - mx : 0;
        d2 += v * v;
      }
      const dist = Math.sqrt(d2);
      if (dist >= radius) continue;
      const points = dmg * (1 - dist / radius);
      if (!this.canDamage(t, origin)) continue;
      const dir = [o[0] - origin[0], o[1] - origin[1] + 24, o[2] - origin[2]];
      normalize(dir, dir);
      this.damage(t, attacker, dir, origin, points, mod, true);
    }
  }

  canDamage(t, origin) {
    const o = t.ps.origin;
    const pts = [[0, 0, 0], [15, 0, 15], [-15, 0, 15], [15, 0, -15], [-15, 0, -15]];
    for (const q of pts) if (this.col.visible(origin, [o[0] + q[0], o[1] + q[1], o[2] + q[2]])) return true;
    return false;
  }

  // Q3 G_Damage
  damage(targ, attacker, dir, point, dmg, mod, knock) {
    if (!targ.alive) return;
    if (this.state === 'intermission') return;
    let damage = Math.floor(dmg);
    if (damage < 1) damage = 1;
    let knockback = damage;
    if (knockback > 200) knockback = 200;
    targ.lastHitDir = null;
    if (dir) { const d = [...dir]; normalize(d, d); targ.lastHitDir = d; }
    // badge context for a killing blow: a hitscan hit in the top of the hull, a grenade that bounced
    targ.lastHitHead = (mod === 'rg' || mod === 'mg') && !!point && point[1] >= targ.ps.origin[1] + targ.ps.maxs[1] - 12;
    targ.lastHitBounced = !!(this.hitCtx && this.hitCtx.bounced);
    if (knock && dir) {
      const d = [...dir]; normalize(d, d);
      applyKnockback(targ.ps, d, knockback);
    }
    if (attacker === targ) damage = Math.max(1, Math.floor(damage * 0.5));
    // armor absorbs 2/3
    let save = Math.ceil(damage * 0.66);
    if (save >= targ.armor) save = targ.armor;
    if (mod === 'falling' || mod === 'void' || mod === 'telefrag' || mod === 'lava') save = 0;
    targ.armor -= save;
    const take = damage - save;
    targ.health -= take;
    if (attacker && attacker !== targ) {
      targ.lastHurtBy = attacker; targ.lastHurtTime = this.time;
      this.emit({ type: 'hit', attacker: attacker.id, target: targ.id, damage, mod });
    }
    this.emit({ type: 'pain', player: targ.id, damage, health: targ.health, from: attacker ? [...attacker.ps.origin] : null, mod, dir: dir ? [...targ.lastHitDir] : null, point: point ? [...point] : null });
    if (targ.bot) targ.bot.onDamage(attacker, damage);
    if (targ.health <= 0) this.kill(targ, attacker, mod);
  }

  kill(targ, attacker, mod) {
    targ.alive = false;
    targ.ps.dead = true;
    targ.deaths++;
    targ.respawnAt = this.time + 1.7;
    let killer = attacker;
    if (!killer || killer === targ) {
      // Suicides (and environmental deaths shortly after being hit) — Q3 counts world kills as -1
      if ((mod === 'falling' || mod === 'void' || mod === 'slime' || mod === 'lava') && targ.lastHurtBy && this.time - targ.lastHurtTime < 3 && targ.lastHurtBy !== targ) {
        killer = targ.lastHurtBy; killer.frags++; killer.kills++;
      } else { targ.frags--; killer = null; }
    } else { killer.frags++; killer.kills++; }
    targ.multi = 0;
    // died N times in a row without fragging anyone: the announcer rubs it in every third death
    if (++targ.deathStreak % 3 === 0 && this.state === 'playing') this.emit({ type: 'award', player: targ.id, award: 'deathstreak', xp: 0 });
    const gib = targ.health <= GIB_HEALTH;
    if (killer && killer !== targ) {
      // multi kills chain while frags keep coming within the window (UT)
      killer.multi = this.time - killer.lastKillTime <= MULTIKILL_WINDOW ? killer.multi + 1 : 1;
      killer.lastKillTime = this.time;
      killer.deathStreak = 0;
      if (this.state === 'playing') {
        killer.xp += XP.kill;
        this.award(killer, 'kill', { victim: targ.id, xp: XP.kill });
        if (mod === 'telefrag') this.award(killer, 'telefrag', { victim: targ.id });
        const award = MULTI_AWARDS[Math.min(killer.multi, MULTI_AWARDS.length - 1)];
        if (award) this.award(killer, award, { count: killer.multi });
        if (targ.lastHitHead && (mod === 'rg' || mod === 'mg')) this.award(killer, 'headshot', { victim: targ.id });
        if (targ.lastHitBounced && (mod === 'gl' || mod === 'gl_splash')) this.award(killer, 'bounced', { victim: targ.id });
        if (killer.nemesis === targ.id) { killer.nemesis = null; this.award(killer, 'revenge', { victim: targ.id }); }
        if (gib) this.award(killer, 'gib', { victim: targ.id });
      }
    }
    targ.nemesis = killer && killer !== targ ? killer.id : null;
    // drop the current weapon (Q3 TossClientItems)
    if (targ.weapon !== 'mg' && targ.ammo[targ.weapon] > 0 && mod !== 'void') {
      const it = { id: nextId++, type: targ.weapon, def: ITEMS[targ.weapon], pos: [targ.ps.origin[0], targ.ps.origin[1] - 23, targ.ps.origin[2]], active: true, dropped: true, ammo: Math.max(1, targ.ammo[targ.weapon]), expire: this.time + 30 };
      // settle the dropped item onto the floor
      const tr = this.col.trace([it.pos[0], it.pos[1] + 20, it.pos[2]], [it.pos[0], it.pos[1] - 512, it.pos[2]], [-8, 0, -8], [8, 8, 8], MASK_PLAYER);
      it.pos = [tr.endpos[0], tr.endpos[1], tr.endpos[2]];
      this.items.push(it);
      this.emit({ type: 'drop', itemId: it.id, item: it.type, pos: [...it.pos] });
    }
    this.emit({ type: 'death', player: targ.id, killer: killer ? killer.id : null, mod, gib, pos: [...targ.ps.origin], vel: [...targ.ps.velocity], dir: targ.lastHitDir || null });
    if (targ.bot) targ.bot.onDeath();
  }

  checkRules() {
    const elapsed = this.time - this.startTime;
    let leader = null;
    for (const p of this.players) if (!leader || p.frags > leader.frags) leader = p;
    if (leader && leader.frags >= this.fraglimit) return this.endMatch(leader, 'Fraglimit hit');
    if (this.timelimit > 0 && elapsed >= this.timelimit) return this.endMatch(leader, 'Timelimit hit');
  }

  endMatch(winner, reason) {
    this.state = 'intermission';
    this.winner = winner;
    this.intermissionTime = this.time;
    // finishing XP: everyone still in the match, plus a podium bonus
    const rank = this.ranking();
    rank.forEach((p, i) => {
      const bonus = XP.match + (XP.place[i] || 0);
      p.xp += bonus;
      this.emit({ type: 'xp', player: p.id, amount: bonus, reason: i < 3 ? `Match complete · ${['1st', '2nd', '3rd'][i]} place` : 'Match complete' });
    });
    this.emit({ type: 'matchend', winner: winner ? winner.id : null, reason });
  }

  // per-player tally for profiles and the results screen
  results() {
    return this.ranking().map((p, i) => ({
      id: p.id, name: p.name, profileId: p.profileId, bot: !!p.bot,
      place: i + 1, won: p === this.winner, frags: p.frags, kills: p.kills, deaths: p.deaths, xp: p.xp, badges: { ...p.badges },
    }));
  }

  timeLeft() {
    if (this.state !== 'playing') return this.timelimit;
    return Math.max(0, this.timelimit - (this.time - this.startTime));
  }

  ranking() { return [...this.players].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths); }
}

function intermissionCmd(c) { return { ...c, forward: 0, side: 0, attack: false, jump: false }; }

// Weapon timing shared by the server and the client's prediction: switching, refire, ammo.
// Mutates p (weapon, lastWeapon, weaponTime, switchTo, ammo, firing) and cmd.weapon.
export function weaponStep(p, cmd, dt, playing) {
  let switched = false, result = null;
  if (cmd.weapon && cmd.weapon !== p.weapon && p.weapons[cmd.weapon] && p.ammo[cmd.weapon] > 0) p.switchTo = cmd.weapon;
  cmd.weapon = null;
  if (p.weaponTime > 0) p.weaponTime -= dt * 1000;
  if (p.switchTo && p.switchTo !== p.weapon) {
    p.lastWeapon = p.weapon;
    p.weapon = p.switchTo;
    p.weaponTime = Math.max(p.weaponTime, 0) + 100;
    switched = true;
  }
  p.switchTo = null;
  p.firing = false;
  if (!cmd.attack || !playing) return { switched, result };
  if (p.weaponTime > 0) { p.firing = true; return { switched, result }; }
  if (p.ammo[p.weapon] <= 0) {
    // out of ammo: switch to the best weapon that has ammo
    for (let i = WEAPON_ORDER.length - 1; i >= 0; i--) {
      const id = WEAPON_ORDER[i];
      if (p.weapons[id] && p.ammo[id] > 0) { p.switchTo = id; break; }
    }
    p.weaponTime = 300;
    return { switched, result: 'noammo' };
  }
  p.firing = true;
  p.ammo[p.weapon]--;
  p.weaponTime += WEAPONS[p.weapon].rate;
  return { switched, result: 'fire' };
}

// Jump pads and teleporters: pure movement triggers, so the client can predict them exactly.
// Returns { pad } when a pad fired its sound this command, { tele, from } after a teleport.
export function touchMovers(ps, cmd, pads, teles) {
  const amin = [ps.origin[0] + ps.mins[0], ps.origin[1] + ps.mins[1], ps.origin[2] + ps.mins[2]];
  const amax = [ps.origin[0] + ps.maxs[0], ps.origin[1] + ps.maxs[1], ps.origin[2] + ps.maxs[2]];
  const out = { pad: null, tele: null, from: null };
  for (const pad of pads) {
    if (aabb(amin, amax, pad.min, pad.max)) {
      ps.velocity[0] = pad.vel[0]; ps.velocity[1] = pad.vel[1]; ps.velocity[2] = pad.vel[2];
      ps.onGround = false; ps.wallDodges = 0;
      if (cmd.time - (ps.lastPadTime ?? -1e9) > 300) out.pad = pad;
      ps.lastPadTime = cmd.time;
    }
  }
  for (const t of teles) {
    if (aabb(amin, amax, t.min, t.max)) {
      out.from = [...ps.origin];
      ps.origin = [t.dest[0], t.dest[1] + 25, t.dest[2]];
      const f = [0, 0, 0];
      angleVectors(0, t.yaw, f);
      ps.velocity = [f[0] * 400, 0, f[2] * 400];
      ps.yaw = t.yaw; cmd.yaw = t.yaw;
      ps.pmTime = 160; ps.timeKnockback = true;
      out.tele = t;
      break;
    }
  }
  return out;
}

function aabb(amin, amax, bmin, bmax) {
  return amin[0] <= bmax[0] && amax[0] >= bmin[0] && amin[1] <= bmax[1] && amax[1] >= bmin[1] && amin[2] <= bmax[2] && amax[2] >= bmin[2];
}
function boxesOverlap(o1, mn1, mx1, o2, mn2, mx2) {
  return aabb([o1[0] + mn1[0], o1[1] + mn1[1], o1[2] + mn1[2]], [o1[0] + mx1[0], o1[1] + mx1[1], o1[2] + mx1[2]],
    [o2[0] + mn2[0], o2[1] + mn2[1], o2[2] + mn2[2]], [o2[0] + mx2[0], o2[1] + mx2[1], o2[2] + mx2[2]]);
}

// Q3 AimAtTarget: velocity that reaches `target` at the apex of the arc.
export function launchVelocity(pad) {
  const origin = [pad.at[0], pad.at[1] + 24, pad.at[2]];
  const height = pad.target[1] - origin[1];
  const g = PM.gravity;
  const time = Math.sqrt(Math.max(height, 1) / (0.5 * g));
  const dx = pad.target[0] - origin[0], dz = pad.target[2] - origin[2];
  return [dx / time, time * g, dz / time];
}
