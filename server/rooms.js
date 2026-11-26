// Multiplayer rooms: a lobby where the owner sets the rules, then an authoritative match.
//
// Netcode (Quake 3 style):
//  - clients send their user commands (one per 8 ms client tick, numbered) a few times per frame;
//    the server queues them and runs exactly one per tick per player (Game.remoteThink)
//  - every SNAP_EVERY ticks each client gets a snapshot: everyone's state, items, projectiles,
//    the events since the last snapshot, and its own full player state + the last command applied,
//    which the client uses to re-run its unacknowledged commands (prediction)
//  - hitscan from remote players is lag-compensated with the shooter's view time (Game.rewind)
import { Game, TICK } from '../src/sim/game.js';
import { buildMap } from '../src/maps/builder.js';
import { buildNav } from '../src/sim/nav.js';
import { makeBot } from '../src/sim/bot.js';
import { MAPS } from '../src/maps/index.js';
import { BOT_NAMES, PLAYER_COLORS, CHARACTERS, WEAPON_ORDER } from '../src/sim/defs.js';
import { recordResult, view } from './profiles.js';

const SNAP_EVERY = 3;          // 125 / 3 ≈ 42 snapshots a second
const WARMUP = 8;              // same as offline: welcome line, then 3 · 2 · 1
const LOAD_TIMEOUT = 75;       // seconds to wait for slow loaders before starting anyway
const INTERMISSION = 12;       // seconds on the scoreboard before returning to the lobby
const MAX_ROOMS = 50;

const mapCache = new Map();    // map key -> { def, nav } (nav is read-only, so shared by matches)
function mapData(key) {
  if (!mapCache.has(key)) {
    const def = MAPS[key].def;
    const map = buildMap(def);
    const t0 = Date.now();
    const g = new Game(map, {});
    const nav = buildNav(map, g.col);
    console.log(`[rooms] built nav for ${key} in ${Date.now() - t0} ms`);
    mapCache.set(key, { nav });
  }
  return mapCache.get(key);
}

const r1 = (v) => Math.round(v * 10) / 10;
const DEFAULT_RULES = { map: 'bastion', fraglimit: 20, timelimit: 10, bots: 2, skill: 3, doubleJump: false, maxPlayers: 8 };

export function cleanRules(r = {}, base = DEFAULT_RULES) {
  const n = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : d);
  return {
    map: MAPS[r.map] ? r.map : base.map,
    fraglimit: n(r.fraglimit, 1, 100, base.fraglimit),
    timelimit: n(r.timelimit, 0, 60, base.timelimit),
    bots: n(r.bots, 0, 11, base.bots),
    skill: n(r.skill, 1, 5, base.skill),
    doubleJump: r.doubleJump != null ? !!r.doubleJump : base.doubleJump,
    maxPlayers: n(r.maxPlayers, 2, 12, base.maxPlayers),
  };
}

export class Lobby {
  constructor() {
    this.rooms = new Map();
    this.clients = new Set();
    this.nextRoom = 1;
  }

  // ---- connection lifecycle ----
  connect(client) { this.clients.add(client); }
  disconnect(client) {
    this.clients.delete(client);
    if (client.room) client.room.leave(client);
  }

  list() { return [...this.rooms.values()].map((r) => r.info()); }
  broadcastList() {
    const msg = JSON.stringify({ t: 'rooms', rooms: this.list() });
    for (const c of this.clients) if (!c.room) c.sendRaw(msg);
  }

  create(client, name) {
    if (this.rooms.size >= MAX_ROOMS) return client.send({ t: 'error', msg: 'Too many rooms on this server' });
    if (client.room) client.room.leave(client);
    const id = String(this.nextRoom++);
    const room = new Room(this, id, cleanRoomName(name) || `${client.name}'s room`);
    this.rooms.set(id, room);
    room.join(client);
    this.broadcastList();
  }

  join(client, id) {
    const room = this.rooms.get(String(id));
    if (!room) return client.send({ t: 'error', msg: 'That room no longer exists' });
    if (room.clients.size >= room.rules.maxPlayers) return client.send({ t: 'error', msg: 'Room is full' });
    if (client.room === room) return;
    if (client.room) client.room.leave(client);
    room.join(client);
    this.broadcastList();
  }

  removeRoom(room) { room.stop(); this.rooms.delete(room.id); this.broadcastList(); }
}

function cleanRoomName(n) { return String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 28); }

class Room {
  constructor(lobby, id, name) {
    this.lobby = lobby; this.id = id; this.name = name;
    this.clients = new Set();
    this.owner = null;
    this.rules = { ...DEFAULT_RULES };
    this.state = 'lobby';     // lobby -> loading -> playing (incl. warmup/intermission) -> lobby
    this.game = null;
    this.chat = [];
  }

  info() {
    return { id: this.id, name: this.name, players: this.clients.size, max: this.rules.maxPlayers, state: this.state, map: this.rules.map, owner: this.owner ? this.owner.name : '' };
  }

  send(obj) { const s = JSON.stringify(obj); for (const c of this.clients) c.sendRaw(s); }

  lobbyState() {
    return {
      t: 'room', id: this.id, name: this.name, state: this.state, owner: this.owner ? this.owner.cid : null, rules: this.rules,
      members: [...this.clients].map((c) => ({ cid: c.cid, name: c.name, character: c.character, color: c.color, level: c.level, inGame: !!c.player })),
      chat: this.chat,
    };
  }
  pushState() { this.send(this.lobbyState()); }

  join(client) {
    this.clients.add(client);
    client.room = this;
    if (!this.owner) this.owner = client;
    this.say(null, `${client.name} joined`);
    this.pushState();
    // a match is running: drop the newcomer straight in
    if (this.state === 'loading' || this.state === 'playing') this.addToGame(client);
  }

  leave(client) {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    client.room = null;
    if (client.player && this.game) { this.game.removePlayer(client.player); this.sendRoster(); }
    client.player = null; client.ready = false;
    if (this.owner === client) this.owner = this.clients.values().next().value || null;
    if (!this.clients.size) { this.lobby.removeRoom(this); return; }
    this.say(null, `${client.name} left`);
    this.pushState();
    if (this.state === 'loading') this.checkAllReady();
    this.lobby.broadcastList();
  }

  say(from, text) {
    const line = { from: from ? from.name : null, color: from ? from.color : null, text: String(text).slice(0, 200), at: Date.now() };
    this.chat.push(line);
    if (this.chat.length > 40) this.chat.shift();
    this.send({ t: 'chat', line });
  }

  setRules(client, rules) {
    if (client !== this.owner || this.state !== 'lobby') return;
    this.rules = cleanRules(rules, this.rules);
    this.pushState();
    this.lobby.broadcastList();
  }

  // ---- match ----
  start(client) {
    if (client !== this.owner || this.state !== 'lobby') return;
    const { nav } = mapData(this.rules.map);
    const map = buildMap(MAPS[this.rules.map].def);
    const game = new Game(map, { fraglimit: this.rules.fraglimit, timelimit: this.rules.timelimit, warmup: WARMUP, doubleJump: this.rules.doubleJump });
    game.nav = nav;
    this.game = game;
    this.state = 'loading';
    this.loadDeadline = Date.now() + LOAD_TIMEOUT * 1000;
    // bots first so their colours avoid the humans'
    const used = new Set([...this.clients].map((c) => c.color));
    const free = PLAYER_COLORS.filter((c) => !used.has(c));
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const humans = this.clients.size;
    const nb = Math.min(this.rules.bots, 12 - humans);
    for (let i = 0; i < nb; i++) {
      const b = game.addPlayer({ name: names[i % names.length], bot: makeBot(this.rules.skill), color: free[i % free.length] ?? PLAYER_COLORS[i % PLAYER_COLORS.length] });
      b.character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    }
    // everyone first, then the start messages, so each client's roster is complete
    for (const c of this.clients) this.addToGame(c, false);
    for (const c of this.clients) this.sendStart(c);
    this.sendRoster();
    this.pushState();
    this.lobby.broadcastList();
    this.loadTimer = setInterval(() => { if (this.state === 'loading' && Date.now() > this.loadDeadline) this.begin(); }, 1000);
  }

  addToGame(c, announce = true) {
    const g = this.game;
    c.ready = false;
    // two players in one colour can't tell each other apart: take a free one if ours is used
    const used = new Set(g.players.map((p) => p.color));
    const color = used.has(c.color) ? PLAYER_COLORS.find((x) => !used.has(x)) ?? c.color : c.color;
    c.player = g.addPlayer({ name: c.name, color, character: c.character, remote: true, spawn: false, profileId: c.profileId, level: c.level });
    c.player.alive = false;
    c.player.respawnAt = Infinity;   // spawned when their client has loaded the map
    c.lastQueued = 0;
    if (announce) { this.sendStart(c); this.sendRoster(); }
  }
  sendStart(c) {
    const g = this.game;
    c.send({ t: 'start', map: this.rules.map, rules: this.rules, you: c.player.id, roster: this.roster(), warmup: WARMUP, time: g.time, state: g.state });
  }

  roster() {
    return this.game.players.map((p) => ({ id: p.id, name: p.name, color: p.color, character: p.character, bot: p.bot ? p.bot.skill || 1 : 0, level: p.level || 1 }));
  }
  sendRoster() { if (this.game) this.send({ t: 'roster', players: this.roster() }); }

  ready(client) {
    if (!client.player || client.ready) return;
    client.ready = true;
    if (this.state === 'loading') this.checkAllReady();
    else if (this.state === 'playing') { this.game.spawn(client.player); client.player.respawnAt = 0; }
  }

  checkAllReady() {
    if ([...this.clients].every((c) => c.ready || !c.player)) this.begin();
  }

  begin() {
    if (this.state !== 'loading') return;
    clearInterval(this.loadTimer);
    const g = this.game;
    g.events.length = 0;
    for (const c of this.clients) if (c.player) { g.spawn(c.player); c.player.respawnAt = 0; }
    this.state = 'playing';
    this.pending = [];
    this.ticks = 0;
    this.last = performance.now();
    this.acc = 0;
    this.loop = setInterval(() => this.pump(), 4);
    this.pingTimer = setInterval(() => { const s = performance.now(); for (const c of this.clients) c.send({ t: 'ping', s }); }, 2000);
    this.pushState();
    this.lobby.broadcastList();
  }

  // fixed 125 Hz ticks driven by wall time (setInterval only wakes us up)
  pump() {
    const now = performance.now();
    this.acc += (now - this.last) / 1000;
    this.last = now;
    let n = 0;
    while (this.acc >= TICK && n < 30) {
      this.game.tick();
      for (const e of this.game.events) {
        this.pending.push(e);
        if (e.type === 'matchend') this.matchEnded();
      }
      this.game.events.length = 0;
      this.acc -= TICK;
      n++;
      if (++this.ticks % SNAP_EVERY === 0) this.snapshot();
      if (!this.game) return;
    }
    if (n >= 30) this.acc = 0;   // fell far behind (machine stalled): don't spiral
  }

  snapshot() {
    const g = this.game;
    const players = g.players.map((p) => [
      p.id, r1(p.ps.origin[0]), r1(p.ps.origin[1]), r1(p.ps.origin[2]),
      Math.round(p.ps.velocity[0]), Math.round(p.ps.velocity[1]), Math.round(p.ps.velocity[2]),
      r1(p.ps.yaw), r1(p.ps.pitch),
      (p.alive ? 1 : 0) | (p.ps.onGround ? 2 : 0) | (p.ps.ducked ? 4 : 0) | (p.firing ? 8 : 0),
      WEAPON_ORDER.indexOf(p.weapon), p.frags, p.deaths, p.kills, p.ping ?? (p.bot ? -1 : 0),
    ]);
    const proj = g.projectiles.map((pr) => [pr.id, pr.type === 'rocket' ? 0 : 1, r1(pr.pos[0]), r1(pr.pos[1]), r1(pr.pos[2]), Math.round(pr.vel[0]), Math.round(pr.vel[1]), Math.round(pr.vel[2]), pr.resting ? 1 : 0]);
    let active = '';
    const dropped = [];
    for (const it of g.items) {
      if (it.dropped) dropped.push([it.id, it.type, r1(it.pos[0]), r1(it.pos[1]), r1(it.pos[2])]);
      else active += it.active ? '1' : '0';
    }
    const common = JSON.stringify({
      tm: g.time, st: g.state, tl: g.timeLeft(), win: g.winner ? g.winner.id : null,
      pl: players, pr: proj, it: active, dr: dropped, ev: this.pending,
    });
    this.pending = [];
    for (const c of this.clients) {
      const p = c.player;
      if (!p || !c.ready) continue;
      const ps = { ...p.ps, events: undefined };
      const me = {
        seq: p.lastSeq, ps, alive: p.alive, health: p.health, armor: p.armor, respawnAt: p.respawnAt,
        weapon: p.weapon, lastWeapon: p.lastWeapon, weaponTime: p.weaponTime, switchTo: p.switchTo, weapons: p.weapons, ammo: p.ammo, xp: p.xp,
      };
      c.sendRaw(`{"t":"s","c":${common},"me":${JSON.stringify(me)}}`);
    }
  }

  matchEnded() {
    if (this.endTimer) return;
    // profiles: every connected human gets the match folded in, and their new totals back
    const results = this.game.results();
    for (const c of this.clients) {
      if (!c.player) continue;
      const r = results.find((x) => x.id === c.player.id);
      if (!r) continue;
      let saved = null;
      if (c.profileId) saved = recordResult(c.profileId, r);
      if (saved) c.level = saved.level;
      c.send({ t: 'results', results, mine: r, profile: saved ? view(saved.profile) : null, levelUp: saved ? saved.levelUp : false });
    }
    this.endTimer = setTimeout(() => this.backToLobby(), INTERMISSION * 1000);
  }

  backToLobby() {
    this.stop();
    for (const c of this.clients) { c.player = null; c.ready = false; }
    this.state = 'lobby';
    this.pushState();
    this.lobby.broadcastList();
  }

  stop() {
    clearInterval(this.loop); clearInterval(this.pingTimer); clearInterval(this.loadTimer); clearTimeout(this.endTimer);
    this.loop = this.pingTimer = this.loadTimer = this.endTimer = null;
    this.game = null;
  }

  // client commands: [[seq, forward, side, buttons, yaw, pitch, weaponIndex+1 | 0, viewTime], ...]
  commands(client, list) {
    const p = client.player;
    if (!p || !Array.isArray(list) || this.state !== 'playing') return;
    for (const c of list.slice(-64)) {
      if (!Array.isArray(c)) continue;
      const seq = c[0] | 0;
      if (seq <= client.lastQueued) continue;
      client.lastQueued = seq;
      const b = c[3] | 0;
      const clamp = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : 0);
      p.cmdQueue.push({
        seq,
        forward: clamp(Math.round(c[1]), -1, 1), side: clamp(Math.round(c[2]), -1, 1),
        jump: !!(b & 1), crouch: !!(b & 2), attack: !!(b & 4), walljumpOnJump: !!(b & 8),
        yaw: clamp(c[4], -180, 180), pitch: clamp(c[5], -89, 89),
        weapon: c[6] ? WEAPON_ORDER[(c[6] | 0) - 1] || null : null,
        time: seq * 8,          // the client's own command clock (double-tap timing, pads)
        vt: Number.isFinite(+c[7]) ? +c[7] : null,
      });
    }
  }
}
