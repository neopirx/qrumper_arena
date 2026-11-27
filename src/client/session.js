// A running match: owns the simulation, the scene and per-frame client logic.
import * as THREE from 'three';
import { Game, TICK, modeName } from '../sim/game.js';
import { buildMap } from '../maps/builder.js';
import { buildNav } from '../sim/nav.js';
import { makeBot } from '../sim/bot.js';
import { BOT_NAMES, PLAYER_COLORS, ITEMS, WEAPONS, WEAPON_ORDER } from '../sim/defs.js';
import { buildWorld } from '../render/world.js';
import { Effects } from '../render/effects.js';
import { Gore } from '../render/gore.js';
import { Atmosphere } from '../render/atmosphere.js';
import { Glow } from '../render/glow.js';
import { CHARACTERS } from '../render/assets.js';
import { PlayerModel, ItemView, buildMapProps, buildSky } from '../render/entities.js';
import { ViewWeapon } from '../render/viewweapon.js';
import { Hud } from './hud.js';
import { gunFor } from './crosshair.js';
import { Input } from './input.js';
import { angleVectors, yawTo, angleDiff, DEG } from '../sim/vec.js';
import { MAPS, nextMap } from '../maps/index.js';
import { Podium } from '../render/podium.js';
import { DynamicLighting } from '../render/dynlight.js';
import { NetMatch } from './netmatch.js';
import { BADGES } from '../sim/xp.js';

const SKILL_NAMES = ['', 'Recruit', 'Regular', 'Veteran', 'Elite', 'Nightmare'];
// warmup: the "welcome" line (~4.5 s), then the 3 · 2 · 1 countdown, then GO
const WARMUP = 8;
// end of match: the scoreboard first, then the podium; the next map loads NEXT_IN s after the end
const PODIUM_AT = 7, NEXT_IN = 30;
// announcer lines that have a recording (see ANNOUNCER in audio.js)
const SPOKEN = new Set(['double', 'triple', 'quad', 'monster', 'precision', 'revenge', 'telefrag', 'deathstreak', 'dismembered', 'mutilated']);
// view kick per shot: a small random sideways nudge (no vertical kick), visual only, the aim doesn't move
const VIEW_KICK = { mg: 0.35, sg: 1.7, gl: 1.0, rl: 1.4, rg: 2.1 };
// heavier shots also twist the view (roll, degrees), punch the FOV out (degrees) and shove the
// eye back along the line of sight (units)
const VIEW_HEFT = {
  mg: { roll: 0.12, fov: 0, push: 0.2 },
  sg: { roll: 0.7, fov: 1.6, push: 1.6 },
  gl: { roll: 0.45, fov: 0.8, push: 1.0 },
  rl: { roll: 0.6, fov: 2.2, push: 2.4 },
  rg: { roll: 0.9, fov: 2.0, push: 2.0 },
};

export class Session {
  // net: { conn, start } for a multiplayer match (start = the server's 'start' message)
  constructor({ renderer, assets, audio, textures, settings, hudRoot, opts, onPause, onExit, onMatchEnd, onNext, onQuit, net = null }) {
    this.renderer = renderer; this.assets = assets; this.audio = audio; this.textures = textures;
    this.settings = settings; this.opts = opts;
    this.hudRoot = hudRoot;
    this.onPause = onPause; this.onExit = onExit; this.onMatchEnd = onMatchEnd; this.onNext = onNext; this.onQuit = onQuit;
    this.net = net;
    // camera motion: landing dip, jump nudge, recoil, damage roll (all scaled by settings.camMotion)
    // plus head bob, inertia lean, shot roll / FOV punch / push, and a smooth hit and blast shake
    this.cam = {
      landT: 1, landAmt: 0, landRoll: 0, jumpT: 1, kickP: 0, kickY: 0, kickV: 0, roll: 0, hurtRoll: 0,
      kickR: 0, fovK: 0, pushP: 0, pushV: 0, trauma: 0, bobAmt: 0, sv: [0, 0], lean: [0, 0], speedFov: 0,
    };
    this.walk = 0;   // distance walked on the ground: drives the head bob, gun bob and footsteps
    this.zoom = 0; this.zoomToggled = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 2, 12000);
    this.camera.rotation.order = 'YXZ';
    this.models = new Map();
    this.itemViews = new Map();
    this.projViews = new Map();
    this.acc = 0;
    this.paused = false;
    this.running = false;
    this.stepOffset = 0;
    this.viewHeight = 26;
    this.lastYaw = 0; this.lastPitch = 0;
    this.fpsT = 0; this.fpsN = 0; this.fps = 0;
    this.time = 0;
  }

  async load(progress) {
    const def = MAPS[this.opts.map].def;
    progress(0.02, 'Building map');
    await frame();
    const map = buildMap(def);
    const game = new Game(map, { fraglimit: this.opts.fraglimit, timelimit: this.opts.timelimit, warmup: WARMUP, doubleJump: this.opts.doubleJump, mode: this.opts.mode, instagib: this.opts.instagib });
    this.game = game; this.map = map;
    if (!this.net) {
      progress(0.06, 'Generating bot navigation');
      await frame();
      game.nav = buildNav(map, game.col);
    }
    const world = await buildWorld(map, game.col, this.textures, (p, what) => progress(0.1 + p * 0.8, 'Baking lightmaps: ' + what));
    this.world = world;
    this.scene.add(world.group);
    this.atmosphere = new Atmosphere(map);
    this.atmosphere.makeDust(this.scene);
    this.glow = new Glow(this.renderer);
    this.sky = buildSky(map);
    this.scene.add(this.sky);
    this.effects = new Effects(this.scene, game.col, this.settings.graphics || {});
    this.effects.lightGrid = world.lightGrid;
    this.gore = new Gore(this.scene, game.col, this.effects);
    this.gore.enabled = this.settings.gore !== false;
    this.props = buildMapProps(map, this.effects, this.scene, game.col);
    this.props.light(world.lightGrid);
    this.viewWeapon = new ViewWeapon(this.assets, this.effects.starTex);
    progress(0.95, 'Spawning players');
    // players
    let me;
    if (this.net) {
      // the server owns the roster; our player is predicted locally (netmatch.js)
      const st = this.net.start;
      this.netm = new NetMatch(this.net.conn, game, st.you);
      this.syncRoster(this.net.roster ? this.net.roster() : st.roster, false);
      me = game.players.find((p) => p.id === st.you);
      this.netm.setMe(me);
      game.state = st.state || 'warmup';
      game.timeLeft = () => this.netm.timeLeft();
      this.unsub = [
        this.net.conn.on('roster', (m) => this.syncRoster(m.players, true)),
        this.net.conn.on('results', (m) => this.showResults(m.mine, m.profile, m.levelUp)),
        this.net.conn.on('next', (m) => { this.nextMapKey = m.map; this.nextAt = this.time + m.in - 0.3; }),
      ];
    } else {
      const myColor = this.settings.color ?? PLAYER_COLORS[0];
      me = game.addPlayer({ name: this.settings.name || 'Player', color: myColor, level: this.opts.level || 1 });
      me.character = CHARACTERS.includes(this.settings.character) ? this.settings.character : CHARACTERS[0];
      const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
      const botColors = PLAYER_COLORS.filter((c) => c !== myColor);
      for (let i = 0; i < this.opts.bots; i++) {
        const b = game.addPlayer({ name: names[i % names.length], bot: makeBot(this.opts.skill), color: botColors[i % botColors.length] });
        b.character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      }
    }
    me.autoSwitch = this.settings.autoSwitch;
    this.me = me;
    for (const p of game.players) this.addView(p);
    for (const it of game.items) this.itemViews.set(it.id, new ItemView(this.assets, this.effects, it, this.scene));
    this.hud = new Hud(this.hudRoot, this.settings, this.assets.icons);
    this.hud.onBadge = () => this.audio.play('badge', null, { volume: 0.7, noVary: true });
    this.input = new Input(this.renderer.domElement, this.settings);
    this.input.onUnlock = () => { if (this.running && !this.paused) this.pause(); };
    this.input.yaw = me.ps.yaw; this.input.pitch = 0;
    this.viewWeapon.setWeapon(game.spawnWeapon);
    game.events.length = 0;
    this.applyGraphics();
    progress(1, 'Ready');
  }

  // colour + third-person model for a player (not for ourselves)
  addView(p) {
    p.colorCss = '#' + new THREE.Color(p.color).getHexString();
    p.prev = [...p.ps.origin];
    if (p === this.me || this.models.has(p.id)) return;
    const m = new PlayerModel(this.assets, p.color, this.scene, p.character);
    m.setWeapon(this.assets, p.weapon);
    if (this.net && !p.alive) m.root.visible = false;   // shown once the server says they're alive
    this.models.set(p.id, m);
  }
  removeView(id) {
    const m = this.models.get(id);
    if (m) { m.dispose(); this.models.delete(id); }
  }

  // network roster: players joining / leaving mid-match (bots are plain entries with a skill)
  syncRoster(list, live) {
    const g = this.game;
    const ids = new Set(list.map((r) => r.id));
    for (const p of [...g.players]) if (!ids.has(p.id)) { g.players = g.players.filter((x) => x !== p); this.removeView(p.id); }
    for (const r of list) {
      let p = g.players.find((x) => x.id === r.id);
      if (!p) {
        p = g.addPlayer({ id: r.id, name: r.name, color: r.color, character: r.character, spawn: false, level: r.level });
        p.bot = r.bot ? { skill: r.bot } : null;
        if (live) this.addView(p);
      }
      p.level = r.level;
    }
  }

  // live-applicable graphics options (the rest are read when the match loads)
  applyGraphics() {
    const G = this.settings.graphics || {};
    this.effects.gfx = G;
    this.effects.q = { low: 0.35, medium: 0.65, high: 1 }[G.particles] ?? 1;
    if (this.atmosphere.dust) this.atmosphere.dust.visible = G.sky !== false;
    // Lighting: Dynamic adds real-time sun shadows and per-pixel lamps on top of the lightmaps
    const want = G.lighting === 'dynamic';
    if (want && !this.dyn) this.dyn = new DynamicLighting(this.renderer, this.map, this.world, this.scene);
    else if (!want && this.dyn) { this.dyn.dispose(); this.dyn = null; }
  }

  start() {
    this.running = true;
    this.input.enabled = true;
    this.input.lock();
    if (this.net) {
      this.net.conn.send({ t: 'ready' });
      const humans = this.game.players.filter((p) => !p.bot).length;
      this.hud.center(`<div class="big">${this.map.name}</div>${modeName(this.game.mode, this.game.instagib)} · ${humans} player${humans === 1 ? '' : 's'}`, 3);
    } else this.hud.center(`<div class="big">${this.map.name}</div>${modeName(this.game.mode, this.game.instagib)} · ${this.opts.bots} bot${this.opts.bots === 1 ? '' : 's'} (${SKILL_NAMES[this.opts.skill]})`, 3);
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
    this.audio.clearAnnouncer();
    this.say('welcome');
  }

  pause() {
    this.paused = true;
    this.input.enabled = false;
    this.input.down.clear();
    this.onPause && this.onPause();
  }
  resume() {
    this.paused = false;
    this.input.enabled = true;
    this.input.lock();
    this.last = performance.now();
  }

  dispose() {
    this.running = false;
    if (this.unsub) for (const u of this.unsub) u();
    if (this.netm) this.netm.dispose();
    cancelAnimationFrame(this.raf);
    this.input.unlock();
    this.input.dispose();
    for (const p of this.projViews.values()) this.audio.stop(p.sound);
    this.audio.clearAnnouncer();
    this.gore.dispose();
    if (this.podium) this.podium.dispose();
    if (this.dyn) { this.dyn.dispose(); this.dyn = null; }
    this.hudRoot.innerHTML = '';
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) m.dispose();
    });
    this.world.lmTex.dispose(); this.world.dmTex.dispose();
    this.glow.dispose();
  }

  buildCmd() {
    const inp = this.input, me = this.me, cmd = me.cmd;
    const on = inp.enabled && !this.paused;   // paused online: the match goes on, we just stand still
    cmd.forward = on ? (inp.is('forward') ? 1 : 0) - (inp.is('back') ? 1 : 0) : 0;
    cmd.side = on ? (inp.is('right') ? 1 : 0) - (inp.is('left') ? 1 : 0) : 0;
    cmd.jump = on && inp.is('jump');
    cmd.crouch = on && inp.is('crouch');
    cmd.attack = on && inp.is('attack');
    cmd.yaw = inp.yaw; cmd.pitch = inp.pitch;
    cmd.walljumpOnJump = this.settings.walljumpOnJump;
  }

  handleWeaponKeys() {
    const inp = this.input, me = this.me;
    for (let i = 1; i <= 5; i++) if (inp.was('w' + i)) { const id = WEAPON_ORDER[i - 1]; if (me.weapons[id]) me.cmd.weapon = id; }
    if (inp.was('lastweapon') && me.weapons[me.lastWeapon]) me.cmd.weapon = me.lastWeapon;
    if (inp.wheel) {
      const owned = WEAPON_ORDER.filter((id) => me.weapons[id] && me.ammo[id] > 0);
      if (owned.length) {
        let i = owned.indexOf(me.switchTo || me.weapon);
        i = (i + (inp.wheel > 0 ? 1 : -1) + owned.length) % owned.length;
        me.cmd.weapon = owned[i];
      }
    }
  }

  frame(dt) {
    const t0 = performance.now();
    this._frame(dt);
    const ms = performance.now() - t0;
    this.cpuMs = this.cpuMs == null ? ms : this.cpuMs * 0.95 + ms * 0.05;
  }

  _frame(dt) {
    const g = this.game, me = this.me;
    this.fpsT += dt; this.fpsN++;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsT); this.fpsT = 0; this.fpsN = 0; }

    if (this.net) {
      // online: predict our own commands at 125 Hz, send them, then apply the server's snapshots
      this.time += dt;
      const nm = this.netm;
      if (!this.paused) this.handleWeaponKeys();
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK && n < 20) {
        this.buildCmd();
        const evs = nm.predict(me.cmd);
        me.cmd.weapon = null;
        this.processEvents(evs);
        this.acc -= TICK;
        n++;
      }
      if (n >= 20) this.acc = 0;
      nm.flush();
      this.processEvents(nm.receive());
      g.time = nm.serverNow();
      nm.interpolate();
      const alpha = this.acc / TICK;
      this.render(dt, alpha);
      this.input.endFrame();
      return;
    }
    if (!this.paused) {
      this.time += dt;
      this.handleWeaponKeys();
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK && n < 20) {
        this.buildCmd();
        for (const p of g.players) p.prev = [...p.ps.origin];
        for (const pr of g.projectiles) pr.prev = [...pr.pos];
        g.tick();
        this.processEvents();
        this.acc -= TICK;
        n++;
      }
      if (n >= 20) this.acc = 0;
    }
    const alpha = this.acc / TICK;
    this.render(dt, alpha);
    this.input.endFrame();
  }

  // announcer line (respects the announcer setting)
  say(name, opts) { if (this.settings.announcer !== false) this.audio.announce(name, opts); }

  pname(id) { return this.game.players.find((p) => p.id === id); }

  // where a hitscan tracer should start: the visible gun for the local player, else the eye
  shotOrigin(p, from) {
    if (!from) return null;
    if (p !== this.me) return from;
    const f = [0, 0, 0], r = [0, 0, 0], o = this.me.ps.origin;
    angleVectors(this.me.ps.pitch, this.me.ps.yaw, f, r);
    return [o[0] + f[0] * 20 + r[0] * 7, o[1] + this.me.ps.viewheight - 8 + f[1] * 20, o[2] + f[2] * 20 + r[2] * 7];
  }

  processEvents(list = null) {
    const g = this.game, me = this.me, A = this.audio, fx = this.effects;
    for (const e of list || g.events) {
      const p = e.player != null ? this.pname(e.player) : null;
      const isMe = p === me;
      switch (e.type) {
        case 'spawn': {
          if (isMe) { this.input.yaw = e.yaw; this.input.pitch = 0; this.viewWeapon.reset(g.spawnWeapon); this.cam.sv = [0, 0]; this.cam.trauma = 0; this.hud.deathMsg = null; this.hud.clearDamage(); this.zoomToggled = false; }
          else if (p) { p.alive = true; const m = this.models.get(p.id); if (m) { m.revive(); m.root.visible = true; } }
          if (p) p.prev = [...p.ps.origin];
          fx.sparkle(e.pos, 0x80c0ff, 30, 30);
          A.play('tele', isMe ? null : e.pos, { volume: 0.5 });
          break;
        }
        case 'fire': {
          const w = WEAPONS[e.weapon];
          // machinegun shots cut the previous shot's tail so rapid fire stays crisp
          A.play(e.weapon, isMe ? null : e.pos, { volume: isMe ? 0.55 : 0.9, choke: e.weapon === 'mg' ? 'mg' + e.player : null });
          // the local player's muzzle star is drawn on the view weapon instead
          if (isMe) {
            fx.light(e.pos, w.color, w.id === 'mg' ? 120 : 200, 0.06, { intensity: 1.1 });
            this.viewWeapon.fire(e.weapon);
            this.cam.kickY += (Math.random() - 0.5) * (VIEW_KICK[e.weapon] ?? 0.5) * 0.25;
            const h = VIEW_HEFT[e.weapon];
            if (h) {
              this.cam.kickR += (Math.random() < 0.5 ? -1 : 1) * h.roll * (0.6 + Math.random() * 0.4) * DEG;
              this.cam.fovK = Math.max(this.cam.fovK, h.fov);
              this.cam.pushV += h.push * 22;
            }
          }
          else fx.muzzleFlash(e.pos, w.color, w.id === 'mg' ? 140 : 200, e.dir, w.id);
          break;
        }
        case 'projectile': {
          const v = { kind: e.kind, obj: null, smokeT: 0 };
          if (e.kind === 'rocket') {
            // mid-poly casing with fins and a fullbright engine
            const o = new THREE.Group();
            const casing = new THREE.MeshBasicMaterial({ color: 0x4a4e55, fog: false });
            const body = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 13, 8), casing);
            body.rotation.x = Math.PI / 2;
            const nose = new THREE.Mesh(new THREE.ConeGeometry(2, 5, 8), new THREE.MeshBasicMaterial({ color: 0xc8402a, fog: false }));
            nose.rotation.x = -Math.PI / 2; nose.position.z = -9;
            const fins = new THREE.Mesh(new THREE.BoxGeometry(7, 0.6, 3), casing); fins.position.z = 5;
            const fins2 = fins.clone(); fins2.rotation.z = Math.PI / 2;
            const engine = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1, 8), new THREE.MeshBasicMaterial({ color: 0xfff0b0, fog: false }));
            engine.rotation.x = Math.PI / 2; engine.position.z = 7;
            o.add(body, nose, fins, fins2, engine);
            const gl = fx.glowSprite(0xff8a30, 30, 0.95); gl.position.z = 9; o.add(gl);
            const hot = fx.glowSprite(0xffffff, 9, 1); hot.position.z = 8; o.add(hot);
            // exhaust flame: a stretched star sprite that flickers every frame
            const flame = fx.sprite(fx.starTex, 0xffb050, 22, 0.9); flame.position.z = 12; o.add(flame);
            v.flame = flame; v.glow = gl;
            v.obj = o;
            v.sound = A.play('rocketLoop', e.pos, { volume: 0.35, loop: true });
          } else {
            // grenade: dark ovoid shell with a fullbright green band and a small halo so it reads mid-air
            const o = new THREE.Group();
            const shell = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0x3a4236, fog: false }));
            shell.scale.set(1, 1, 1.35);
            const band = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.7, 6, 14), new THREE.MeshBasicMaterial({ color: 0x8aff5a, fog: false }));
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2, 6), new THREE.MeshBasicMaterial({ color: 0x9a9a90, fog: false }));
            cap.rotation.x = Math.PI / 2; cap.position.z = -4.6;
            o.add(shell, band, cap, fx.glowSprite(0x6aff3a, 16, 0.55));
            v.obj = o;
            v.spin = [(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6];
          }
          v.obj.position.set(...e.pos);
          this.scene.add(v.obj);
          const pr = g.projectiles.find((x) => x.id === e.id);
          // only rockets carry a flight light: dynamic lights stay rare (spec 2.1)
          v.light = e.kind === 'rocket' ? fx.light(e.pos, 0xff8a30, 200, -1, { intensity: 1, follow: () => (pr ? pr.pos : null) }) : null;
          v.pr = pr;
          this.projViews.set(e.id, v);
          break;
        }
        case 'explode': case 'projgone': {
          const v = this.projViews.get(e.id);
          if (v) { this.scene.remove(v.obj); if (v.light) fx.removeLight(v.light); A.stop(v.sound); this.projViews.delete(e.id); }
          if (e.type === 'explode') {
            if (e.kind === 'rocket') { fx.explosion(e.pos, e.normal, true, this.camera.position); A.play('explode', e.pos, { volume: 1 }); }
            else { fx.explosion(e.pos, e.normal || [0, 1, 0], true, this.camera.position, 'grenade'); A.play('glExplode', e.pos, { volume: 1 }); }
          }
          break;
        }
        case 'bounce': A.play('bounce', e.pos, { volume: Math.min(0.6, e.speed / 600) }); break;
        case 'impact': fx.bulletImpact(e.pos, e.normal, e.kind, this.shotOrigin(p, e.from)); break;
        case 'blood': {
          const d = e.from ? norm([e.pos[0] - e.from[0], e.pos[1] - e.from[1], e.pos[2] - e.from[2]]) : null;
          const c = this.camera.position, near = Math.hypot(e.pos[0] - c.x, e.pos[1] - c.y, e.pos[2] - c.z) < 60;
          this.gore.spray(e.pos, d, WEAPONS[e.kind]?.damage ?? 10, near && me.alive);
          // body impact, heard by everyone (pellets of one shotgun blast share one voice)
          A.play('flesh', e.pos, { volume: e.kind === 'sg' ? 0.55 : 0.4 });
          if (e.from && (e.kind === 'mg' || Math.random() < 0.5)) fx.tracer(this.shotOrigin(p, e.from), e.pos, WEAPONS[e.kind]?.color ?? 0xffe68a);
          break;
        }
        case 'rail': {
          // start the beam from the gun for the local player
          let start = e.start;
          if (p === me) {
            const f = [0, 0, 0], r = [0, 0, 0];
            angleVectors(me.ps.pitch, me.ps.yaw, f, r);
            const o = me.ps.origin;
            start = [o[0] + f[0] * 18 + r[0] * 6, o[1] + me.ps.viewheight - 7 + f[1] * 18, o[2] + f[2] * 18 + r[2] * 6];
          }
          fx.rail(start, e.end, WEAPONS.rg.color, e.normal, e.hitWall);
          break;
        }
        case 'hit':
          if (e.attacker === me.id && this.settings.hitSounds) {
            A.play('hit', null, { volume: 0.6, rate: e.damage >= 75 ? 0.6 : e.damage >= 50 ? 0.75 : e.damage >= 25 ? 0.9 : 1.1, noVary: true });
            this.hud.hit(e.damage);
          }
          break;
        case 'pain':
          if (isMe) {
            // no direction for self-damage, falls and hazards
            const o = me.ps.origin;
            const from = e.from && Math.hypot(e.from[0] - o[0], e.from[2] - o[2]) > 8 ? e.from : null;
            const rel = from ? angleDiff(yawTo(from[0] - o[0], from[2] - o[2]), this.input.yaw) : null;
            this.hud.damage(e.damage, from);
            // a flinch: roll away from the side the hit came from
            const side = rel == null ? (Math.random() < 0.5 ? -1 : 1) : Math.sin(rel * DEG) > 0 ? 1 : -1;
            this.cam.hurtRoll += side * Math.min(3, e.damage / 25) * DEG;
            this.cam.kickV -= Math.min(20, e.damage / 4);
            this.cam.trauma = Math.min(1, this.cam.trauma + Math.min(0.7, e.damage / 90));
            this.viewWeapon.hurt(e.damage, side);
          }
          if (p && p.alive && e.health > 0) A.play('pain', isMe ? null : p.ps.origin, { volume: isMe ? 0.45 : 0.6 });
          // bullets already bled where they hit; rails and explosions bleed from the body
          if (p && e.dir && e.mod !== 'mg' && e.mod !== 'sg' && e.mod !== 'falling' && e.mod !== 'slime' && e.mod !== 'lava' && this.gore.enabled && !(isMe && e.health > 0)) {
            const o = p.ps.origin;
            this.gore.spray([o[0], o[1] + 8, o[2]], e.dir, e.damage);
          }
          break;
        case 'death': {
          if (!p) break;
          if (!isMe) p.alive = false;
          const killer = e.killer != null ? this.pname(e.killer) : null;
          this.hud.obituary(killer, p, e.mod, isMe || killer === me);
          const gib = e.gib && this.gore.enabled;
          if (!isMe) {
            const m = this.models.get(p.id);
            if (m) { if (gib) { m.root.visible = false; if (m.weapon) m.weapon.visible = false; } else m.die(); }
          }
          if (gib) { this.gore.gib(e.pos, e.vel, e.dir, p.color, this.camera.position); A.play('gib', e.pos, { volume: 0.8 }); }
          else {
            A.play('death', isMe ? null : e.pos, { volume: 0.7 });
            if (this.gore.enabled && e.mod !== 'void') this.effects.later(0.7, () => this.gore.pool(e.pos));
          }
          if (isMe) {
            this.hud.deathMsg = killer && killer !== me ? `Fragged by <b style="color:${killer.colorCss}">${escapeHtml(killer.name)}</b>` : 'You died';
            this.deathYaw = killer && killer !== me ? killer : null;
          }
          if (killer === me && !isMe) {
            const rank = g.ranking(); const pos = rank.indexOf(me) + 1;
            this.hud.center(`You fragged <b style="color:${p.colorCss}">${escapeHtml(p.name)}</b>`, 1.6);
            this.hud.sub(`${ordinal(pos)} place with ${me.frags}`, 1.6);
            A.play('kill', null, { volume: 0.4, noVary: true });
          }
          break;
        }
        case 'award': {
          if (!isMe) break;
          if (e.award === 'deathstreak') { this.say('deathstreak'); this.hud.award('Died 3 times in a row'); break; }
          // a gib kill alternates between the two gore lines
          const line = e.award === 'gib' ? (this.gibLine = !this.gibLine) ? 'dismembered' : 'mutilated' : e.award;
          if (SPOKEN.has(line) && !(e.award === 'gib' && !this.gore.enabled)) this.say(line);
          if (BADGES[e.award]) this.hud.badge(e.award, e.xp || 0);
          break;
        }
        case 'xp': if (isMe) this.hud.xpLine(e.amount, e.reason); break;
        case 'leave': {
          if (p) this.hud.feedLine(`<span style="color:${p.colorCss}">${escapeHtml(p.name)}</span> left the match`);
          if (p && p !== me) { g.players = g.players.filter((x) => x !== p); this.removeView(p.id); }
          break;
        }
        case 'countdown': {
          this.say(['', 'one', 'two', 'three'][e.n], { cut: true });
          this.hud.center(`<div class="big count">${e.n}</div>`, 0.9);
          break;
        }
        case 'jump': if (!p) break; A.play('jump', isMe ? null : p.ps.origin, { volume: isMe ? 0.3 : 0.5 }); if (isMe) { this.cam.jumpT = 0; this.viewWeapon.jump(); } break;
        case 'walljump': if (!p) break; if (isMe) { this.cam.jumpT = 0; this.viewWeapon.jump(); } A.play('walljump', isMe ? null : p.ps.origin, { volume: 0.5 }); fx.sparkle([p.ps.origin[0], p.ps.origin[1] - 20, p.ps.origin[2]], 0xdddddd, 6, 10); break;
        case 'land': if (isMe) { A.play('land', null, { volume: e.hard ? 0.5 : 0.25 }); this.viewWeapon.land(e.hard ? 1 : 0.4); this.landKick(Math.abs(e.vy || 300)); } break;
        case 'fall': if (!p) break; A.play('land', isMe ? null : p.ps.origin, { volume: 0.8, rate: 0.7 }); if (isMe) { this.viewWeapon.land(1.5); this.landKick(800); } break;
        case 'step': if (isMe) this.stepOffset -= e.h || 0; break;
        case 'jumppad': A.play('pad', isMe ? null : e.pos, { volume: 0.7 }); fx.sparkle([e.pos[0], e.pos[1] + 4, e.pos[2]], 0x60c0ff, 14, 40); break;
        case 'teleport':
          A.play('tele', isMe ? null : e.to, { volume: 0.7 });
          A.play('tele', e.from, { volume: 0.5 });
          fx.sparkle([e.from[0], e.from[1] - 24, e.from[2]], 0xb080ff, 30, 30);
          fx.sparkle([e.to[0], e.to[1] - 24, e.to[2]], 0xb080ff, 30, 30);
          // a teleport isn't an acceleration: don't let the new velocity jolt the inertia lean
          if (isMe) { this.input.yaw = e.yaw; this.cam.sv = [me.ps.velocity[0], me.ps.velocity[2]]; }
          if (p) p.prev = [...p.ps.origin];
          break;
        case 'pickup': {
          const def = ITEMS[e.item];
          let snd = 'ammo';
          if (def.kind === 'health') snd = e.item === 'mh' ? 'mega' : e.item === 'h5' ? 'healthSmall' : 'health';
          else if (def.kind === 'armor') snd = e.item === 'shard' ? 'shard' : e.item === 'ra' ? 'megaArmor' : 'armor';
          else if (def.kind === 'weapon') snd = 'weapon';
          A.play(snd, isMe ? null : e.pos, { volume: isMe ? 0.6 : 0.5 });
          if (isMe) { this.hud.pickup(def, e.item); if (def.kind === 'weapon') this.hud.showWeapons(); this.hud.flash(def.kind === 'health' ? 'rgba(90,255,120,0.22)' : def.kind === 'armor' ? 'rgba(255,220,80,0.22)' : 'rgba(255,255,240,0.14)'); }
          break;
        }
        case 'respawnitem': {
          const k = ITEMS[e.item]?.kind;
          A.play(k === 'weapon' || k === 'ammo' ? 'weaponRespawn' : 'healthRespawn', e.pos, { volume: 0.45 });
          fx.sparkle(e.pos, 0xffffff, 16, 24);
          break;
        }
        case 'drop': {
          const it = g.items.find((x) => x.id === e.itemId);
          if (it) this.itemViews.set(it.id, new ItemView(this.assets, this.effects, it, this.scene));
          break;
        }
        case 'switch': if (isMe) { this.viewWeapon.setWeapon(e.weapon); this.hud.showWeapons(); A.play('switch', null, { volume: 0.45 }); } break;
        case 'noammo': if (isMe) A.play('noammo', null, { volume: 0.5 }); break;
        case 'fight': this.hud.center('<div class="big fight">GO!</div>', 1.5); this.say('go', { cut: true }); break;
        case 'matchend': {
          const w = e.winner != null ? this.pname(e.winner) : null;
          g.winner = w;
          this.hud.center(`<div class="big">${e.reason}</div>${w ? escapeHtml(w.name) + ' wins the match' : ''}`, 5, 'top');
          this.intermissionAt = this.time;
          this.endAt = this.time;
          if (!this.net) { this.nextMapKey = nextMap(this.opts.map); this.nextAt = this.time + NEXT_IN; }
          this.say(w === me ? 'win' : 'lose', { cut: true, maxWait: 5 });
          this.zoomToggled = false;
          // offline: the client reports the result to the profile store (online the server does it)
          if (!this.net && this.onMatchEnd) {
            const mine = g.results().find((r) => r.id === me.id);
            Promise.resolve(this.onMatchEnd(mine)).then((res) => { if (res) this.showResults(mine, res.profile, res.levelUp); });
          }
          break;
        }
      }
    }
    if (!list) g.events.length = 0;
    // remove views for items that no longer exist (picked-up drops)
    if (this.itemViews.size !== g.items.length) {
      const ids = new Set(g.items.map((i) => i.id));
      for (const [id, v] of this.itemViews) if (!ids.has(id)) { v.dispose(); this.itemViews.delete(id); }
    }
  }

  render(dt, alpha) {
    const g = this.game, me = this.me, R = this.renderer;
    const w = R.domElement.clientWidth, h = R.domElement.clientHeight;
    const aspect = w / h;
    if (this.endPhase(dt)) {
      this.podium.update(dt, aspect);
      R.render(this.podium.scene, this.podium.camera);
      if (this.settings.graphics?.bloom) this.glow.apply(0.5);
      this.audio.pumpAnnouncer();
      this.hud.update(dt, g, me, this.fps, 0);
      this.hud.scores(this.input.down.has('Tab') || (this.input.is('scores') && !this.paused), g, me, !!this.net);
      this.hud.endScreen(this.endInfo());
      return;
    }
    if (this.endAt != null && g.state === 'intermission') this.hud.endScreen(this.endInfo());
    // zoom (right mouse): the railgun zooms hard, everything else a little
    const zoomBind = this.input.is('zoom') && !this.paused;
    if (this.settings.zoomToggle) { if (this.input.was('zoom') && !this.paused) this.zoomToggled = !this.zoomToggled; } else this.zoomToggled = zoomBind;
    const wantZoom = this.zoomToggled && me.alive && g.state !== 'intermission' ? 1 : 0;
    this.zoom += (wantZoom - this.zoom) * Math.min(1, dt * 16);
    const baseFov = this.settings.fov;
    const zoomedFov = me.weapon === 'rg' ? Math.min(baseFov, this.settings.zoomFov ?? 40) : baseFov * (1 - (this.settings.zoomOther ?? 0.15));
    let hfov = baseFov + (zoomedFov - baseFov) * this.zoom;
    // keep the same feel under zoom: mouse speed follows the focal length (scaled by Zoom sensitivity)
    const focal = Math.tan(hfov * DEG / 2) / Math.tan(baseFov * DEG / 2);
    // speed widens the view a touch (bunnyhop rush) and heavy shots punch it out; neither touches
    // the mouse speed, and both fade out while zoomed
    {
      const c = this.cam, camAmt = this.settings.camMotion ?? 1;
      const hs = me.alive ? Math.hypot(me.ps.velocity[0], me.ps.velocity[2]) : 0;
      const want = this.settings.speedFov !== false ? Math.max(0, Math.min(1, (hs - 380) / 520)) * 7 : 0;
      c.speedFov += (want - c.speedFov) * Math.min(1, dt * 3);
      c.fovK *= Math.exp(-dt * 9);
      hfov = Math.min(170, hfov + (c.speedFov + c.fovK) * camAmt * (1 - this.zoom));
    }
    this.input.sensScale = 1 + (focal * (this.settings.zoomSens ?? 1) - 1) * Math.min(1, this.zoom * 1.5);
    this.hud.setZoom(me.weapon === 'rg' ? this.zoom : 0);
    const vfov = 2 * Math.atan(Math.tan(hfov * DEG / 2) * 0.75) / DEG;
    this.camera.fov = vfov; this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    const lerpP = (p) => { const a = p.prev || p.ps.origin, b = p.ps.origin; return [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha]; };

    // camera
    const mePos = lerpP(me);
    if (this.netm) { const e = this.netm.errorOffset(dt); mePos[0] += e[0]; mePos[1] += e[1]; mePos[2] += e[2]; }
    this.stepOffset += (0 - this.stepOffset) * Math.min(1, dt * 14);
    const targetVH = me.ps.viewheight;
    this.viewHeight += (targetVH - this.viewHeight) * Math.min(1, dt * 12);
    const yaw = me.alive ? this.input.yaw : (this.deathYaw && this.deathYaw.alive ? yawTo(this.deathYaw.ps.origin[0] - mePos[0], this.deathYaw.ps.origin[2] - mePos[2]) : this.input.yaw);
    const pitch = me.alive ? this.input.pitch : 0;
    // footsteps fall on the bob's low points: one step every 90 units walked
    const hspeed = Math.hypot(me.ps.velocity[0], me.ps.velocity[2]);
    if (me.alive && me.ps.onGround) {
      const before = Math.floor(this.walk / 90);
      this.walk += hspeed * dt;
      if (Math.floor(this.walk / 90) !== before) this.audio.play('step', null, { volume: 0.18 });
    }
    const cm = this.cameraMotion(dt, me, yaw);
    this.camera.position.set(mePos[0], mePos[1] + (me.alive ? this.viewHeight + this.stepOffset + cm.dy : -8), mePos[2]);
    this.camera.rotation.set((pitch + cm.pitch) * DEG, (yaw + cm.yaw) * DEG, me.alive ? cm.roll : 0.4);
    if (cm.push) { this.camera.getWorldDirection(_fw); this.camera.position.addScaledVector(_fw, -cm.push); }
    // explosion camera shake (radius falloff applied when the explosion spawned): smooth noise
    // rather than per-frame jitter, so it reads as a shove at any frame rate
    const sh = this.effects.shake;
    if (sh > 0.01) {
      const t = this.time * 22, a = Math.min(1, sh) * sh;
      this.camera.rotation.x += noise(t, 1) * 0.022 * a;
      this.camera.rotation.y += noise(t, 2) * 0.022 * a;
      this.camera.rotation.z += noise(t, 3) * 0.03 * a;
      this.camera.position.y += noise(t, 4) * 2.2 * a;
    }
    this.effects.shake = Math.max(0, sh - dt * 2.8);
    this.sky.position.copy(this.camera.position);
    this.atmosphere.update(dt, this.camera.position, this.time);

    const light = [0, 0, 0, 0, 0, 0];
    const tmp = [0, 0, 0, 0, 0, 0];
    // other players
    for (const p of g.players) {
      if (p === me) continue;
      const m = this.models.get(p.id);
      if (!m) continue;
      // online, a player can be alive before we saw their spawn (joined mid-match, bots at start)
      if (this.net && p.alive && !m.root.visible) { m.revive(); m.root.visible = true; }
      const pos = lerpP(p);
      if (!p.alive && !m.dead && m.root.visible) m.die();
      if (p.alive) m.setWeapon(this.assets, p.weapon);
      this.world.lightGrid.sample([pos[0], pos[1] + 10, pos[2]], tmp);
      m.update(dt, pos, p.ps.yaw, p.ps.pitch, p.ps.velocity, p.ps.onGround, p.ps.ducked, tmp);
      // footsteps
      if (p.alive && p.ps.onGround) {
        p.stepDist = (p.stepDist || 0) + Math.hypot(p.ps.velocity[0], p.ps.velocity[2]) * dt;
        if (p.stepDist > 90) { p.stepDist = 0; this.audio.play('step', [pos[0], pos[1] - 24, pos[2]], { volume: 0.5 }); }
      }
    }
    // projectiles
    for (const v of this.projViews.values()) {
      const pr = v.pr;
      if (!pr) continue;
      const a = pr.prev || pr.pos;
      const pos = [a[0] + (pr.pos[0] - a[0]) * alpha, a[1] + (pr.pos[1] - a[1]) * alpha, a[2] + (pr.pos[2] - a[2]) * alpha];
      v.obj.position.set(...pos);
      if (v.kind === 'rocket') {
        v.obj.lookAt(pos[0] - pr.vel[0], pos[1] - pr.vel[1], pos[2] - pr.vel[2]);
        v.flame.scale.setScalar(16 + Math.random() * 14); v.flame.material.rotation = Math.random() * 6.28;
        v.glow.material.opacity = 0.75 + Math.random() * 0.25;
        // trail puffs spaced by distance so the smoke line has no gaps at low frame rates
        const lp = v.lastPuff || pos;
        let dd = Math.hypot(pos[0] - lp[0], pos[1] - lp[1], pos[2] - lp[2]);
        if (!v.lastPuff) { v.lastPuff = [...pos]; dd = 0; }
        const gap = this.effects.hi() ? 9 : 15;
        for (let k = gap; k <= dd; k += gap) {
          const t = k / dd;
          this.effects.smokeTrail([lp[0] + (pos[0] - lp[0]) * t, lp[1] + (pos[1] - lp[1]) * t, lp[2] + (pos[2] - lp[2]) * t], pr.vel);
          v.lastPuff = [lp[0] + (pos[0] - lp[0]) * t, lp[1] + (pos[1] - lp[1]) * t, lp[2] + (pos[2] - lp[2]) * t];
        }
        this.audio.move(v.sound, pos);
      } else if (!pr.resting) {
        v.obj.rotation.x += v.spin[0] * dt; v.obj.rotation.y += v.spin[1] * dt;
        v.smokeT -= dt;
        if (v.smokeT <= 0) { v.smokeT = 0.02; this.effects.grenadeTrail(pos); }
      }
    }
    for (const v of this.itemViews.values()) v.update(this.time, dt, this.world.lightGrid);
    this.props.update(this.time);
    this.effects.update(dt, this.camera.position);
    this.gore.update(dt, this.world.lightGrid);
    this.audio.pumpAnnouncer();
    const scale = h * R.getPixelRatio() / (2 * Math.tan(vfov * DEG / 2));   // point sizes are in device pixels
    this.effects.add.mat.uniforms.scale.value = scale;
    this.effects.smoke.mat.uniforms.scale.value = scale;
    if (this.atmosphere.dust) this.atmosphere.dust.material.uniforms.scale.value = scale;

    // listener
    const fwd = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    this.camera.getWorldDirection(fwd);
    this.audio.setListener(this.camera.position, fwd, up);

    if (this.dyn) this.dyn.update(this.camera, this.time, dt);
    R.render(this.scene, this.camera);

    // view weapon
    this.world.lightGrid.sample([mePos[0], mePos[1] + 26, mePos[2]], light);
    _ld.set(light[3], light[4], light[5]).applyQuaternion(_iq.copy(this.camera.quaternion).invert());
    light[3] = _ld.x; light[4] = _ld.y; light[5] = _ld.z;
    const speed = Math.hypot(me.ps.velocity[0], me.ps.velocity[2]);
    const dyaw = angleDiff(this.input.yaw, this.lastYaw), dpitch = this.input.pitch - this.lastPitch;
    this.lastYaw = this.input.yaw; this.lastPitch = this.input.pitch;
    if (this.net && me.alive) this.viewWeapon.setWeapon(me.weapon);   // server-side switches (pickups, out of ammo)
    const vr = [0, 0, 0], vf = [0, 0, 0];
    angleVectors(0, this.input.yaw, vf, vr);
    const v = me.ps.velocity;
    this.viewWeapon.update(dt, speed, me.ps.onGround, dyaw, dpitch, light, this.settings, {
      side: v[0] * vr[0] + v[2] * vr[2], fwd: v[0] * vf[0] + v[2] * vf[2], up: v[1], walk: this.walk, ducked: me.ps.ducked,
    });
    this.viewWeapon.render(R, aspect, me.alive && gunFor(this.settings, this.viewWeapon.current).gunVisible && g.state !== 'intermission');
    if (this.settings.graphics?.bloom) this.glow.apply(0.55);

    this.hud.view = { pos: me.ps.origin, yaw: this.input.yaw, dyaw, dpitch, vy: v[1], onGround: me.ps.onGround };
    this.hud.update(dt, g, me, this.fps, speed);
    this.hud.setLocked(this.input.locked || this.paused);
    this.hud.scores((this.input.is('scores') && !this.paused) || g.state === 'intermission', g, me, !!this.net);
  }

  // end of match: scoreboard for PODIUM_AT s, then the podium (true while it is on screen); offline
  // the next map starts when the countdown runs out (online the server starts it)
  endPhase(dt) {
    if (this.endAt == null || this.game.state !== 'intermission') return false;
    if (!this.net && !this.nextFired && this.nextAt != null && this.time >= this.nextAt) { this.nextFired = true; if (this.onNext) setTimeout(() => this.onNext(this.nextMapKey), 0); }
    if (this.time - this.endAt < PODIUM_AT) return false;
    if (!this.podium) {
      const top = this.game.ranking().slice(0, 3).map((p) => ({ name: p.name, color: p.color, character: p.character || 'capi', frags: p.frags, me: p === this.me }));
      this.podium = new Podium(this.assets, top);
      // free the mouse for the buttons without opening the pause menu
      this.input.enabled = false; this.input.down.clear(); this.input.unlock();
      this.hud.setLocked(true);
    }
    return true;
  }
  endInfo() {
    const left = this.nextAt != null ? Math.max(0, this.nextAt - this.time) : null;
    const def = this.nextMapKey && MAPS[this.nextMapKey] ? MAPS[this.nextMapKey].def : null;
    return {
      podium: !!this.podium && this.time - this.endAt >= PODIUM_AT, left, total: NEXT_IN,
      next: def ? def.name : null, online: !!this.net, winner: this.game.winner ? this.game.winner.name : null,
      labels: this.podium ? this.podium.labels() : [],
      onQuit: () => this.onQuit && this.onQuit(),
      onNext: !this.net ? () => { if (!this.nextFired) { this.nextFired = true; this.onNext && this.onNext(this.nextMapKey); } } : null,
    };
  }

  landKick(vy) {
    // a soft landing barely registers, a long fall slams the view down (Q3 cg.landChange)
    const k = Math.max(0, Math.min(1, (vy - 180) / 520));
    if (k <= 0.02) return;
    const c = this.cam, left = c.landT < 0.35 ? c.landAmt : 0;
    c.landT = 0; c.landAmt = Math.max(left, 1.5 + k * 7);
    // a hard landing also jolts: the head tips to one side and the impact rattles the view
    c.landRoll += (Math.random() < 0.5 ? -1 : 1) * k * 1.4 * DEG;
    c.trauma = Math.min(1, c.trauma + k * 0.35);
  }

  // subtle view motion, purely visual (the aim never moves): landing dip, jump nudge, recoil
  // spring, flinch roll on damage and a small Q3 run roll when strafing on the ground
  cameraMotion(dt, me, yaw) {
    const c = this.cam, amt = this.settings.camMotion ?? 1;
    // landing: 70 ms down, 280 ms back up
    c.landT += dt;
    let dy = 0, pitch = 0;
    if (c.landT < 0.35) {
      const t = c.landT;
      const k = t < 0.07 ? Math.sin(t / 0.07 * Math.PI / 2) : 1 - easeInOut((t - 0.07) / 0.28);
      dy -= c.landAmt * k;
      pitch -= c.landAmt * 0.18 * k;
    } else c.landAmt = 0;
    // jump: a quick lift of the view, settling back
    c.jumpT += dt;
    if (c.jumpT < 0.3) pitch += Math.sin(c.jumpT / 0.3 * Math.PI) * 0.6;
    // recoil: a damped spring kicked by each shot
    c.kickV -= c.kickP * 260 * dt;
    c.kickV *= Math.exp(-dt * 22);
    c.kickP += c.kickV * dt;
    c.kickY *= Math.exp(-dt * 12);
    pitch += c.kickP;
    // shot push: the eye is shoved back along the line of sight and springs forward again
    c.pushV -= c.pushP * 180 * dt;
    c.pushV *= Math.exp(-dt * 18);
    c.pushP += c.pushV * dt;
    // run roll: lean a touch into the strafe (Q3 cg_runroll), damage roll decays
    let roll = 0, yawOff = c.kickY;
    if (me.alive) {
      const r = [0, 0, 0], f = [0, 0, 0];
      angleVectors(0, yaw, f, r);
      const vx = me.ps.velocity[0], vz = me.ps.velocity[2];
      const side = vx * r[0] + vz * r[2], fwd = vx * f[0] + vz * f[2];
      const target = Math.max(-1.2, Math.min(1.2, -side * 0.0035 * (me.ps.onGround ? 1 : 0.4))) * DEG;
      c.roll += (target - c.roll) * Math.min(1, dt * 8);
      roll = c.roll;
      // inertia: speeding up tips the head back, braking pitches it forward, and a sideways shove
      // (or a tight air-strafe curve) leans it; acceleration = velocity minus its smoothed self
      const sm = Math.min(1, dt * 7);
      c.sv[0] += (vx - c.sv[0]) * sm; c.sv[1] += (vz - c.sv[1]) * sm;
      const ax = (vx - c.sv[0]) * 7, az = (vz - c.sv[1]) * 7;
      const aSide = ax * r[0] + az * r[2], aFwd = ax * f[0] + az * f[2];
      const lp = Math.max(-1.1, Math.min(1.1, aFwd * 0.0003)), lr = Math.max(-1.2, Math.min(1.2, -aSide * 0.00025));
      c.lean[0] += (lp - c.lean[0]) * Math.min(1, dt * 10);
      c.lean[1] += (lr - c.lean[1]) * Math.min(1, dt * 10);
      pitch += c.lean[0];
      roll += c.lean[1] * DEG;
      // head bob, in step with the gun and the footsteps: the eye drops on each footfall and the
      // head rolls toward the foot carrying the weight (viewBob off keeps the head steady)
      const want = me.ps.onGround && this.settings.viewBob !== false ? Math.min(hspeedOf(me), 420) / 320 : 0;
      c.bobAmt += (want - c.bobAmt) * Math.min(1, dt * (want > c.bobAmt ? 6 : 4));
      const ph = Math.PI * this.walk / 90, low = 1 - Math.abs(Math.sin(ph));
      dy -= low * 0.9 * c.bobAmt;
      pitch -= low * 0.18 * c.bobAmt;
      roll += Math.cos(ph) * 0.3 * c.bobAmt * DEG;
    }
    c.hurtRoll *= Math.exp(-dt * 7);
    c.landRoll *= Math.exp(-dt * 6);
    c.kickR *= Math.exp(-dt * 11);
    roll += c.hurtRoll + c.landRoll + c.kickR;
    // trauma (hits, hard landings): a short, smooth rattle that falls off quickly
    c.trauma = Math.max(0, c.trauma - dt * 2.2);
    if (c.trauma > 0) {
      const t = this.time * 18, a = c.trauma * c.trauma;
      pitch += noise(t, 11) * 1.4 * a;
      yawOff += noise(t, 12) * 1.4 * a;
      roll += noise(t, 13) * 2 * a * DEG;
    }
    return { dy: dy * amt, pitch: pitch * amt, yaw: yawOff * amt, roll: roll * amt, push: c.pushP * amt };
  }

  // end-of-match XP / level panel (both modes)
  showResults(mine, profile, levelUp) {
    if (!mine) return;
    this.hud.results(mine, profile, levelUp);
    if (profile && this.onProfile) this.onProfile(profile);
  }
}

const _ld = new THREE.Vector3(), _iq = new THREE.Quaternion(), _fw = new THREE.Vector3();
// smooth noise in [-1, 1]: a few incommensurate sines, a different pattern per seed
function noise(t, seed) { return Math.sin(t + seed * 12.9) * 0.5 + Math.sin(t * 2.31 + seed * 7.3) * 0.3 + Math.sin(t * 4.77 + seed * 3.1) * 0.2; }
function hspeedOf(p) { return Math.hypot(p.ps.velocity[0], p.ps.velocity[2]); }
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function frame() { return new Promise((r) => requestAnimationFrame(() => r())); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function easeInOut(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
