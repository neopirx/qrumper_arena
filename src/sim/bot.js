// Bot AI. Bots produce the same usercmds a human does and run through the same CPMA pmove.
import { WEAPONS, WEAPON_ORDER } from './defs.js';
import { yawTo, angleDiff, DEG, angleVectors } from './vec.js';
import { MASK_PLAYER } from './collision.js';
import { PLAYER_MINS, PLAYER_MAXS } from './pmove.js';

export function makeBot(skill) {
  return (player, game) => new Bot(player, game, skill);
}

const RANGES = { mg: [0, 600], sg: [0, 220], rl: [140, 520], gl: [120, 420], rg: [450, 2000] };

class Bot {
  constructor(p, game, skill) {
    this.p = p; this.game = game;
    this.skill = skill;
    const s = (skill - 1) / 4; // 0..1
    this.s = s;
    this.reaction = 0.45 - 0.3 * s;
    this.aimError = 7 - 5.5 * s;        // degrees
    this.turnSpeed = 280 + 900 * s;     // deg/s
    this.lagTime = 0.18 - 0.12 * s;
    this.fovHalf = 60 + 30 * s;
    this.reset();
    this.ph = [Math.random() * 10, Math.random() * 10, Math.random() * 10];
  }

  reset() {
    this.path = null; this.pathIdx = 0; this.goal = null; this.nextGoal = this.game.time + 0.25;
    this.enemy = null; this.enemySince = 0; this.enemyLastSeen = -10; this.enemyLastPos = null; this.enemyVisible = false;
    this.nextPerceive = 0; this.strafe = 1; this.strafeUntil = 0;
    this.stuck = 0; this.nextWeaponCheck = 0; this.nextSkip = 0;
    this.trackTime = 0; this.hopping = false;
  }

  onSpawn() { this.reset(); }
  onDeath() { this.path = null; }
  // thrown by a jump pad: ride the arc hands-off, then pick a new route from wherever we land
  onPad() { this.padFlight = true; }

  onTeleport() { this.path = null; this.nextGoal = this.game.time + 0.25; }
  onDamage(attacker, dmg) {
    if (attacker && attacker !== this.p && attacker.alive) {
      if (!this.enemy || !this.enemyVisible) { this.enemy = attacker; this.enemySince = this.game.time - this.reaction * 0.5; this.enemyLastPos = [...attacker.ps.origin]; this.enemyLastSeen = this.game.time; }
    }
  }

  get nav() { return this.game.nav; }

  think(dt) {
    const g = this.game, p = this.p, cmd = p.cmd;
    if (!p.alive) { cmd.attack = !cmd.attack && Math.random() < 0.05; cmd.jump = false; cmd.forward = cmd.side = 0; return; }
    if (g.state === 'warmup') { cmd.forward = cmd.side = 0; cmd.attack = false; cmd.jump = false; }
    const t = g.time;
    if (t >= this.nextPerceive) { this.perceive(); this.nextPerceive = t + 0.08; }
    if (t >= this.nextWeaponCheck) { this.chooseWeapon(); this.nextWeaponCheck = t + 0.4; }
    if (this.nav && t >= this.nextGoal) this.chooseGoal();

    const move = this.followPath(dt);
    this.combat(dt, move);
  }

  eye(pl) { return [pl.ps.origin[0], pl.ps.origin[1] + pl.ps.viewheight, pl.ps.origin[2]]; }

  canSee(o) {
    const e = this.eye(this.p);
    const col = this.game.col;
    return col.visible(e, this.eye(o)) || col.visible(e, o.ps.origin);
  }

  perceive() {
    const g = this.game, me = this.p;
    let best = null, bestScore = -1e9;
    for (const o of g.players) {
      if (o === me || !o.alive) continue;
      const dx = o.ps.origin[0] - me.ps.origin[0], dy = o.ps.origin[1] - me.ps.origin[1], dz = o.ps.origin[2] - me.ps.origin[2];
      const d = Math.hypot(dx, dy, dz);
      const ang = Math.abs(angleDiff(yawTo(dx, dz), me.ps.yaw));
      const inFov = ang < this.fovHalf || d < 300 || (o.firing && d < 900);
      if (!inFov && o !== this.enemy) continue;
      if (!this.canSee(o)) continue;
      let score = -d - ang * 2;
      if (o === this.enemy) score += 300;
      if (o === me.lastHurtBy && g.time - me.lastHurtTime < 2) score += 400;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (best) {
      if (best !== this.enemy || !this.enemyVisible) { this.enemySince = g.time; this.trackTime = 0; }
      this.enemy = best; this.enemyVisible = true; this.enemyLastSeen = g.time; this.enemyLastPos = [...best.ps.origin];
    } else {
      this.enemyVisible = false;
      if (this.enemy && (!this.enemy.alive || g.time - this.enemyLastSeen > 5)) this.enemy = null;
    }
  }

  chooseWeapon() {
    const p = this.p;
    let d = 600;
    if (this.enemy && this.enemyLastPos) d = Math.hypot(this.enemyLastPos[0] - p.ps.origin[0], this.enemyLastPos[1] - p.ps.origin[1], this.enemyLastPos[2] - p.ps.origin[2]);
    let best = null, bs = -1;
    for (const id of WEAPON_ORDER) {
      if (!p.weapons[id] || p.ammo[id] <= 0) continue;
      let s;
      switch (id) {
        case 'mg': s = 2 + (d > 800 ? 2 : 0); break;
        case 'sg': s = d < 250 ? 8 : d < 450 ? 4 : 1; break;
        case 'rl': s = d < 120 ? 4 : d < 700 ? 9 : 4; break;
        case 'gl': s = d < 120 ? 2 : d < 450 ? 6.5 : 2; break;
        case 'rg': s = d > 500 ? 9.5 : d > 250 ? 6 : 3; if (this.skill <= 2) s -= 2; break;
      }
      if (s > bs) { bs = s; best = id; }
    }
    if (best && best !== p.weapon) p.cmd.weapon = best;
  }

  itemValue(it) {
    const p = this.p, d = it.def;
    switch (d.kind) {
      case 'health':
        if (it.type === 'mh') return p.health < 200 ? 70 + (200 - p.health) * 0.3 : 0;
        if (it.type === 'h5') return p.health < 200 ? 5 : 0;
        return p.health < 100 ? d.amount * 0.6 + (100 - p.health) * 0.5 : 0;
      case 'armor':
        if (p.armor >= 200) return 0;
        if (it.type === 'ra') return 65 + (200 - p.armor) * 0.15;
        if (it.type === 'ya') return 35 + (200 - p.armor) * 0.1;
        return 5;
      case 'weapon': {
        if (!p.weapons[d.weapon]) return { rl: 90, rg: 75, gl: 50, sg: 35 }[d.weapon];
        return p.ammo[d.weapon] < WEAPONS[d.weapon].maxAmmo * 0.4 ? 12 : 2;
      }
      case 'ammo':
        if (!p.weapons[d.weapon]) return 2;
        return p.ammo[d.weapon] < WEAPONS[d.weapon].maxAmmo * 0.5 ? 12 : 0;
    }
    return 0;
  }

  myNode() {
    const o = this.p.ps.origin;
    const n = this.nav.nearest([o[0], o[1] - 24.25, o[2]], this.game.col);
    return n ? n.i : -1;
  }

  chooseGoal() {
    const g = this.game, p = this.p;
    this.nextGoal = g.time + 0.8 + Math.random() * 0.6;
    const start = this.myNode();
    if (start < 0) { this.path = null; this.nextGoal = g.time + 0.25; return; }
    // reuse the distance field when we haven't moved to another node recently
    if (!this.distCache || this.distCache.start !== start || g.time - this.distCache.t > 1.5) this.distCache = { start, t: g.time, dist: this.nav.distances(start, 7000) };
    const dist = this.distCache.dist;
    let best = null, bestScore = 0;
    for (const it of g.items) {
      if (it.node == null) { const n = this.nav.nearest(it.pos, g.col); it.node = n ? n.i : -1; }
      if (it.node < 0) continue;
      const d = dist[it.node];
      if (!isFinite(d)) continue;
      const travel = d / 320;
      if (!it.active) {
        // skilled bots time item respawns
        if (this.skill < 3 || it.respawnAt - g.time > travel + 2) continue;
      }
      const v = this.itemValue(it);
      if (v <= 0) continue;
      const score = v / (1 + d / 450);
      if (score > bestScore) { bestScore = score; best = { node: it.node, item: it }; }
    }
    // chase / hunt the enemy when well stocked
    const strong = p.health + p.armor > 120 && (p.weapons.rl || p.weapons.rg || p.weapons.gl);
    if (this.enemy && this.enemyLastPos && strong && g.time - this.enemyLastSeen < 4) {
      const n = this.nav.nearest([this.enemyLastPos[0], this.enemyLastPos[1] - 24, this.enemyLastPos[2]], g.col);
      if (n && isFinite(dist[n.i])) {
        const s = 30 / (1 + dist[n.i] / 600);
        if (s > bestScore) { bestScore = s; best = { node: n.i, chase: true }; }
      }
    }
    if (!best) {
      // roam to a random reachable node
      for (let k = 0; k < 20; k++) {
        const i = Math.floor(Math.random() * this.nav.nodes.length);
        if (isFinite(dist[i]) && dist[i] > 400) { best = { node: i, roam: true }; break; }
      }
    }
    if (!best) { this.path = null; this.nextGoal = g.time + 0.3; return; }
    if (this.goal && this.path && this.goal.node === best.node && this.pathIdx < this.path.length) return;
    this.goal = best;
    this.path = this.nav.path(start, best.node);
    if (!this.path) this.nextGoal = g.time + 0.3;
    this.pathIdx = 1;
    if (this.path && this.path.length === 1) this.pathIdx = 0;
  }

  // Returns desired horizontal move direction [x,z] (unit) or null; also may set jump.
  followPath(dt) {
    const p = this.p, ps = p.ps, cmd = p.cmd, g = this.game;
    cmd.jump = false; cmd.crouch = false;
    this.hopping = false;
    if (this.padFlight) {
      if (!ps.onGround || ps.velocity[1] > 0) return null;
      this.padFlight = false;
      // landed: the old path assumed a different flight, so re-plan from here
      const nodes = this.nav.nodes, tgt = this.path && this.path[this.pathIdx] != null ? nodes[this.path[this.pathIdx]] : null;
      if (!tgt || Math.hypot(tgt.p[0] - ps.origin[0], tgt.p[2] - ps.origin[2]) > 120) { this.path = null; this.nextGoal = this.game.time; return null; }
    }
    if (!this.path || this.pathIdx >= this.path.length) { this.path = null; return null; }
    const nodes = this.nav.nodes;
    const feet = ps.origin[1] - 24.25;
    let tgt = nodes[this.path[this.pathIdx]];
    let hd = Math.hypot(tgt.p[0] - ps.origin[0], tgt.p[2] - ps.origin[2]);
    const prev = this.pathIdx > 0 ? this.path[this.pathIdx - 1] : -1;
    const ltype = prev >= 0 ? this.nav.linkType(prev, this.path[this.pathIdx]) : 'walk';

    // reached?
    if (hd < 22 && Math.abs(feet - tgt.p[1]) < 30) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) { this.path = null; this.nextGoal = this.game.time + 0.25; return null; }
      return this.followPath(dt);
    }
    // in the middle of a pad flight: let physics carry us
    if (ltype === 'pad' && !ps.onGround) return null;

    // string pulling: skip ahead to farther nodes we can walk straight to
    if (g.time >= this.nextSkip && ps.onGround) {
      this.nextSkip = g.time + 0.15;
      for (let k = Math.min(this.path.length - 1, this.pathIdx + 4); k > this.pathIdx; k--) {
        let allWalk = true;
        for (let j = this.pathIdx; j < k; j++) if (this.nav.linkType(this.path[j], this.path[j + 1]) !== 'walk') { allWalk = false; break; }
        if (!allWalk) continue;
        const n = nodes[this.path[k]];
        if (Math.abs(n.p[1] - feet) > 20) continue;
        const end = [n.p[0], n.p[1] + 24.25 + 2, n.p[2]];
        const st = [ps.origin[0], ps.origin[1] + 2, ps.origin[2]];
        const tr = g.col.trace(st, end, PLAYER_MINS, PLAYER_MAXS, MASK_PLAYER);
        if (tr.fraction >= 1 && this.groundBetween(st, end)) { this.pathIdx = k; tgt = n; hd = Math.hypot(tgt.p[0] - ps.origin[0], tgt.p[2] - ps.origin[2]); break; }
      }
    }

    // off course (fell, knocked back): repath
    if (hd > 400 || feet - tgt.p[1] > 180 || (ps.onGround && tgt.p[1] - feet > 70)) { this.nextGoal = this.game.time + 0.25; this.path = null; return null; }

    const nl = this.pathIdx > 0 ? this.nav.linkType(this.path[this.pathIdx - 1], this.path[this.pathIdx]) : 'walk';
    if (nl === 'jump' && ps.onGround && hd < 70) cmd.jump = true;
    // leap: run at the gap and jump at the edge (when the floor ahead runs out)
    if (nl === 'leap') {
      this.hopping = false;
      if (ps.onGround && !this.safeGround((tgt.p[0] - ps.origin[0]) / (hd || 1), (tgt.p[2] - ps.origin[2]) / (hd || 1), 26)) cmd.jump = true;
      if (!ps.onGround) { const dx = tgt.p[0] - ps.origin[0], dz = tgt.p[2] - ps.origin[2], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l, tgt]; }
    }

    // stuck detection
    const sp = Math.hypot(ps.velocity[0], ps.velocity[2]);
    if (sp < 60 && ps.onGround) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 0.5) cmd.jump = true;
    if (this.stuck > 1.6) { this.stuck = 0; this.path = null; this.nextGoal = this.game.time + 0.25; this.strafe = -this.strafe; }

    // strafe-jump (bunny hop) on long straight walking stretches
    if (this.skill >= 3 && !this.enemyVisible) {
      let straight = 0;
      for (let j = this.pathIdx; j < this.path.length - 1 && j < this.pathIdx + 8; j++) {
        if (this.nav.linkType(this.path[j], this.path[j + 1]) !== 'walk') break;
        straight++;
      }
      // no hopping on narrow walkways: air strafing would carry the bot over the edge
      const px = -(tgt.p[2] - ps.origin[2]), pz = tgt.p[0] - ps.origin[0], pl = Math.hypot(px, pz) || 1;
      if (straight >= 4 && hd > 40 && this.safeGround(px / pl * 1.4, pz / pl * 1.4) && this.safeGround(-px / pl * 1.4, -pz / pl * 1.4)) this.hopping = true;
    }
    const dx = tgt.p[0] - ps.origin[0], dz = tgt.p[2] - ps.origin[2];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l, tgt];
  }

  groundBetween(a, b) {
    const col = this.game.col;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const tr = col.trace(p, [p[0], p[1] - 40, p[2]], PLAYER_MINS, PLAYER_MAXS, MASK_PLAYER);
      if (tr.fraction >= 1) return false;
    }
    return true;
  }

  safeGround(dirx, dirz, reach = 48) {
    const ps = this.p.ps, col = this.game.col;
    const p = [ps.origin[0] + dirx * reach, ps.origin[1], ps.origin[2] + dirz * reach];
    // a jump pad is not ground to dodge onto: it throws you somewhere you didn't choose
    for (const pd of this.game.pads || []) if (p[0] > pd.min[0] - 16 && p[0] < pd.max[0] + 16 && p[2] > pd.min[2] - 16 && p[2] < pd.max[2] + 16 && Math.abs(ps.origin[1] - 24 - pd.at[1]) < 24) return false;
    const tr = col.trace(p, [p[0], p[1] - 80, p[2]], [-8, -24, -8], [8, 8, 8], MASK_PLAYER);
    return tr.fraction < 1 || tr.startsolid;
  }

  combat(dt, move) {
    const g = this.game, p = this.p, ps = p.ps, cmd = p.cmd, t = g.time;
    let desiredYaw = cmd.yaw, desiredPitch = 0;
    let mx = 0, mz = 0;
    if (move) { mx = move[0]; mz = move[1]; desiredYaw = yawTo(mx, mz); }
    cmd.attack = false;

    const e = this.enemy;
    if (e && e.alive && this.enemyVisible) {
      this.trackTime += dt;
      const me = this.eye(p);
      // perceived target state (lagged), extrapolated
      const h = e.history;
      let st = h.length ? h[h.length - 1] : { o: e.ps.origin, v: e.ps.velocity };
      for (let i = h.length - 1; i >= 0; i--) if (t - h[i].t >= this.lagTime) { st = h[i]; break; }
      const lag = Math.min(this.lagTime, t - (st.t ?? t));
      const tp = [st.o[0] + st.v[0] * lag, st.o[1] + st.v[1] * lag, st.o[2] + st.v[2] * lag];
      const w = WEAPONS[p.weapon];
      let aim = [tp[0], tp[1] + 8, tp[2]];
      const d = Math.hypot(aim[0] - me[0], aim[1] - me[1], aim[2] - me[2]);
      if (w.speed) {
        let tt = d / w.speed;
        for (let k = 0; k < 2; k++) {
          aim = [tp[0] + st.v[0] * tt, tp[1] + st.v[1] * tt, tp[2] + st.v[2] * tt];
          if (!e.ps.onGround) aim[1] -= 400 * tt * tt;
          tt = Math.hypot(aim[0] - me[0], aim[1] - me[1], aim[2] - me[2]) / w.speed;
        }
        if (w.id === 'rl' && e.ps.onGround && this.skill >= 2) aim[1] = tp[1] - 18; // aim at the feet
        if (w.id === 'gl') aim[1] += 400 * tt * tt - 0.2 * Math.hypot(aim[0] - me[0], aim[2] - me[2]); // lob: undo gravity and the launch tilt
      }
      const adx = aim[0] - me[0], ady = aim[1] - me[1], adz = aim[2] - me[2];
      desiredYaw = yawTo(adx, adz);
      desiredPitch = Math.atan2(ady, Math.hypot(adx, adz)) / DEG;
      // aim wobble that settles while tracking
      const settle = Math.max(0.35, 1 - this.trackTime * 0.8);
      const targetSpeed = Math.hypot(e.ps.velocity[0], e.ps.velocity[2]);
      const amp = this.aimError * settle * (0.6 + targetSpeed / 500);
      desiredYaw += amp * Math.sin(t * 2.3 + this.ph[0]) * Math.cos(t * 0.7 + this.ph[1]);
      desiredPitch += amp * 0.6 * Math.sin(t * 1.9 + this.ph[2]);

      // fire decision
      const errYaw = Math.abs(angleDiff(cmd.yaw, yawTo(adx, adz)));
      const errPitch = Math.abs(cmd.pitch - Math.atan2(ady, Math.hypot(adx, adz)) / DEG);
      const tol = Math.atan2(w.id === 'rg' ? 14 : w.splash ? 40 : 24, d) / DEG + (w.id === 'mg' ? 2 : 0.5);
      const reacted = t - this.enemySince > this.reaction;
      const selfRisk = w.splash && d < (w.id === 'gl' ? 160 : 110);
      if (reacted && errYaw < tol && errPitch < tol * 1.3 && !selfRisk) cmd.attack = true;

      // dodge movement
      if (t >= this.strafeUntil) {
        this.strafe = Math.random() < 0.5 ? -1 : 1;
        this.strafeUntil = t + 0.35 + Math.random() * (1.1 - this.s * 0.5);
      }
      const tx = e.ps.origin[0] - ps.origin[0], tz = e.ps.origin[2] - ps.origin[2];
      const tl = Math.hypot(tx, tz) || 1;
      const ex = tx / tl, ez = tz / tl;
      let sx = -ez * this.strafe, sz = ex * this.strafe;
      if (!this.safeGround(sx, sz)) { this.strafe = -this.strafe; sx = -sx; sz = -sz; }
      const [rmin, rmax] = RANGES[p.weapon] || [0, 600];
      const rangeTerm = tl > rmax ? 1 : tl < rmin ? -1 : 0;
      const wantItem = move && this.goal && this.goal.item && (p.health < 70 || this.goal.item.def.kind !== 'ammo');
      if (wantItem) { mx = mx * 1.0 + sx * 0.8; mz = mz * 1.0 + sz * 0.8; }
      else {
        mx = ex * rangeTerm * 0.8 + sx; mz = ez * rangeTerm * 0.8 + sz;
        if (rangeTerm < 0 && !this.safeGround(-ex, -ez)) { mx = sx; mz = sz; }
      }
      // never dodge off a ledge: fall back to the path direction (which may be a deliberate drop), else stand
      const ml0 = Math.hypot(mx, mz);
      if (ml0 > 0.01 && ps.onGround && !this.safeGround(mx / ml0, mz / ml0)) {
        if (move) { mx = move[0]; mz = move[1]; } else { mx = 0; mz = 0; }
      }
      // momentum check: where we'd be in a quarter second; brake against the slide if that's air
      const vx = ps.velocity[0], vz = ps.velocity[2], vs = Math.hypot(vx, vz);
      if (ps.onGround && vs > 60) {
        const ux = vx / vs, uz = vz / vs;
        const onPath = wantItem && move[0] * ux + move[1] * uz > 0.8;
        if (!onPath && !this.safeGround(ux, uz, Math.min(120, 30 + vs * 0.25))) { mx = -ux + sx * 0.3; mz = -uz + sz * 0.3; }
      }
      // in the air (pad flights, falls, knockback) keep hands off the keys unless the path
      // wants a steer (leaps): air control would carry us off our arc
      if (!ps.onGround && (!move || this.padFlight)) { mx = 0; mz = 0; }
      // dodge jumps only where the landing (about 0.65 s of flight away) is solid
      if (ps.onGround && Math.random() < 0.004 + this.s * 0.008) {
        const v2 = Math.hypot(ps.velocity[0], ps.velocity[2]);
        if (v2 < 40 || (this.safeGround(ps.velocity[0] / v2, ps.velocity[2] / v2, v2 * 0.65) && this.safeGround(ps.velocity[0] / v2, ps.velocity[2] / v2, v2 * 0.35))) cmd.jump = true;
      }
    } else {
      this.trackTime = 0;
      if (this.enemy && this.enemyLastPos && t - this.enemyLastSeen < 1.5) {
        // keep looking where the enemy was
        const me = this.eye(p);
        const lp = this.enemyLastPos;
        desiredYaw = yawTo(lp[0] - me[0], lp[2] - me[2]);
        desiredPitch = Math.atan2(lp[1] - me[1], Math.hypot(lp[0] - me[0], lp[2] - me[2])) / DEG;
      } else if (move && move[2]) {
        const n = move[2].p;
        const me = this.eye(p);
        desiredPitch = Math.max(-30, Math.min(30, Math.atan2(n[1] + 40 - me[1], Math.hypot(n[0] - me[0], n[2] - me[2])) / DEG * 0.5));
      }
    }

    // strafe jumping when cruising
    if (this.hopping && move && !(e && this.enemyVisible)) {
      cmd.jump = true;
      if (!ps.onGround) {
        const vx = ps.velocity[0], vz = ps.velocity[2];
        const speed = Math.hypot(vx, vz);
        const velYaw = yawTo(vx, vz);
        const want = yawTo(move[0], move[1]);
        const diff = angleDiff(want, velYaw);
        const sgn = diff >= 0 ? 1 : -1;
        const opt = speed > 320 ? Math.acos(Math.min(1, 317.4 / speed)) / DEG : 0;
        const viewYaw = velYaw + sgn * (Math.min(Math.abs(diff), opt + 8) - 45);
        this.turnTo(viewYaw, 0, dt, 2.5);
        cmd.forward = 1; cmd.side = -sgn;
        return;
      }
    }

    this.turnTo(desiredYaw, desiredPitch, dt, 1);
    // convert world move to cmd relative to view yaw
    const ml = Math.hypot(mx, mz);
    if (ml > 0.01 && g.state !== 'warmup') {
      mx /= ml; mz /= ml;
      const f = [0, 0, 0], r = [0, 0, 0];
      angleVectors(0, cmd.yaw, f, r);
      let fw = mx * f[0] + mz * f[2], sd = mx * r[0] + mz * r[2];
      cmd.forward = Math.abs(fw) > 0.38 ? Math.sign(fw) : 0;
      cmd.side = Math.abs(sd) > 0.38 ? Math.sign(sd) : 0;
    } else { cmd.forward = 0; cmd.side = 0; }
    if (g.state === 'warmup') cmd.attack = false;
  }

  turnTo(yaw, pitch, dt, mult) {
    const cmd = this.p.cmd;
    const maxStep = this.turnSpeed * mult * dt;
    const dy = angleDiff(yaw, cmd.yaw);
    // smooth approach plus speed cap
    let step = dy * Math.min(1, dt * (8 + 14 * this.s));
    if (Math.abs(dy) > 60) step = Math.sign(dy) * Math.max(Math.abs(step), Math.min(Math.abs(dy), maxStep));
    step = Math.max(-maxStep, Math.min(maxStep, step));
    cmd.yaw = (cmd.yaw + step + 540) % 360 - 180;
    const dp = pitch - cmd.pitch;
    let ps = dp * Math.min(1, dt * (8 + 14 * this.s));
    ps = Math.max(-maxStep, Math.min(maxStep, ps));
    cmd.pitch = Math.max(-89, Math.min(89, cmd.pitch + ps));
  }
}
